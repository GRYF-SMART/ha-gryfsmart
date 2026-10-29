"""Temperature channels and firmware diagnostics."""

import time

from homeassistant.components.sensor import (
    SensorDeviceClass,
    SensorEntity,
    SensorStateClass,
)
from homeassistant.const import EntityCategory, UnitOfTemperature

from .entity import GryfEntity


async def async_setup_entry(hass, entry, async_add_entities):
    hub = entry.runtime_data
    entities = []
    for module in hub.client.modules.values():
        entities.append(GryfFirmware(hub, module))
        entities.extend(
            GryfTemperature(hub, module, channel) for channel in range(1, module.temperatures + 1)
        )
    async_add_entities(entities)


class GryfTemperature(GryfEntity, SensorEntity):
    _attr_device_class = SensorDeviceClass.TEMPERATURE
    _attr_state_class = SensorStateClass.MEASUREMENT
    _attr_native_unit_of_measurement = UnitOfTemperature.CELSIUS

    def __init__(self, hub, module, channel):
        super().__init__(hub, module, f"temperature_{channel}", f"Temperatura {channel}")
        self.channel = channel

    @property
    def available(self):
        value = self.module_state.temperatures.get(self.channel)
        return super().available and value is not None and time.monotonic() - value[1] <= 60

    @property
    def native_value(self):
        value = self.module_state.temperatures.get(self.channel)
        return value[0] if value else None


class GryfFirmware(GryfEntity, SensorEntity):
    _attr_entity_category = EntityCategory.DIAGNOSTIC
    _attr_icon = "mdi:chip"

    def __init__(self, hub, module):
        super().__init__(hub, module, "firmware", "Firmware")

    @property
    def native_value(self):
        return self.module.firmware
