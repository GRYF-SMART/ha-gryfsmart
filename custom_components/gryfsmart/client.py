"""One persistent connection and one request at a time, for TCP and RS-232."""

import asyncio
import logging
import re
from contextlib import suppress
from dataclasses import replace

from .const import BAUDRATE, DEFAULT_PORT, TIMEOUT
from .protocol import Framer, ProtocolError, StateStore, chain, csv, find

_LOGGER = logging.getLogger(__name__)


class ConnectionLost(ProtocolError):
    """The underlying stream is unavailable."""


class GryfClient:
    def __init__(self, settings, on_change=None, on_event=None):
        self.settings = settings
        self.on_change = on_change or (lambda: None)
        self.on_event = on_event or (lambda address, channel, event: None)
        self.modules = {}
        self.store = StateStore({})
        self.reader = self.writer = self.reader_task = None
        self.pending = None
        self.lock = asyncio.Lock()
        self.control_lock = asyncio.Lock()
        self.sequence = 0
        self.details = set()
        self.gateway_mac = None

    @property
    def connected(self):
        return (
            self.writer is not None
            and not self.writer.is_closing()
            and self.reader_task is not None
            and not self.reader_task.done()
        )

    async def connect(self):
        await self.close()
        try:
            async with asyncio.timeout(5):
                if self.settings["connection"] == "ethernet":
                    self.reader, self.writer = await asyncio.open_connection(
                        self.settings["host"], self.settings.get("port", DEFAULT_PORT)
                    )
                else:
                    # Import/open in an executor: the serial driver and OS open can block.
                    import serial
                    from serial_asyncio_fast import connection_for_serial

                    def open_serial():
                        port = serial.Serial(
                            baudrate=BAUDRATE,
                            bytesize=8,
                            parity="N",
                            stopbits=1,
                            timeout=0,
                            write_timeout=0,
                            xonxoff=False,
                            rtscts=False,
                            dsrdtr=False,
                        )
                        port.port = self.settings["device"]
                        port.dtr = port.rts = False
                        port.open()
                        return port

                    port = await asyncio.to_thread(open_serial)
                    try:
                        loop = asyncio.get_running_loop()
                        self.reader = asyncio.StreamReader()
                        protocol = asyncio.StreamReaderProtocol(self.reader)
                        transport, _ = await connection_for_serial(loop, lambda: protocol, port)
                        self.writer = asyncio.StreamWriter(transport, protocol, self.reader, loop)
                    except BaseException:
                        await asyncio.to_thread(port.close)
                        raise
                self.reader_task = asyncio.create_task(self._read(), name="gryfsmart-reader")
                self.writer.write(b"\r")
                await self.writer.drain()
        except (OSError, TimeoutError) as error:
            await self.close()
            raise ConnectionLost(str(error)) from error

    async def close(self):
        if self.reader_task:
            self.reader_task.cancel()
            with suppress(asyncio.CancelledError):
                await self.reader_task
            self.reader_task = None
        if self.writer:
            self.writer.close()
            with suppress(OSError, TimeoutError, NotImplementedError):
                await asyncio.wait_for(self.writer.wait_closed(), 1)
        self.reader = self.writer = None
        for state in self.store.states.values():
            state.online = False
            # Reconnect does not turn initial snapshots into contact events.
            state.inputs = state.outputs = None
            state.shutters.clear()
            state.temperatures.clear()
            state.thermostats.clear()
            state.configs.clear()
        self.details.clear()

    async def _read(self):
        framer = Framer()
        try:
            while data := await self.reader.read(1024):
                for line in framer.feed(data):
                    change = self.store.apply(line)
                    if change:
                        address, events, details = change
                        self.details.update((address, channel) for channel in details)
                        if line.startswith("RolState="):
                            fields = line[9:].split(",")
                            self.details.discard((int(fields[0]), int(fields[1])))
                        for channel, event in events:
                            self.on_event(address, channel, event)
                        self.on_change()
                    if self.pending:
                        future, predicate, address = self.pending
                        if not future.done():
                            if address is not None and line == f"RuleERROR={address}":
                                future.set_exception(ProtocolError(line))
                            elif predicate(line):
                                future.set_result(line)
        except (OSError, ValueError) as error:
            _LOGGER.debug("GRYFSMART stream ended: %s", error)
        finally:
            if self.pending and not self.pending[0].done():
                self.pending[0].set_exception(ConnectionLost("GRYFSMART connection closed"))
            for state in self.store.states.values():
                state.online = False
            self.on_change()

    async def request(self, command, predicate, *, timeout=TIMEOUT, mutation=False):
        if not command.startswith("AT+") or any(c in command for c in "\r\n") or len(command) > 199:
            raise ProtocolError("Invalid command")
        async with self.lock:
            if not self.connected:
                raise ConnectionLost("GRYFSMART disconnected")
            future = asyncio.get_running_loop().create_future()
            address = re.search(r"=(\d+)", command)
            address = (
                int(address[1]) if address and not command.startswith("AT+Discovery=") else None
            )
            self.pending = future, predicate, address
            try:
                async with asyncio.timeout(timeout):
                    self.writer.write((command + "\r").encode("ascii"))
                    await self.writer.drain()
                    return await future
            except (TimeoutError, OSError):
                # Never replay a mutation. Drop the stream so a delayed RuleOK
                # cannot acknowledge the next command after an uncertain write.
                if mutation:
                    await self.close()
                    self.on_change()
                raise
            finally:
                self.pending = None
                if not future.done():
                    future.cancel()

    async def identity(self):
        line = await self.request("AT+Find=0", lambda value: value.startswith("AT+Find="))
        module = find(line)
        if module is None:
            raise ProtocolError("No supported GRYFSMART module")
        if module.model == "ETH0606T":
            net = await self.request("AT+Net=1", lambda value: value.startswith("NET=1,MAC="))
            match = re.search(r"MAC=([0-9A-Fa-f:]{17})(?:,|$)", net)
            if not match:
                raise ProtocolError("Missing gateway MAC address")
            self.gateway_mac = match[1].lower()
        return module

    async def discover(self):
        direct = await self.identity()
        found = {direct.id: direct}
        start = 0
        maximum = 34 if direct.model == "ETH0606T" else 35
        for hop in range(start, maximum):
            self.sequence = self.sequence % 65535 + 1
            sequence = f"{self.sequence:X}"
            try:
                line = await self.request(
                    f"AT+Discovery={hop:X},{sequence}",
                    lambda value, seq=sequence: value.startswith(f"Chain={seq},"),
                )
            except TimeoutError:
                # End the scan on the first missing response, at two seconds.
                break
            module = chain(line, sequence, hop + 1)
            if module.id in found:
                if (
                    hop == 0
                    and direct.model != "ETH0606T"
                    and (module.model, module.firmware, module.id)
                    == (direct.model, direct.firmware, direct.id)
                ):
                    found[module.id] = module
                    continue
                raise ProtocolError(
                    f"Duplicate module ID {module.id}; assign unique IDs before connecting HA"
                )
            found[module.id] = module
        self.modules = found
        self.store = StateStore(found)
        return found

    async def read_module(self, module, *, verify=True):
        state = self.store.states[module.id]
        try:
            if verify:
                response = await self.request(
                    f"AT+Find={module.id}", lambda line: line.startswith(f"AT+Find={module.id},")
                )
                actual = find(response)
                if actual is None or actual.model != module.model:
                    raise ProtocolError("Module identity changed; rescan the network")
                module.firmware = actual.firmware
            state.online = True
            if module.old:
                return
            await self.request(
                f"AT+GetInputs={module.id}",
                lambda line: (
                    line.startswith(f"I={module.id},") and self.store.apply(line) is not None
                ),
            )
            if module.outputs:
                await self.request(
                    f"AT+GetOut={module.id}",
                    lambda line: (
                        line.startswith((f"O={module.id},", f"o={module.id},"))
                        and self.store.apply(line) is not None
                    ),
                )
            for channel in range(1, module.shutters + 1):
                await self.read_shutter(module.id, channel)
            for channel in range(1, module.thermostats + 1):
                await self.read_thermostat_config(module.id, channel)
                await self.request(
                    csv("GetTemp", module.id, channel),
                    lambda line, ch=channel: (
                        line.startswith(f"THERM={module.id},{ch},")
                        and self.store.apply(line) is not None
                    ),
                )
            if module.model == "R0808":
                for channel in (1, 2):
                    try:
                        await self.request(
                            csv("ReadTemp", module.id, channel),
                            lambda line, ch=channel: (
                                line.startswith(f"T={module.id},{ch},")
                                and self.store.apply(line) is not None
                            ),
                        )
                    except (ProtocolError, TimeoutError):
                        # Missing DS18B20 is normal, never publish zero Celsius.
                        state.temperatures.pop(channel, None)
        except (ProtocolError, TimeoutError, OSError):
            state.online = False
            raise

    async def refresh(self):
        for module in self.modules.values():
            try:
                await self.read_module(module)
            except (ProtocolError, TimeoutError, OSError) as error:
                _LOGGER.debug("Read ID %s: %s", module.id, error)
                if not self.connected:
                    raise ConnectionLost(str(error)) from error
        self.on_change()

    async def read_shutter(self, address, channel):
        await self.request(
            csv("GetRolState", address, channel),
            lambda line: (
                line.startswith(f"RolState={address},{channel},")
                and self.store.apply(line) is not None
            ),
        )

    async def read_thermostat_config(self, address, channel):
        await self.request(
            csv("GetTempCfg", address, channel),
            lambda line: (
                line.startswith(f"TEMP={address},{channel},") and self.store.apply(line) is not None
            ),
        )
        return self.store.states[address].configs[channel]

    async def relay(self, address, channel, enabled):
        module = self.modules[address]
        if not 1 <= channel <= module.outputs:
            raise ProtocolError("Invalid relay channel")
        actions = [0] * module.outputs
        actions[channel - 1] = 1 if enabled else 2
        command = f"AT+SetOut={address}," + ",".join(map(str, actions))
        async with self.control_lock:
            await self.request(command, lambda line: line == f"RuleOK={address}", mutation=True)
            if not module.old:
                await self.request(
                    f"AT+GetOut={address}",
                    lambda line: (
                        line.startswith((f"O={address},", f"o={address},"))
                        and self.store.apply(line) is not None
                    ),
                )

    async def shutter(self, address, channel, action, position=0):
        if (
            not self.modules[address].shutters
            or channel not in range(1, 5)
            or action not in (1, 2, 3, 7)
            or not 0 <= position <= 100
        ):
            raise ProtocolError("Invalid shutter action")
        async with self.control_lock:
            await self.request(
                csv("RolAct", address, channel, action, position),
                lambda line: line == f"RuleOK={address}",
                mutation=True,
            )
            await self.read_shutter(address, channel)

    async def thermostat(self, address, channel, **changes):
        if not self.modules[address].thermostats or channel not in (1, 2):
            raise ProtocolError("Invalid thermostat channel")
        async with self.control_lock:
            # Read before every write; preserve source, hysteresis and outputs.
            cfg = await self.read_thermostat_config(address, channel)
            desired = replace(cfg, **changes)
            command = desired.command(address, channel)
            await self.request(command, lambda line: line == f"RuleOK={address}", mutation=True)
            actual = await self.read_thermostat_config(address, channel)
            if actual != desired:
                raise ProtocolError("Thermostat readback differs from requested settings")
            await self.request(
                csv("GetTemp", address, channel),
                lambda line: (
                    line.startswith(f"THERM={address},{channel},")
                    and self.store.apply(line) is not None
                ),
            )

    async def save(self, address):
        if self.modules[address].old:
            raise ProtocolError("This integration does not edit OLD configuration")
        async with self.control_lock:
            await self.request(
                csv("SaveConfig", address),
                lambda line: line == f"SaveOK={address}",
                timeout=20,
                mutation=True,
            )
