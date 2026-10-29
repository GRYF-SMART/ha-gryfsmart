"""S0804 covers: firmware percent is 0 closed, 100 open, same as HA."""

from homeassistant.components.cover import (
    CoverDeviceClass,
    CoverEntity,
    CoverEntityFeature,
)

from .entity import GryfEntity


async def async_setup_entry(hass, entry, async_add_entities):
    hub = entry.runtime_data
    async_add_entities(
        GryfCover(hub, module, channel)
        for module in hub.client.modules.values()
        for channel in range(1, module.shutters + 1)
    )


class GryfCover(GryfEntity, CoverEntity):
    _attr_device_class = CoverDeviceClass.SHUTTER
    _attr_supported_features = (
        CoverEntityFeature.OPEN
        | CoverEntityFeature.CLOSE
        | CoverEntityFeature.STOP
        | CoverEntityFeature.SET_POSITION
    )

    def __init__(self, hub, module, channel):
        super().__init__(hub, module, f"cover_{channel}", f"Roleta {channel}")
        self.channel = channel

    @property
    def _status(self):
        return self.module_state.shutters.get(self.channel)

    @property
    def current_cover_position(self):
        return self._status[2] if self._status and self._status[1] else None

    @property
    def is_closed(self):
        value = self.current_cover_position
        return value == 0 if value is not None else None

    @property
    def is_opening(self):
        return self._status[0] == 2 if self._status else None

    @property
    def is_closing(self):
        return self._status[0] == 1 if self._status else None

    async def async_open_cover(self, **kwargs):
        await self.operation(self.hub.client.shutter(self.module.id, self.channel, 1))

    async def async_close_cover(self, **kwargs):
        await self.operation(self.hub.client.shutter(self.module.id, self.channel, 2))

    async def async_stop_cover(self, **kwargs):
        await self.operation(self.hub.client.shutter(self.module.id, self.channel, 3))

    async def async_set_cover_position(self, **kwargs):
        await self.operation(
            self.hub.client.shutter(self.module.id, self.channel, 7, int(kwargs["position"]))
        )
