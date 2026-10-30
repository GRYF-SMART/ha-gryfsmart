"""Validated, model-aware rule snapshots and one-rule write plans."""

import copy

from .protocol import ProtocolError, checked, csv


def integer(value, low, high):
    if type(value) is not int or not low <= value <= high:
        raise ProtocolError(f"Wymagana liczba całkowita {low}-{high}")
    return value


def vector(values, count, low, high):
    if not isinstance(values, list) or len(values) != count:
        raise ProtocolError("Nieprawidłowa liczba pól reguły")
    return [integer(v, low, high) for v in values]


def validate(module, number, rule, modules):
    integer(number, 1, 16)
    if module.old:
        raise ProtocolError("OLD nie udostępnia odczytu reguł; użyj GRYFEXPERT")
    if not isinstance(rule, dict) or set(rule) != {
        "enabled",
        "events",
        "actions",
        "positions",
        "slots",
        "pwm",
        "temperature",
    }:
        raise ProtocolError("Nieprawidłowa struktura reguły")
    r = copy.deepcopy(rule)
    integer(r["enabled"], 0, 1)
    vector(r["events"], module.inputs, 0, 15)
    count = module.shutters or module.outputs
    vector(r["actions"], count, 0, 7 if module.shutters else 3)
    vector(r["positions"], count, 0, 100)
    if any(
        p and (not module.shutters or a != 7)
        for a, p in zip(r["actions"], r["positions"], strict=True)
    ):
        raise ProtocolError("Pozycja jest dostępna tylko dla akcji Ustaw pozycję")
    if module.pwm:
        vector(r["pwm"], 3, 0, 100)
        a, percent, ramp = r["pwm"]
        if a > 4 or ramp > 50 or (a != 4 and percent):
            raise ProtocolError("Nieprawidłowa akcja PWM lub rampa")
    elif r["pwm"] is not None:
        raise ProtocolError("Moduł nie ma lokalnego PWM")
    if module.thermostats:
        t = r["temperature"]
        if not isinstance(t, list) or len(t) != 7:
            raise ProtocolError("Nieprawidłowy wyzwalacz temperatury")
        for v, bounds in zip(
            t, [(0, 2), (0, 35), (1, 2), (0, 1), (-550, 1250), (1, 200), (0, 65535)], strict=True
        ):
            integer(v, *bounds)
        if t[0] == 2 and t[6] < 1:
            raise ProtocolError("Okres wyzwalania musi wynosić co najmniej 0,1 s")
    elif r["temperature"] is not None:
        raise ProtocolError("Moduł nie ma wyzwalacza temperatury")
    if not isinstance(r["slots"], list) or len(r["slots"]) != 4:
        raise ProtocolError("Wymagane cztery sloty")
    targets = set()
    for slot in r["slots"]:
        if not isinstance(slot, dict) or set(slot) != {"target", "type", "data"}:
            raise ProtocolError("Nieprawidłowy slot")
        target, kind, data = slot["target"], slot["type"], slot["data"]
        integer(kind, 0, 5)
        vector(data, [0, 8, 6, 8, 3, 4][kind], 0, 255)
        if not kind:
            if target != 0:
                raise ProtocolError("Pusty slot ma mieć ID 0")
            continue
        integer(target, 1, 35)
        if target == module.id and (kind != 5 or module.shutters):
            raise ProtocolError("Do własnego modułu użyj akcji lokalnej")
        peer = modules.get(target)
        if kind == 1:
            if any(
                a > 7 or p > 100 or (a != 7 and p)
                for a, p in zip(data[::2], data[1::2], strict=True)
            ) or (peer and not peer.shutters):
                raise ProtocolError("Nieprawidłowe sterowanie roletą")
        elif kind in (2, 3):
            if any(v > 3 for v in data) or (peer and (peer.shutters or peer.outputs != len(data))):
                raise ProtocolError("Nieprawidłowe sterowanie przekaźnikami")
        elif kind == 4:
            if (
                data[0] > 4
                or data[1] > 100
                or data[2] > 50
                or (data[0] != 4 and data[1])
                or (peer and not peer.pwm)
            ):
                raise ProtocolError("Nieprawidłowe sterowanie PWM")
        elif (
            data[0] < 1
            or data[0] > (peer.outputs if peer else 8)
            or data[3] > 1
            or (peer and peer.shutters)
        ):
            raise ProtocolError("Nieprawidłowy impuls czasowy")
        key = target, kind == 4
        if key in targets:
            raise ProtocolError("Powtórzony cel slotu; połącz akcje w jednym slocie")
        targets.add(key)
    return r


def rule_command(module, number, r, enabled=None):
    values = [module.id, number, r["enabled"] if enabled is None else enabled, *r["events"]]
    for action, position in zip(r["actions"], r["positions"], strict=True):
        values.append(action)
        if module.shutters:
            values.append(position)
    return csv("Rule", *values)


def write_plan(module, number, r):
    commands = [rule_command(module, number, r, 0), csv("RuleRemote", module.id, number, 0, 0, 0)]
    for index, slot in enumerate(r["slots"], 1):
        kind, target, data = slot["type"], slot["target"], slot["data"]
        if kind == 5:
            commands.append(
                csv(
                    "RulePulse",
                    module.id,
                    number,
                    index,
                    target,
                    data[0],
                    data[1] | data[2] << 8,
                    data[3],
                )
            )
        elif kind:
            commands.append(csv("RuleRemote", module.id, number, index, target, kind, *data))
    if module.pwm:
        commands.append(csv("RulePWM", module.id, number, *r["pwm"]))
    if module.thermostats:
        commands.append(csv("RuleTemp", module.id, number, *r["temperature"]))
    commands.append(rule_command(module, number, r))
    return commands


async def read_rule(client, module, number):
    integer(number, 1, 16)
    if module.old:
        raise ProtocolError("OLD nie udostępnia odczytu reguł")

    async def get(name, *args):
        prefix = f"{name}={module.id},{number}," + (f"{args[0]}," if name == "RuleRemote" else "")
        line = await client.request(
            csv("Get" + name, module.id, number, *args), lambda s: s.startswith(prefix)
        )
        values = checked(line.split("=", 1)[1])
        return values[2:]

    values = await get("Rule")
    count = module.shutters or module.outputs
    if len(values) != 1 + module.inputs + count * (2 if module.shutters else 1):
        raise ProtocolError("Nieprawidłowa odpowiedź Rule")
    local = values[1 + module.inputs :]
    result = {
        "enabled": values[0],
        "events": values[1 : 1 + module.inputs],
        "actions": local[::2] if module.shutters else local,
        "positions": local[1::2] if module.shutters else [0] * count,
        "slots": [],
        "pwm": None,
        "temperature": None,
    }
    for index in range(1, 5):
        v = await get("RuleRemote", index)
        if len(v) < 3 or v[0] != index:
            raise ProtocolError("Nieprawidłowa odpowiedź slotu")
        result["slots"].append({"target": v[1], "type": v[2], "data": v[3:]})
    if module.pwm:
        result["pwm"] = await get("RulePWM")
    if module.thermostats:
        result["temperature"] = await get("RuleTemp")
    return validate(module, number, result, client.modules)
