"""Hardware thermostats; writes preserve the module's configured outputs."""

import time
from decimal import ROUND_HALF_UP, Decimal
from typing import ClassVar

from homeassistant.components.climate import (
    ClimateEntity,
    ClimateEntityFeature,
    HVACAction,
    HVACMode,
)
from homeassistant.const import UnitOfTemperature

from .entity import GryfEntity


async def async_setup_entry(hass, entry, async_add_entities):
    hub = entry.runtime_data
    async_add_entities(
        GryfThermostat(hub, module, channel)
        for module in hub.client.modules.values()
        for channel in range(1, module.thermostats + 1)
    )


class GryfThermostat(GryfEntity, ClimateEntity):
    _attr_temperature_unit = UnitOfTemperature.CELSIUS
    _attr_target_temperature_step = 0.1
    _attr_min_temp = -55
    _attr_max_temp = 125
    _attr_hvac_modes: ClassVar = [HVACMode.OFF, HVACMode.HEAT, HVACMode.COOL]
    _attr_supported_features = (
        ClimateEntityFeature.TARGET_TEMPERATURE
        | ClimateEntityFeature.TURN_ON
        | ClimateEntityFeature.TURN_OFF
    )

    def __init__(self, hub, module, channel):
        super().__init__(hub, module, f"thermostat_{channel}", f"Termostat {channel}")
        self.channel = channel

    @property
    def _status(self):
        return self.module_state.thermostats.get(self.channel)

    @property
    def available(self):
        return (
            super().available
            and self._status is not None
            and time.monotonic() - self._status[7] <= 65
        )

    @property
    def current_temperature(self):
        return self._status[3] / 10 if self._status and self._status[2] else None

    @property
    def target_temperature(self):
        return self._status[4] / 10 if self._status else None

    @property
    def hvac_mode(self):
        if not self._status:
            return None
        return (
            HVACMode.OFF
            if not self._status[0]
            else HVACMode.COOL
            if self._status[1]
            else HVACMode.HEAT
        )

    @property
    def hvac_action(self):
        if not self._status:
            return None
        if not self._status[0]:
            return HVACAction.OFF
        if not self._status[2]:
            # Firmware can hold an output on without a fresh measurement.
            # Do not claim IDLE while it still reports an active output.
            return None
        if not self._status[6]:
            return HVACAction.IDLE
        return HVACAction.COOLING if self._status[1] else HVACAction.HEATING

    @property
    def extra_state_attributes(self):
        cfg = self.module_state.configs.get(self.channel)
        if cfg is None:
            return {}
        return {
            "source_module": cfg.source or self.module.id,
            "source_sensor": cfg.sensor,
            "hysteresis": cfg.hysteresis / 10,
            "outputs": list(cfg.outputs),
            "configured": bool(cfg.outputs),
            "persistence": "RAM; use Save configuration button for EEPROM",
        }

    async def async_set_temperature(self, **kwargs):
        ticks = int(
            (Decimal(str(kwargs["temperature"])) * 10).quantize(Decimal(1), rounding=ROUND_HALF_UP)
        )
        await self.operation(
            self.hub.client.thermostat(self.module.id, self.channel, setpoint=ticks)
        )

    async def async_set_hvac_mode(self, hvac_mode):
        if hvac_mode == HVACMode.OFF:
            changes = {"mode": 0}
        elif hvac_mode in (HVACMode.HEAT, HVACMode.COOL):
            changes = {"mode": 1, "cooling": int(hvac_mode == HVACMode.COOL)}
        else:
            raise ValueError("Unsupported thermostat mode")
        await self.operation(self.hub.client.thermostat(self.module.id, self.channel, **changes))

    async def async_turn_off(self):
        await self.async_set_hvac_mode(HVACMode.OFF)

    async def async_turn_on(self):
        cfg = self.module_state.configs.get(self.channel)
        await self.async_set_hvac_mode(HVACMode.COOL if cfg and cfg.cooling else HVACMode.HEAT)
