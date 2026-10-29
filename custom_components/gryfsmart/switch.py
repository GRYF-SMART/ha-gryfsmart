"""Relay outputs."""

from homeassistant.components.switch import SwitchEntity

from .entity import GryfEntity


async def async_setup_entry(hass, entry, async_add_entities):
    hub = entry.runtime_data
    async_add_entities(
        GryfRelay(hub, module, channel)
        for module in hub.client.modules.values()
        for channel in range(1, module.outputs + 1)
    )


class GryfRelay(GryfEntity, SwitchEntity):
    def __init__(self, hub, module, channel):
        super().__init__(hub, module, f"relay_{channel}", f"Wyjście {channel}")
        self.channel = channel

    @property
    def is_on(self):
        return (
            bool(self.module_state.outputs[self.channel - 1])
            if self.module_state.outputs is not None
            else None
        )

    async def async_turn_on(self, **kwargs):
        await self.operation(self.hub.client.relay(self.module.id, self.channel, True))

    async def async_turn_off(self, **kwargs):
        await self.operation(self.hub.client.relay(self.module.id, self.channel, False))
