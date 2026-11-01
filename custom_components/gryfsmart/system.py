"""Registry-backed installation overview and read-only label synchronization."""

from homeassistant.auth.permissions.const import POLICY_READ
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er

from .const import DOMAIN, PLATFORMS
from .names import label

SECTIONS = {
    "switch": "Wyjścia",
    "cover": "Rolety",
    "number": "PWM",
    "binary_sensor": "Wejścia",
    "climate": "Termostaty",
    "event": "Zdarzenia wejść",
    "button": "Narzędzia",
}
ORDER = [
    "Wyjścia",
    "Rolety",
    "PWM",
    "Wejścia",
    "Temperatury",
    "Termostaty",
    "Zdarzenia wejść",
    "Diagnostyka",
    "Narzędzia",
]


def module_entities(hass, entry, hub):
    """Match stable IDs, never mutable display names or entity_id slugs."""
    namespace = entry.unique_id or entry.entry_id
    prefixes = {
        f"{namespace}_{module.model}_{module.id}_": module for module in hub.client.modules.values()
    }
    for entity in er.async_entries_for_config_entry(er.async_get(hass), entry.entry_id):
        if entity.platform != DOMAIN or entity.domain not in PLATFORMS:
            continue
        for prefix, module in prefixes.items():
            if entity.unique_id.startswith(prefix):
                yield entity, module, entity.unique_id[len(prefix) :]
                break


def sync_names(hass, entry, hub):
    """Update integration names without overwriting HA user names or IDs."""
    entities, devices = er.async_get(hass), dr.async_get(hass)
    updated_devices = set()
    for entity, module, key in module_entities(hass, entry, hub):
        name = label(module, key, entity.original_name)
        if name != entity.original_name:
            entities.async_update_entity(entity.entity_id, original_name=name)
        if entity.device_id and entity.device_id not in updated_devices:
            updated_devices.add(entity.device_id)
            device = devices.async_get(entity.device_id)
            if device:
                name = label(module, "module", f"{module.model} ID {module.id}")
                if device.name != name:
                    devices.async_update_device(device.id, name=name)


def system_entities(hass, entries, user):
    """Include all enabled, visible channels, even when their module is offline."""
    devices = dr.async_get(hass)
    result = []
    for entry_id, (entry, hub) in entries.items():
        for entity, module, key in module_entities(hass, entry, hub):
            if (
                entity.disabled_by is not None
                or entity.hidden_by is not None
                or not user.permissions.check_entity(entity.entity_id, POLICY_READ)
            ):
                continue
            device = devices.async_get(entity.device_id) if entity.device_id else None
            module_name = (device.name_by_user if device else None) or label(
                module,
                "module",
                (device.name if device else None) or f"{module.model} ID {module.id}",
            )
            section = SECTIONS.get(entity.domain, "Diagnostyka")
            if key.startswith("temperature_"):
                section = "Temperatury"
            state = hass.states.get(entity.entity_id)
            fallback = (
                entity.original_name
                or (state.attributes.get("friendly_name") if state else None)
                or entity.entity_id
            )
            channel = key.rsplit("_", 1)[-1]
            result.append(
                {
                    "entry": entry_id,
                    "hub": entry.title,
                    "module_id": module.id,
                    "model": module.model,
                    "module": module_name,
                    "entity_id": entity.entity_id,
                    "name": entity.name or label(module, key, fallback),
                    "section": section,
                    "channel": int(channel) if channel.isdigit() else 0,
                }
            )
    result.sort(
        key=lambda item: (
            item["entry"],
            item["module_id"],
            ORDER.index(item["section"]),
            item["channel"],
            item["entity_id"],
        )
    )
    return result
