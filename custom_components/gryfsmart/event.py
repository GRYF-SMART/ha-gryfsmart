"""Contact edges and short/long presses, without replaying initial snapshots."""

from typing import ClassVar

from homeassistant.components.event import EventEntity

from .entity import GryfEntity


async def async_setup_entry(hass, entry, async_add_entities):
    hub = entry.runtime_data
    async_add_entities(
        GryfInputEvent(hub, module, channel)
        for module in hub.client.modules.values()
        for channel in range(1, module.inputs + 1)
    )


class GryfInputEvent(GryfEntity, EventEntity):
    _attr_event_types: ClassVar = ["closed", "opened", "short_press", "long_press"]
    _attr_translation_key = "input_event"
    _attr_icon = "mdi:gesture-tap-button"

    def __init__(self, hub, module, channel):
        super().__init__(hub, module, f"event_{channel}", f"Zdarzenia wejścia {channel}")
        self.channel = channel

    async def async_added_to_hass(self):
        await super().async_added_to_hass()
        self.async_on_remove(self.hub.subscribe_event(self.module.id, self.channel, self._event))

    def _event(self, event):
        self._trigger_event(event)
        self.async_write_ha_state()
