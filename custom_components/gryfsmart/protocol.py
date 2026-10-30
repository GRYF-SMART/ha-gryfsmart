"""GRYFSMART framing, validation and state. No Home Assistant dependencies."""

import re
import time
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation

from .const import PROFILES


class ProtocolError(Exception):
    """Invalid or rejected protocol operation."""


class IncompatibleFirmware(ProtocolError):
    """A module must be updated before integration setup."""


@dataclass
class Module:
    id: int
    model: str
    firmware: str
    position: int = 0

    def __post_init__(self):
        if self.model not in PROFILES or not 1 <= self.id <= 35:
            raise ProtocolError("Invalid model or module address")
        # The four-digit 0xxx series predates the common numbering.
        if (
            not self.firmware.isdecimal()
            or self.firmware.startswith("0")
            or int(self.firmware) < PROFILES[self.model][4]
        ):
            raise IncompatibleFirmware(
                f"{self.model} ID {self.id}: firmware {self.firmware}; minimum {PROFILES[self.model][4]}"
            )

    @property
    def inputs(self):
        return PROFILES[self.model][0]

    @property
    def outputs(self):
        return PROFILES[self.model][1]

    @property
    def shutters(self):
        return PROFILES[self.model][2]

    @property
    def temperatures(self):
        return PROFILES[self.model][3]

    @property
    def thermostats(self):
        return 2 if self.model in ("R0808", "R0806T") else 0

    @property
    def pwm(self):
        return self.model == "R0806T"

    @property
    def old(self):
        return self.model == "R0806T-OLD"


def find(line):
    match = re.fullmatch(r"AT\+Find=(\d+),(\d+),([A-Za-z0-9-]+)", line, re.IGNORECASE)
    return Module(int(match[1]), match[3].upper(), match[2]) if match else None


def crc16(text):
    value = 0xFFFF
    for byte in text.encode("ascii"):
        value ^= byte << 8
        for _ in range(8):
            value = ((value << 1) ^ (0x1021 if value & 0x8000 else 0)) & 0xFFFF
    return value


def chain(line, sequence, position):
    match = re.fullmatch(r"Chain=([^*]+)\*([0-9a-fA-F]{4})", line)
    if not match or crc16(match[1]) != int(match[2], 16):
        raise ProtocolError("Invalid CHAIN1 CRC")
    fields = match[1].split(",", 2)
    if len(fields) != 3 or fields[:2] != [sequence, "OK"]:
        raise ProtocolError("CHAIN1 error: " + line)
    payload = fields[2].split(";")
    if len(payload) < 9 or payload[3] != "APP" or payload[-1] != "CHAIN1":
        raise ProtocolError("Module is not running a supported application")
    return Module(int(payload[2]), payload[0], payload[1], position)


def csv(name, *values):
    return f"AT+{name}=" + ",".join(str(v) for v in (*values, sum(values)))


def numbers(text):
    fields = text.split(",")
    if len(fields) > 24 or any(not re.fullmatch(r"-?\d{1,6}", v) for v in fields):
        raise ProtocolError("Invalid numeric fields")
    return [int(v) for v in fields]


def checked(text):
    values = numbers(text)
    if len(values) < 3 or sum(values[:-1]) != values[-1]:
        raise ProtocolError("Invalid response checksum")
    return values[:-1]


@dataclass(frozen=True)
class ThermostatConfig:
    mode: int
    cooling: int
    source: int
    sensor: int
    setpoint: int
    hysteresis: int
    outputs: tuple[tuple[int, int, int], ...]

    def validate(self):
        if (
            self.mode not in (0, 1)
            or self.cooling not in (0, 1)
            or not 0 <= self.source <= 35
            or self.sensor not in (1, 2)
            or not -550 <= self.setpoint <= 1250
            or not 1 <= self.hysteresis <= 200
            or len(self.outputs) > 4
            or (self.mode and not self.outputs)
        ):
            raise ProtocolError(
                "Invalid thermostat configuration; configure its sensor and outputs in GRYFEXPERT first"
            )
        for address, kind, output in self.outputs:
            if (
                not 0 <= address <= 35
                or kind not in (2, 3)
                or not 1 <= output <= (6 if kind == 2 else 8)
            ):
                raise ProtocolError("Invalid thermostat output")

    def command(self, address, channel):
        self.validate()
        values = [
            address,
            channel,
            self.mode,
            self.cooling,
            self.source,
            self.sensor,
            self.setpoint,
            self.hysteresis,
            len(self.outputs),
        ]
        for output in self.outputs:
            values.extend(output)
        return csv("SetTemp", *values)


@dataclass
class ModuleState:
    inputs: list[int] | None = None
    outputs: list[int] | None = None
    shutters: dict[int, tuple] = field(default_factory=dict)
    temperatures: dict[int, tuple[float, float]] = field(default_factory=dict)
    configs: dict[int, ThermostatConfig] = field(default_factory=dict)
    thermostats: dict[int, tuple] = field(default_factory=dict)
    pwm: tuple[int, int, int, int, int] | None = None
    last_seen: float = 0
    online: bool = False


class StateStore:
    """Use only validated reports; first input snapshot is never a contact event."""

    def __init__(self, modules):
        self.modules = modules
        self.states = {address: ModuleState() for address in modules}

    def apply(self, line):
        """Return (module ID, input events, shutters needing detailed queries)."""
        try:
            return self._apply(line)
        except (ValueError, IndexError, InvalidOperation, ProtocolError):
            return None

    def _apply(self, line):
        prefix, separator, text = line.partition("=")
        if not separator or prefix not in (
            "I",
            "O",
            "o",
            "R",
            "RolState",
            "T",
            "PS",
            "PL",
            "TEMP",
            "THERM",
            "PWM",
        ):
            return None
        values = numbers(text)
        address = values[0]
        if address not in self.modules:
            return None
        module, state = self.modules[address], self.states[address]
        events, details = [], []
        if prefix in ("I", "O", "o"):
            count = module.inputs if prefix == "I" else module.outputs
            if not count or len(values) != count + 1 or any(v not in (0, 1) for v in values[1:]):
                return None
            if prefix == "I":
                if state.inputs is not None:
                    events = [
                        (i + 1, "closed" if after else "opened")
                        for i, (before, after) in enumerate(
                            zip(state.inputs, values[1:], strict=True)
                        )
                        if before != after
                    ]
                state.inputs = values[1:]
            else:
                state.outputs = values[1:]
        elif prefix in ("PS", "PL"):
            if len(values) != 2 or not 1 <= values[1] <= module.inputs:
                return None
            events = [(values[1], "short_press" if prefix == "PS" else "long_press")]
        elif prefix == "R":
            if (
                not module.shutters
                or len(values) != 5
                or any(v not in range(4) for v in values[1:])
            ):
                return None
            for channel, movement in enumerate(values[1:], 1):
                old = state.shutters.get(channel)
                if old is None or old[0] != movement:
                    state.shutters[channel] = (movement, 0, 255, 255, 0)
                    details.append(channel)
        elif prefix == "RolState":
            values = checked(text)
            if not module.shutters or len(values) != 7:
                return None
            _, channel, movement, known, position, target, remaining = values
            if (
                channel not in range(1, 5)
                or movement not in range(4)
                or known not in (0, 1)
                or (not 0 <= position <= 100 if known else position != 255)
                or target not in (*range(101), 255)
                or not 0 <= remaining <= 65535
            ):
                return None
            state.shutters[channel] = tuple(values[2:])
        elif prefix == "PWM":
            if (
                not module.pwm
                or len(values) != 6
                or any(not 0 <= value <= 100 for value in values[1:4])
                or values[4] not in (0, 1)
                or not 1 <= values[5] <= 65535
            ):
                return None
            state.pwm = tuple(values[1:])
        elif prefix == "T":
            if len(values) not in (3, 4) or not 1 <= values[1] <= module.temperatures:
                return None
            if len(values) == 3:
                temperature = values[2] / 10
            else:
                fields = text.split(",")
                if not re.fullmatch(r"\d{1,4}", fields[3]):
                    return None
                temperature = float(Decimal(fields[2] + "." + fields[3]))
            if not -55 <= temperature <= 125:
                return None
            state.temperatures[values[1]] = (temperature, time.monotonic())
        elif prefix == "TEMP":
            values = checked(text)
            if (
                not module.thermostats
                or len(values) < 9
                or values[1] not in (1, 2)
                or not 0 <= values[8] <= 4
                or len(values) != 9 + 3 * values[8]
            ):
                return None
            cfg = ThermostatConfig(
                *values[2:8], tuple(tuple(values[i : i + 3]) for i in range(9, len(values), 3))
            )
            cfg.validate()
            state.configs[values[1]] = cfg
        elif prefix == "THERM":
            if (
                not module.thermostats
                or len(values) != 9
                or values[1] not in (1, 2)
                or any(values[i] not in (0, 1) for i in (2, 3, 4, 8))
                or not -550 <= values[5] <= 1250
                or not -550 <= values[6] <= 1250
                or not 1 <= values[7] <= 200
            ):
                return None
            state.thermostats[values[1]] = (*values[2:], time.monotonic())
        state.last_seen, state.online = time.monotonic(), True
        return address, events, details


class Framer:
    """CR, LF and CRLF, including fragmented input and overlong-line discard."""

    def __init__(self):
        self.buffer = bytearray()
        self.discard = False

    def feed(self, data):
        result = []
        for byte in data:
            if byte in (10, 13):
                if self.buffer and not self.discard:
                    result.append(self.buffer.decode("ascii"))
                self.buffer.clear()
                self.discard = False
            elif not 32 <= byte <= 126 or len(self.buffer) >= 199:
                self.discard = True
            elif not self.discard:
                self.buffer.append(byte)
        return result
