"""Validated project labels, separate from any hardware configuration."""

import unicodedata

from .names import POLISH, keys
from .protocol import ProtocolError


def name_value(value):
    if not isinstance(value, str):
        raise ProtocolError("Nazwa musi być tekstem")
    value = unicodedata.normalize("NFC", value)
    if len(value) > 18 or any(not (32 <= ord(c) <= 126 or c in POLISH) for c in value):
        raise ProtocolError("Nazwa: maks. 18 znaków, polskie litery i znaki ASCII")
    return value


def project_labels(project, modules):
    """Match ID + model; never apply relays, rules or thermostat settings."""
    if not isinstance(project, dict):
        raise ProtocolError("Nieprawidłowy plik projektu")
    project = {k.lower(): v for k, v in project.items()}
    devices = project.get("devices")
    if not isinstance(devices, list) or not 1 <= len(devices) <= 35:
        raise ProtocolError("Projekt musi zawierać 1-35 modułów")
    room_map = None
    if "roomgroups" in project:
        rooms = project["roomgroups"]
        if not isinstance(rooms, list) or len(rooms) > 500:
            raise ProtocolError("Nieprawidłowa lista pomieszczeń")
        room_map = {}
        for room in rooms:
            if not isinstance(room, dict):
                raise ProtocolError("Nieprawidłowe pomieszczenie")
            room = {k.lower(): v for k, v in room.items()}
            rid, title, icon = room.get("id"), room.get("name"), room.get("icon", "🏠")
            if (not isinstance(rid, str) or not 1 <= len(rid) <= 80 or rid in room_map
                    or not isinstance(title, str) or not title.strip() or len(title) > 60
                    or not isinstance(icon, str) or len(icon) > 32):
                raise ProtocolError("Nieprawidłowe ID, nazwa lub ikona pomieszczenia")
            room_map[rid] = {"id": rid, "name": title.strip(), "icon": icon}
    result = {}
    for device in devices:
        if not isinstance(device, dict):
            raise ProtocolError("Nieprawidłowy moduł projektu")
        device = {k.lower(): v for k, v in device.items()}
        address = device.get("id")
        if type(address) is not int or address not in modules or str(address) in result:
            raise ProtocolError("Nieznany lub powtórzony ID w projekcie — wybierz właściwą instalację")
        module = modules[address]
        if device.get("model") != module.model:
            raise ProtocolError(f"ID {address}: model z projektu nie pasuje do instalacji")
        labels = {}
        for field, prefix, count in (
            ("inputnames", "input", module.inputs),
            ("outputnames", "cover" if module.shutters else "relay", module.shutters or module.outputs),
            ("regulatornames", "thermostat", module.thermostats),
            ("temperaturenames", "temperature", 2 if module.thermostats else 0),
        ):
            if field not in device:
                continue  # Older project versions did not store optional labels.
            values = device[field]
            if not isinstance(values, list) or len(values) != count:
                raise ProtocolError(f"ID {address}: nieprawidłowa liczba nazw {field}")
            labels.update({f"{prefix}_{n}": name_value(v) for n, v in enumerate(values, 1)})
        if "name" in device:
            labels["module"] = name_value(device["name"])
        if module.pwm and "pwmname" in device:
            labels["pwm"] = name_value(device["pwmname"])
        result[str(address)] = {"model": module.model, "names": labels}
        if room_map is not None:
            groups = {}
            for field, prefix, count in (
                ("inputgroups", "input", module.inputs),
                ("outputgroups", "cover" if module.shutters else "relay", module.shutters or module.outputs),
                ("thermostatgroups", "thermostat", module.thermostats),
            ):
                assignments = device.get(field) or {}
                if not isinstance(assignments, dict):
                    raise ProtocolError("Nieprawidłowe przypisanie grup")
                for channel, rid in assignments.items():
                    if str(channel) not in {str(n) for n in range(1, count + 1)} or rid not in room_map:
                        raise ProtocolError("Nieznane pomieszczenie lub kanał")
                    groups[f"{prefix}_{channel}"] = room_map[rid]
            rid = device.get("pwmgroup")
            if rid:
                if not module.pwm or rid not in room_map:
                    raise ProtocolError("Nieprawidłowa grupa PWM")
                groups["pwm"] = room_map[rid]
            result[str(address)]["groups"] = groups
    return result


def apply_labels(modules, settings):
    for address, module in modules.items():
        record = settings.get(str(address), {})
        if record.get("model") == module.model:
            allowed = keys(module)
            module.names.update({k: v for k, v in record.get("names", {}).items() if k in allowed})
