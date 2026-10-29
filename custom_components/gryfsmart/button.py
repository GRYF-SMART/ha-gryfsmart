"""Explicit rescan and explicit EEPROM persistence."""

from homeassistant.components.button import ButtonEntity
from homeassistant.const import EntityCategory

from .entity import GryfEntity


async def async_setup_entry(hass, entry, async_add_entities):
    hub = entry.runtime_data
    modules = list(hub.client.modules.values())
    entities = [GryfRescan(hub, modules[0])]
    entities.extend(GryfSave(hub, module) for module in modules if not module.old)
    async_add_entities(entities)


class GryfSave(GryfEntity, ButtonEntity):
    _attr_entity_category = EntityCategory.CONFIG
    _attr_icon = "mdi:content-save"

    def __init__(self, hub, module):
        super().__init__(hub, module, "save", "Zapisz konfigurację w module")

    async def async_press(self):
        await self.operation(self.hub.client.save(self.module.id))


class GryfRescan(GryfEntity, ButtonEntity):
    _attr_entity_category = EntityCategory.CONFIG
    _attr_icon = "mdi:magnify-scan"

    def __init__(self, hub, module):
        super().__init__(hub, module, "rescan", "Wykryj moduły ponownie")

    @property
    def available(self):
        return True

    async def async_press(self):
        # Schedule after this service call, so unloading its entity is safe.
        self.hass.async_create_task(self.hass.config_entries.async_reload(self.hub.entry.entry_id))
