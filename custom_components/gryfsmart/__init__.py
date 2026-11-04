"""GRYFSMART local Ethernet and RS-232 integration."""

import asyncio
import logging
import time
from contextlib import suppress

import voluptuous as vol
from homeassistant.exceptions import ConfigEntryNotReady
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers import service
from homeassistant.helpers.storage import Store

from .client import GryfClient
from .const import DOMAIN, PLATFORMS
from .panel import register, unregister
from .project_names import apply_labels
from .protocol import ProtocolError
from .system import sync_names

_LOGGER = logging.getLogger(__name__)
CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)


async def async_setup(hass, config):
    if hasattr(service, "async_register_platform_entity_service"):
        service.async_register_platform_entity_service(
            hass, DOMAIN, "pulse", entity_domain="switch",
            schema={vol.Required("duration"): vol.All(vol.Coerce(float), vol.Range(min=0.1, max=60))},
            func="async_pulse",
        )
    return True


class GryfHub:
    def __init__(self, hass, entry):
        self.hass, self.entry = hass, entry
        self.listeners, self.event_listeners = set(), {}
        self.client = GryfClient(dict(entry.data) | dict(entry.options), self.changed, self.event)
        self.task = None
        self.names_lock = asyncio.Lock()
        self.name_store = Store(hass, 1, f"gryfsmart_names_{entry.entry_id}")
        self.saved_names = {}

    def changed(self):
        for listener in tuple(self.listeners):
            listener()

    def event(self, address, channel, event):
        for listener in tuple(self.event_listeners.get((address, channel), ())):
            listener(event)

    def subscribe(self, listener):
        self.listeners.add(listener)
        return lambda: self.listeners.discard(listener)

    def subscribe_event(self, address, channel, listener):
        listeners = self.event_listeners.setdefault((address, channel), set())
        listeners.add(listener)
        return lambda: listeners.discard(listener)

    async def start(self):
        self.saved_names = await self.name_store.async_load() or {}
        await self.client.connect()
        await self.client.discover()
        await self.refresh_names()
        await self.client.refresh()

    async def refresh_names(self):
        async with self.names_lock:
            errors = await self.client.read_names()
            apply_labels(self.client.modules, self.saved_names)
            sync_names(self.hass, self.entry, self)
            self.changed()
            return errors

    async def save_names(self, updates):
        async with self.names_lock:
            merged = {key: {"model": value["model"], "names": dict(value["names"]), "groups": dict(value.get("groups", {}))}
                      for key, value in self.saved_names.items()}
            for address, record in updates.items():
                old = merged.get(address, {})
                names = dict(old.get("names", {})) if old.get("model") == record["model"] else {}
                names.update(record["names"])
                groups = record.get("groups", old.get("groups", {}) if old.get("model") == record["model"] else {})
                merged[address] = {"model": record["model"], "names": names, "groups": groups}
            await self.name_store.async_save(merged)
            self.saved_names = merged
            apply_labels(self.client.modules, merged)
            sync_names(self.hass, self.entry, self)
            self.changed()

    async def run(self):
        """Poll independently of push traffic; refresh moving covers every second."""
        next_poll, reconnect_delay = time.monotonic() + 30, 2
        try:
            while True:
                await asyncio.sleep(1)
                try:
                    if not self.client.connected:
                        await self.client.connect()
                        direct = await self.client.identity()
                        expected = self.client.modules.get(direct.id)
                        if expected is None or expected.model != direct.model:
                            raise ProtocolError("Connected network changed; rescan modules")
                        saved_mac = self.client.settings.get("gateway_mac")
                        if saved_mac and self.client.gateway_mac != saved_mac:
                            raise ProtocolError("Gateway MAC changed")
                        await self.refresh_names()
                        await self.client.refresh()
                        next_poll, reconnect_delay = time.monotonic() + 30, 2
                    if time.monotonic() >= next_poll:
                        await self.client.refresh()
                        next_poll = time.monotonic() + 30
                    details = set(self.client.details)
                    for address, state in self.client.store.states.items():
                        details.update(
                            (address, channel)
                            for channel, status in state.shutters.items()
                            if status[0] or status[4]
                        )
                    for address, channel in details:
                        try:
                            await self.client.read_shutter(address, channel)
                        except (TimeoutError, ProtocolError):
                            self.client.details.discard((address, channel))
                    # Also expire temperature availability without incoming frames.
                    self.changed()
                except (OSError, TimeoutError, ProtocolError) as error:
                    _LOGGER.debug("GRYFSMART reconnect: %s", error)
                    await self.client.close()
                    self.changed()
                    await asyncio.sleep(reconnect_delay)
                    reconnect_delay = min(reconnect_delay * 2, 30)
        except asyncio.CancelledError:
            pass

    async def stop(self):
        if self.task:
            self.task.cancel()
            with suppress(asyncio.CancelledError):
                await self.task
        await self.client.close()


async def async_setup_entry(hass, entry):
    hub = GryfHub(hass, entry)
    try:
        await hub.start()
    except (OSError, TimeoutError, ProtocolError) as error:
        await hub.stop()
        raise ConfigEntryNotReady(str(error)) from error
    entry.runtime_data = hub
    try:
        await register(hass, entry, hub)
        await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    except Exception:
        unregister(hass, entry)
        await hub.stop()
        raise
    entry.async_on_unload(entry.add_update_listener(_reload))
    # A background task does not hold HA startup open for this permanent loop.
    hub.task = entry.async_create_background_task(hass, hub.run(), "gryfsmart-monitor")
    return True


async def _reload(hass, entry):
    await hass.config_entries.async_reload(entry.entry_id)


async def async_unload_entry(hass, entry):
    if await hass.config_entries.async_unload_platforms(entry, PLATFORMS):
        unregister(hass, entry)
        await entry.runtime_data.stop()
        return True
    return False
