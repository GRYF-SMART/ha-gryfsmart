"""Admin-only custom panel and authenticated, bounded rule-edit sessions."""

import asyncio
import copy
import secrets
import time
from pathlib import Path

import voluptuous as vol
from homeassistant.components import frontend, panel_custom, websocket_api
from homeassistant.components.http import StaticPathConfig

from .const import VERSION
from .project_names import name_value, project_labels
from .protocol import ProtocolError
from .system import system_entities

KEY = "gryfsmart_config_panel"
PATH = "gryfsmart-config"


async def register(hass, entry, hub):
    state = hass.data.setdefault(
        KEY,
        {
            "entries": {},
            "snapshots": {},
            "registered": False,
            "visible": False,
            "lock": asyncio.Lock(),
            "names_lock": asyncio.Lock(),
        },
    )
    async with state["lock"]:
        if not state["registered"]:
            await hass.http.async_register_static_paths(
                [
                    StaticPathConfig(
                        "/gryfsmart-panel", str(Path(__file__).parent / "frontend"), False
                    )
                ]
            )
            await hass.http.async_register_static_paths(
                [
                    StaticPathConfig(
                        "/gryfsmart-system", str(Path(__file__).parent / "frontend"), False
                    )
                ]
            )
            frontend.add_extra_js_url(hass, f"/gryfsmart-system/system-card.js?v={VERSION}")
            frontend.add_extra_js_url(hass, f"/gryfsmart-system/thermostat-card.js?v={VERSION}")
            frontend.add_extra_js_url(hass, f"/gryfsmart-system/door-card.js?v={VERSION}")
            frontend.add_extra_js_url(hass, f"/gryfsmart-system/gate-card.js?v={VERSION}")
            frontend.add_extra_js_url(hass, f"/gryfsmart-system/room-card.js?v={VERSION}")
            frontend.add_extra_js_url(hass, f"/gryfsmart-system/home-card.js?v={VERSION}")
            websocket_api.async_register_command(hass, config_command)
            websocket_api.async_register_command(hass, system_entities_command)
            websocket_api.async_register_command(hass, refresh_names_command)
            websocket_api.async_register_command(hass, names_command)
            state["registered"] = True
        state["entries"][entry.entry_id] = (entry, hub)
        if not state["visible"]:
            await panel_custom.async_register_panel(
                hass,
                frontend_url_path=PATH,
                webcomponent_name="gryfsmart-config",
                sidebar_title="GRYFSMART — Konfiguracja",
                sidebar_icon="mdi:cog-transfer",
                module_url=f"/gryfsmart-panel/panel.js?v={VERSION}",
                require_admin=True,
            )
            state["visible"] = True


def unregister(hass, entry):
    state = hass.data.get(KEY)
    if not state:
        return
    state["entries"].pop(entry.entry_id, None)
    state["snapshots"] = {t: s for t, s in state["snapshots"].items() if s[1] != entry.entry_id}
    if not state["entries"] and state["visible"]:
        frontend.async_remove_panel(hass, PATH)
        state["visible"] = False


@websocket_api.websocket_command(
    {
        vol.Required("type"): "gryfsmart/config",
        vol.Required("action"): vol.In(["modules", "read", "save"]),
        vol.Optional("entry"): str,
        vol.Optional("module"): vol.All(int, vol.Range(min=1, max=35)),
        vol.Optional("rule"): vol.All(int, vol.Range(min=1, max=16)),
        vol.Optional("token"): str,
        vol.Optional("configuration"): dict,
    }
)
@websocket_api.async_response
async def config_command(hass, connection, message):
    if not connection.user.is_admin:
        connection.send_error(message["id"], "unauthorized", "Konfiguracja wymaga administratora")
        return
    state = hass.data.get(KEY)
    if not state:
        connection.send_error(message["id"], "not_ready", "Integracja nie jest gotowa")
        return
    try:
        action = message["action"]
        if action == "modules":
            result = [
                {
                    "entry": entry_id,
                    "title": entry.title,
                    "modules": [
                        {
                            "id": m.id,
                            "model": m.model,
                            "firmware": m.firmware,
                            "inputs": m.inputs,
                            "outputs": m.outputs,
                            "shutters": m.shutters,
                            "pwm": m.pwm,
                            "temperature": bool(m.thermostats),
                            "editable": not m.old,
                        }
                        for m in hub.client.modules.values()
                    ],
                }
                for entry_id, (entry, hub) in state["entries"].items()
            ]
        else:
            entry_id, address, number = message["entry"], message["module"], message["rule"]
            _, hub = state["entries"][entry_id]
            now = time.monotonic()
            snapshots = state["snapshots"]
            for token in list(snapshots):
                if now - snapshots[token][0] > 600:
                    snapshots.pop(token)
            if action == "read":
                rule = await hub.client.read_rule(address, number)
                # Each admin may keep one bounded snapshot per module/rule.
                for token, snapshot in list(snapshots.items()):
                    if snapshot[1:5] == (entry_id, address, number, connection.user.id):
                        snapshots.pop(token)
                token = secrets.token_urlsafe(24)
                if len(snapshots) >= 256:
                    snapshots.pop(next(iter(snapshots)))
                snapshots[token] = (
                    now,
                    entry_id,
                    address,
                    number,
                    connection.user.id,
                    copy.deepcopy(rule),
                    hub,
                )
                result = {"configuration": rule, "token": token}
            else:
                snapshot = snapshots.pop(message["token"], None)
                if (
                    snapshot is None
                    or snapshot[1:5] != (entry_id, address, number, connection.user.id)
                    or snapshot[6] is not hub
                ):
                    raise ProtocolError("Odczytaj regułę ponownie przed zapisem")
                result = {
                    "configuration": await hub.client.write_rule(
                        address, number, message["configuration"], snapshot[5]
                    )
                }
        connection.send_result(message["id"], result)
    except (KeyError, ValueError, ProtocolError, OSError, TimeoutError) as error:
        connection.send_error(message["id"], "configuration_error", str(error))


@websocket_api.websocket_command({vol.Required("type"): "gryfsmart/system_entities"})
@websocket_api.async_response
async def system_entities_command(hass, connection, message):
    """Return registered channels without querying hardware on dashboard refresh."""
    state = hass.data.get(KEY)
    if not state:
        connection.send_error(message["id"], "not_ready", "Integracja nie jest gotowa")
        return
    connection.send_result(message["id"], system_entities(hass, state["entries"], connection.user))


@websocket_api.websocket_command({vol.Required("type"): "gryfsmart/refresh_names"})
@websocket_api.async_response
async def refresh_names_command(hass, connection, message):
    """Explicit, serialized EEPROM reads; never write names or configuration."""
    if not connection.user.is_admin:
        connection.send_error(message["id"], "unauthorized", "Odczyt nazw wymaga administratora")
        return
    state = hass.data.get(KEY)
    if not state or not state["entries"]:
        connection.send_error(message["id"], "not_ready", "Integracja nie jest gotowa")
        return
    if state["names_lock"].locked():
        connection.send_error(message["id"], "busy", "Odczyt nazw już trwa")
        return
    errors = []
    try:
        async with state["names_lock"], asyncio.timeout(120):
            for entry, hub in list(state["entries"].values()):
                if not hub.client.connected:
                    errors.append(f"{entry.title}: brak połączenia")
                    continue
                errors.extend(await hub.refresh_names())
        connection.send_result(message["id"], {"errors": errors})
    except (OSError, TimeoutError, ProtocolError) as error:
        connection.send_error(message["id"], "read_failed", f"Nie ukończono odczytu nazw: {error}")


@websocket_api.websocket_command({
    vol.Required("type"): "gryfsmart/names",
    vol.Required("action"): vol.In(["list", "import", "rename"]),
    vol.Optional("entry"): str,
    vol.Optional("project"): dict,
    vol.Optional("module"): vol.All(int, vol.Range(min=1, max=35)),
    vol.Optional("channel"): vol.In([1, 2]),
    vol.Optional("name"): str,
})
@websocket_api.async_response
async def names_command(hass, connection, message):
    if not connection.user.is_admin:
        connection.send_error(message["id"], "unauthorized", "Zmiana nazw wymaga administratora")
        return
    state = hass.data.get(KEY)
    if not state or not state["entries"]:
        connection.send_error(message["id"], "not_ready", "Integracja nie jest gotowa")
        return
    try:
        action = message["action"]
        if action == "list":
            result = [{"entry": entry_id, "title": entry.title, "modules": [
                {"id": m.id, "model": m.model, "names": m.names, "thermostats": m.thermostats}
                for m in hub.client.modules.values()]
            } for entry_id, (entry, hub) in state["entries"].items()]
        else:
            _, hub = state["entries"][message["entry"]]
            if action == "import":
                updates = project_labels(message["project"], hub.client.modules)
            else:
                module = hub.client.modules[message["module"]]
                if not module.thermostats:
                    raise ProtocolError("Moduł nie ma regulatorów")
                updates = {str(module.id): {"model": module.model, "names": {
                    f"thermostat_{message['channel']}": name_value(message["name"])
                }}}
            await hub.save_names(updates)
            result = {"count": sum(len(record["names"]) for record in updates.values())}
        connection.send_result(message["id"], result)
    except (KeyError, ValueError, TypeError, ProtocolError, OSError) as error:
        connection.send_error(message["id"], "names_error", str(error))
