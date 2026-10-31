"""Shared device identity and push updates."""

from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.entity import DeviceInfo, Entity

from .const import DOMAIN
from .names import label
from .protocol import ProtocolError


class GryfEntity(Entity):
    _attr_has_entity_name = True
    _attr_should_poll = False

    def __init__(self, hub, module, key, name):
        self.hub, self.module = hub, module
        namespace = hub.entry.unique_id or hub.entry.entry_id
        identifier = f"{namespace}_{module.model}_{module.id}"
        self._attr_unique_id = f"{identifier}_{key}"
        self._name_key, self._fallback_name = key, name
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, identifier)},
            name=label(module, "module", f"{module.model} ID {module.id}"),
            manufacturer="GRYFSMART",
            model=module.model,
            sw_version=module.firmware,
        )

    @property
    def name(self):
        return label(self.module, self._name_key, self._fallback_name)

    @property
    def module_state(self):
        return self.hub.client.store.states[self.module.id]

    @property
    def available(self):
        return self.hub.client.connected and self.module_state.online

    async def async_added_to_hass(self):
        await super().async_added_to_hass()
        self.async_on_remove(self.hub.subscribe(self.async_write_ha_state))

    async def operation(self, awaitable):
        try:
            await awaitable
        except (OSError, TimeoutError, ProtocolError) as error:
            raise HomeAssistantError(str(error)) from error
