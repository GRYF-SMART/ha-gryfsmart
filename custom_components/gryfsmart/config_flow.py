"""Configure the connection from the Home Assistant UI."""

import uuid

import voluptuous as vol
from homeassistant import config_entries
from homeassistant.core import callback
from homeassistant.helpers import selector

from .client import GryfClient
from .const import DEFAULT_PORT, DOMAIN
from .protocol import IncompatibleFirmware, ProtocolError


async def validate(settings):
    client = GryfClient(settings)
    try:
        await client.connect()
        module = await client.identity()
        return module, client.gateway_mac
    finally:
        await client.close()


def schema(connection, defaults=None, ports=None):
    defaults = defaults or {}
    if connection == "ethernet":
        return vol.Schema(
            {
                vol.Required("host", default=defaults.get("host", "192.168.1.200")): str,
                vol.Required("port", default=defaults.get("port", DEFAULT_PORT)): vol.All(
                    vol.Coerce(int), vol.Range(min=1, max=65535)
                ),
            }
        )
    return vol.Schema(
        {
            vol.Required("device", default=defaults.get("device", "")): selector.SelectSelector(
                selector.SelectSelectorConfig(
                    options=ports or [],
                    custom_value=True,
                    mode=selector.SelectSelectorMode.DROPDOWN,
                )
            )
        }
    )


async def serial_ports(hass):
    def enumerate_ports():
        from serial.tools.list_ports import comports

        return [
            {"value": item.device, "label": f"{item.device} — {item.description}"}
            for item in comports()
        ]

    return await hass.async_add_executor_job(enumerate_ports)


class GryfConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    VERSION = 1

    async def async_step_user(self, user_input=None):
        return self.async_show_menu(step_id="user", menu_options=["ethernet", "serial"])

    async def async_step_ethernet(self, user_input=None):
        return await self._connection("ethernet", user_input)

    async def async_step_serial(self, user_input=None):
        return await self._connection("serial", user_input)

    async def _connection(self, connection, user_input):
        errors = {}
        if user_input is not None:
            settings = dict(user_input, connection=connection)
            try:
                for entry in self._async_current_entries():
                    existing = dict(entry.data) | dict(entry.options)
                    key = "host" if connection == "ethernet" else "device"
                    if (
                        existing.get("connection") == connection
                        and existing.get(key) == settings.get(key)
                        and (
                            connection != "ethernet"
                            or existing.get("port", DEFAULT_PORT) == settings["port"]
                        )
                    ):
                        return self.async_abort(reason="already_configured")
                _, mac = await validate(settings)
                if mac:
                    await self.async_set_unique_id("mac_" + mac.replace(":", ""))
                    self._abort_if_unique_id_configured()
                    settings["gateway_mac"] = mac
                else:
                    await self.async_set_unique_id(uuid.uuid4().hex)
                label = settings.get("host") or settings.get("device")
                return self.async_create_entry(title=f"GRYFSMART {label}", data=settings)
            except IncompatibleFirmware:
                errors["base"] = "firmware_required"
            except (OSError, TimeoutError, ProtocolError):
                errors["base"] = "cannot_connect"
        ports = await serial_ports(self.hass) if connection == "serial" else None
        return self.async_show_form(
            step_id=connection, data_schema=schema(connection, user_input, ports), errors=errors
        )

    @staticmethod
    @callback
    def async_get_options_flow(config_entry):
        return GryfOptionsFlow()


class GryfOptionsFlow(config_entries.OptionsFlow):
    async def async_step_init(self, user_input=None):
        return self.async_show_menu(step_id="init", menu_options=["ethernet", "serial"])

    async def async_step_ethernet(self, user_input=None):
        return await self._connection("ethernet", user_input)

    async def async_step_serial(self, user_input=None):
        return await self._connection("serial", user_input)

    async def _connection(self, connection, user_input):
        errors = {}
        defaults = dict(self.config_entry.data) | dict(self.config_entry.options)
        if user_input is not None:
            settings = dict(user_input, connection=connection)
            try:
                _, mac = await validate(settings)
                previous = defaults.get("gateway_mac")
                if previous and mac and previous != mac:
                    errors["base"] = "wrong_gateway"
                else:
                    settings["gateway_mac"] = mac
                    return self.async_create_entry(title="", data=settings)
            except IncompatibleFirmware:
                errors["base"] = "firmware_required"
            except (OSError, TimeoutError, ProtocolError):
                errors["base"] = "cannot_connect"
        ports = await serial_ports(self.hass) if connection == "serial" else None
        return self.async_show_form(
            step_id=connection,
            data_schema=schema(connection, user_input or defaults, ports),
            errors=errors,
        )
