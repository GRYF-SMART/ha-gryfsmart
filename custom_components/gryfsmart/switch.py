"""Relay outputs."""

import voluptuous as vol
from homeassistant.components.switch import SwitchEntity
from homeassistant.helpers import entity_platform, service

from .entity import GryfEntity


async def async_setup_entry(hass, entry, async_add_entities):
    if not hasattr(service, "async_register_platform_entity_service"):
        entity_platform.async_get_current_platform().async_register_entity_service(
            "pulse",
            {vol.Required("duration"): vol.All(vol.Coerce(float), vol.Range(min=0.1, max=60))},
            "async_pulse",
        )
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

    async def async_pulse(self, duration):
        await self.operation(self.hub.client.pulse(self.module.id, self.channel, duration))
