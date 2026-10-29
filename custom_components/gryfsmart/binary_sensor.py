"""Contact inputs: on means electrically closed."""

from homeassistant.components.binary_sensor import BinarySensorEntity

from .entity import GryfEntity


async def async_setup_entry(hass, entry, async_add_entities):
    hub = entry.runtime_data
    async_add_entities(
        GryfInput(hub, module, channel)
        for module in hub.client.modules.values()
        for channel in range(1, module.inputs + 1)
    )


class GryfInput(GryfEntity, BinarySensorEntity):
    _attr_icon = "mdi:electric-switch"

    def __init__(self, hub, module, channel):
        super().__init__(hub, module, f"input_{channel}", f"Wejście {channel}")
        self.channel = channel

    @property
    def is_on(self):
        return (
            bool(self.module_state.inputs[self.channel - 1])
            if self.module_state.inputs is not None
            else None
        )
