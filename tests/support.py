"""Import the standalone wire library without importing Home Assistant."""

import asyncio
import importlib
import sys
import types
from pathlib import Path

name = "gryfsmart_wire_test"
package = types.ModuleType(name)
package.__path__ = [str(Path(__file__).resolve().parents[1] / "custom_components/gryfsmart")]
sys.modules.setdefault(name, package)
protocol = importlib.import_module(name + ".protocol")
client = importlib.import_module(name + ".client")


class Emulator:
    """AT/CHAIN peer with deliberately mixed CR and CRLF replies."""

    def __init__(self, ethernet=True):
        models = [
            (1, "ETH0606T", "25"),
            (2, "R0808", "25"),
            (3, "R0806T", "27"),
            (4, "S0804", "27"),
            (5, "R0806T-OLD", "4"),
        ]
        self.modules = [protocol.Module(*args) for args in models[0 if ethernet else 1 :]]
        self.ethernet = ethernet
        self.commands, self.writers = [], set()
        self.outputs = {m.id: [0] * m.outputs for m in self.modules}
        self.inputs = {m.id: [0] * m.inputs for m in self.modules}
        self.configs = {
            (m.id, ch): protocol.ThermostatConfig(
                0, 0, 0, 1, 220, 5, ((0, 3 if m.model == "R0808" else 2, ch),)
            )
            for m in self.modules
            for ch in range(1, m.thermostats + 1)
        }
        self.ignore = None
        self.server = None

    async def start(self):
        self.server = await asyncio.start_server(self.handle, "127.0.0.1", 0)
        return {
            "connection": "ethernet",
            "host": "127.0.0.1",
            "port": self.server.sockets[0].getsockname()[1],
        }

    async def stop(self):
        for writer in tuple(self.writers):
            writer.close()
            await writer.wait_closed()
        if self.server:
            self.server.close()
            await self.server.wait_closed()

    async def broadcast(self, line):
        for writer in tuple(self.writers):
            writer.write((line + "\r\n").encode())
            await writer.drain()
        await asyncio.sleep(0.03)

    def reply(self, command):
        if command == self.ignore:
            return None
        name, text = command[3:].split("=", 1)
        fields = text.split(",")
        address = int(fields[0], 16 if name == "Discovery" else 10)
        if name == "Find":
            module = (
                self.modules[0]
                if not address
                else next((m for m in self.modules if m.id == address), None)
            )
            return f"AT+Find={module.id},{module.firmware},{module.model}" if module else None
        if name == "Net":
            return "NET=1,MAC=02:47:52:59:46:01,IP=127.0.0.1,TCP=5000"
        if name == "Discovery":
            modules = self.modules[1:] if self.ethernet else self.modules
            if address >= len(modules):
                return None
            m = modules[address]
            payload = f"{fields[1]},OK,{m.model};{m.firmware};{m.id};APP;MCU;UNKNOWN;0;0;CHAIN1"
            return f"Chain={payload}*{protocol.crc16(payload):04X}"
        module = next((m for m in self.modules if m.id == address), None)
        if module is None:
            return None
        if name == "GetInputs":
            return f"I={address}," + ",".join(map(str, self.inputs[address]))
        if name == "GetPWM":
            return f"PWM={address},{getattr(self, 'pwm_level', 0)},{getattr(self, 'pwm_level', 0)},70,0,2000"
        if name == "PWM":
            values = list(map(int, fields))
            if address != 3 or len(values) != 5 or values[3] != 15 or sum(values[:-1]) != values[-1]:
                return f"PWMERROR={address}"
            self.pwm_level = values[2]
            return f"RuleOK={address}"
        if name == "GetOut":
            return f"o={address}," + ",".join(map(str, self.outputs[address]))
        if name == "SetOut":
            for index, action in enumerate(map(int, fields[1:])):
                if action:
                    self.outputs[address][index] = 1 if action == 1 else 0
            return f"RuleOK={address}"
        if name == "GetRolState":
            channel = int(fields[1])
            values = [address, channel, 0, 1, 50, 255, 0]
            return "RolState=" + ",".join(map(str, [*values, sum(values)]))
        if name == "RolAct":
            return f"RuleOK={address}"
        if name == "ReadTemp":
            return f"T={address},1,-125" if fields[1] == "1" else f"RuleERROR={address}"
        if name == "GetTempCfg":
            channel = int(fields[1])
            return (
                self.configs[address, channel]
                .command(address, channel)
                .replace("AT+SetTemp=", "TEMP=")
            )
        if name == "SetTemp":
            store = protocol.StateStore({address: module})
            if store.apply(command.replace("AT+SetTemp=", "TEMP=")) is None:
                return f"RuleERROR={address}"
            self.configs[address, int(fields[1])] = store.states[address].configs[int(fields[1])]
            return f"RuleOK={address}"
        if name == "GetTemp":
            channel = int(fields[1])
            cfg = self.configs[address, channel]
            return f"THERM={address},{channel},{cfg.mode},{cfg.cooling},1,205,{cfg.setpoint},{cfg.hysteresis},0"
        if name == "SaveConfig":
            return f"SaveOK={address}"
        return f"RuleERROR={address}"

    async def handle(self, reader, writer):
        self.writers.add(writer)
        framer = protocol.Framer()
        try:
            while data := await reader.read(1024):
                for command in framer.feed(data):
                    self.commands.append(command)
                    response = self.reply(command)
                    if response:
                        encoded = (
                            response + ("\r" if command.startswith("AT+GetOut") else "\r\n")
                        ).encode()
                        writer.write(encoded[:3])
                        await writer.drain()
                        await asyncio.sleep(0)
                        writer.write(encoded[3:])
                        await writer.drain()
        except (ConnectionError, OSError):
            pass
        finally:
            self.writers.discard(writer)
            writer.close()
