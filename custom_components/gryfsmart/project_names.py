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
    return result


def apply_labels(modules, settings):
    for address, module in modules.items():
        record = settings.get(str(address), {})
        if record.get("model") == module.model:
            allowed = keys(module)
            module.names.update({k: v for k, v in record.get("names", {}).items() if k in allowed})
