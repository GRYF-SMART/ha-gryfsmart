"""GRYFSMART local Ethernet and RS-232 integration."""

import asyncio
import logging
import time
from contextlib import suppress

from homeassistant.exceptions import ConfigEntryNotReady

from .client import GryfClient
from .const import PLATFORMS
from .panel import register, unregister
from .protocol import ProtocolError

_LOGGER = logging.getLogger(__name__)


class GryfHub:
    def __init__(self, hass, entry):
        self.hass, self.entry = hass, entry
        self.listeners, self.event_listeners = set(), {}
        self.client = GryfClient(dict(entry.data) | dict(entry.options), self.changed, self.event)
        self.task = None

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
        await self.client.connect()
        await self.client.discover()
        await self.client.refresh()

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
