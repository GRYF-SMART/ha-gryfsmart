"""Measured PWM duty cycle, not a configuration-only helper."""

from homeassistant.components.number import NumberEntity, NumberMode

from .entity import GryfEntity


async def async_setup_entry(hass, entry, async_add_entities):
    hub = entry.runtime_data
    async_add_entities(GryfPwm(hub, module) for module in hub.client.modules.values() if module.pwm)


class GryfPwm(GryfEntity, NumberEntity):
    _attr_native_min_value = 0
    _attr_native_max_value = 100
    _attr_native_step = 1
    _attr_native_unit_of_measurement = "%"
    _attr_mode = NumberMode.SLIDER
    _attr_icon = "mdi:waveform"

    def __init__(self, hub, module):
        super().__init__(hub, module, "pwm", "PWM")

    @property
    def native_value(self):
        value = self.module_state.pwm
        return value[0] if value is not None else None

    @property
    def extra_state_attributes(self):
        value = self.module_state.pwm
        if value is None:
            return {}
        return {
            "target_percent": value[1],
            "last_nonzero_percent": value[2],
            "ramping": bool(value[3]),
            "frequency_hz": value[4],
        }

    async def async_set_native_value(self, value):
        await self.operation(self.hub.client.pwm(self.module.id, value))
