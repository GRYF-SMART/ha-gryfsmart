"""Read-only EEPROM labels: 18 Polish/ASCII characters; no firmware writes."""
import re
from .protocol import ProtocolError, crc16

POLISH = "ĄĆĘŁŃÓŚŹŻąćęłńóśźż"
MINIMUM = {"ETH0606T": 29, "R0808": 29, "R0806T": 29, "S0804": 30, "R0806T-OLD": 6}


def supported(module):
    return int(module.firmware) >= MINIMUM[module.model]


def keys(module):
    return (["module"] + [f"input_{n}" for n in range(1, module.inputs + 1)]
            + [f"cover_{n}" if module.shutters else f"relay_{n}" for n in range(1, (module.shutters or module.outputs) + 1)]
            + [f"thermostat_{n}" for n in range(1, module.thermostats + 1)]
            + [f"temperature_{n}" for n in range(1, (2 if module.thermostats else 0) + 1)]
            + (["pwm"] if module.pwm else []))


def parse(line, address, slot):
    match = re.fullmatch(r"Name=(\d+),(\d+),([0-9A-F]*),([0-9A-F]{4})", line)
    if not match or int(match[1]) != address or int(match[2]) != slot:
        raise ProtocolError("Invalid EEPROM name address/index/format")
    body = line[5:line.rfind(",")]
    if crc16(body) != int(match[4], 16):
        raise ProtocolError("Invalid EEPROM name CRC")
    try:
        data = bytes.fromhex(match[3])
    except ValueError as error:
        raise ProtocolError("Invalid EEPROM name HEX") from error
    if len(data) > 18:
        raise ProtocolError("EEPROM name exceeds 18 characters")
    result = []
    for value in data:
        if 32 <= value <= 126:
            result.append(chr(value))
        elif 128 <= value <= 145:
            result.append(POLISH[value - 128])
        else:
            raise ProtocolError("Unsupported EEPROM name character")
    return "".join(result)


def label(module, key, fallback):
    if key.startswith("event_"):
        value = module.names.get("input_" + key[6:], "")
        return "Zdarzenia: " + value if value.strip() else fallback
    value = module.names.get(key, "")
    return value if value.strip() else fallback
