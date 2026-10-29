import asyncio
import select
import socket
import time
import unittest
from dataclasses import replace
from unittest.mock import patch

from .support import Emulator
from .support import client as c
from .support import protocol as p


class ProtocolTests(unittest.TestCase):
    def setUp(self):
        self.modules = {
            m.id: m
            for m in [
                p.Module(1, "ETH0606T", "25"),
                p.Module(2, "R0808", "25"),
                p.Module(3, "R0806T", "27"),
                p.Module(4, "S0804", "27"),
                p.Module(5, "R0806T-OLD", "4"),
            ]
        }
        self.store = p.StateStore(self.modules)

    def test_framing(self):
        framer = p.Framer()
        self.assertEqual(framer.feed(b"I=1,0"), [])
        self.assertEqual(framer.feed(b",1\r\nPS=1,2\rPL=1,2\n"), ["I=1,0,1", "PS=1,2", "PL=1,2"])
        self.assertEqual(framer.feed(b"x" * 200 + b"\rOK\r"), ["OK"])
        self.assertEqual(framer.feed(b"bad\xff\rOK\r"), ["OK"])

    def test_identity_and_versions(self):
        self.assertEqual(p.find("AT+Find=5,4,R0806T-OLD").model, "R0806T-OLD")
        for line in ["AT+Find=1,0714,S0804", "AT+Find=1,26,S0804", "AT+Find=1,21,ETH0606T"]:
            with self.assertRaises(p.IncompatibleFirmware):
                p.find(line)
        with self.assertRaises(p.ProtocolError):
            p.find("AT+Find=36,25,R0808")
        self.assertIsNone(p.find("unrelated text"))

    def test_chain_crc(self):
        self.assertEqual(p.crc16("123456789"), 0x29B1)
        payload = "A,OK,R0808;25;8;APP;MCU;UNKNOWN;0;0;CHAIN1"
        self.assertEqual(p.chain(f"Chain={payload}*{p.crc16(payload):04X}", "A", 2).id, 8)
        with self.assertRaises(p.ProtocolError):
            p.chain(f"Chain={payload}*0000", "A", 2)
        with self.assertRaises(p.ProtocolError):
            p.chain(f"Chain={payload}*{p.crc16(payload):04X}", "B", 2)

    def test_four_events_and_no_initial_edges(self):
        self.assertEqual(self.store.apply("I=1,0,1,0,0,0,0")[1], [])
        self.assertEqual(self.store.apply("I=1,1,0,0,0,0,0")[1], [(1, "closed"), (2, "opened")])
        self.assertEqual(self.store.apply("I=1,1,0,0,0,0,0")[1], [])
        self.assertEqual(self.store.apply("PS=1,2")[1], [(2, "short_press")])
        self.assertEqual(self.store.apply("PL=1,2")[1], [(2, "long_press")])

    def test_profile_validation(self):
        for line in [
            "I=1,1,0",
            "I=1,2,0,0,0,0,0",
            "PS=1,7",
            "I=34,0,0,0,0,0,0",
            "O=4,0,0,0,0",
            "T=5,1,220",
            "THERM=1,1,1,0,1,200,220,5,1",
            "RolState=3,1,0,0,255,255,0,514",
        ]:
            self.assertIsNone(self.store.apply(line), line)

    def test_temperatures(self):
        for text, expected in [
            ("T=1,5,-125", -12.5),
            ("T=3,2,-0,5", -0.5),
            ("T=3,1,-12,25", -12.25),
            ("T=2,1,1250", 125),
        ]:
            self.assertIsNotNone(self.store.apply(text))
            address, channel = map(int, text[2:].split(",")[:2])
            self.assertEqual(self.store.states[address].temperatures[channel][0], expected)
        for text in ["T=1,6,20", "T=1,1,-551", "T=1,1,1251", "T=1,1,0,-5"]:
            self.assertIsNone(self.store.apply(text))

    def test_shutter_position_and_checksum(self):
        values = [4, 1, 2, 1, 30, 70, 80]
        good = "RolState=" + ",".join(map(str, [*values, sum(values)]))
        self.assertIsNotNone(self.store.apply(good))
        self.assertEqual(self.store.states[4].shutters[1], (2, 1, 30, 70, 80))
        self.assertIsNone(self.store.apply(good[:-1] + "0"))
        self.assertEqual(self.store.apply("R=4,0,1,0,0")[2], [1, 2, 3, 4])

    def test_thermostat_preserves_settings(self):
        cfg = p.ThermostatConfig(1, 0, 2, 2, -50, 7, ((0, 2, 6), (8, 3, 8)))
        command = cfg.command(3, 1)
        self.assertIsNotNone(self.store.apply(command.replace("AT+SetTemp=", "TEMP=")))
        self.assertEqual(self.store.states[3].configs[1], cfg)
        changed = replace(cfg, setpoint=230)
        self.assertEqual(changed.outputs, cfg.outputs)
        self.assertEqual(changed.source, 2)
        with self.assertRaises(p.ProtocolError):
            replace(cfg, outputs=()).command(3, 1)
        self.assertIsNotNone(self.store.apply("THERM=3,1,1,0,0,205,230,7,1"))
        self.assertEqual(self.store.states[3].thermostats[1][:7], (1, 0, 0, 205, 230, 7, 1))


class ClientTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.emulator = Emulator()
        self.settings = await self.emulator.start()
        self.events = []
        self.client = c.GryfClient(self.settings, on_event=lambda *args: self.events.append(args))
        await self.client.connect()

    async def asyncTearDown(self):
        await self.client.close()
        await self.emulator.stop()

    async def test_discovery_stops_and_reads_all_models(self):
        start = time.monotonic()
        found = await self.client.discover()
        self.assertEqual(len(found), 5)
        self.assertLess(time.monotonic() - start, 2.8)
        self.assertEqual(sum(x.startswith("AT+Discovery=") for x in self.emulator.commands), 5)
        self.assertFalse(any("Search" in command for command in self.emulator.commands))
        await self.client.refresh()
        self.assertTrue(all(state.online for state in self.client.store.states.values()))
        self.assertIsNone(self.client.store.states[5].outputs)
        self.assertEqual(self.client.store.states[2].temperatures[1][0], -12.5)
        self.assertNotIn(2, self.client.store.states[2].temperatures)
        self.assertEqual(self.events, [])

    async def test_mutations_and_events(self):
        await self.client.discover()
        await self.client.refresh()
        await self.client.relay(2, 8, True)
        self.assertEqual(self.client.store.states[2].outputs, [0, 0, 0, 0, 0, 0, 0, 1])
        await self.client.relay(2, 8, False)
        await self.client.shutter(4, 2, 1)
        await self.client.shutter(4, 2, 2)
        await self.client.shutter(4, 2, 7, 60)
        self.assertIn("AT+RolAct=4,2,1,0,7", self.emulator.commands)
        self.assertIn("AT+RolAct=4,2,2,0,8", self.emulator.commands)
        self.assertIn("AT+RolAct=4,2,7,60,73", self.emulator.commands)
        before = self.emulator.configs[3, 1]
        await self.client.thermostat(3, 1, setpoint=235, mode=1)
        self.assertEqual(self.emulator.configs[3, 1], replace(before, setpoint=235, mode=1))
        self.assertFalse(any("SaveConfig" in cmd for cmd in self.emulator.commands))
        await self.client.save(3)
        self.assertIn("AT+SaveConfig=3,3", self.emulator.commands)
        await self.emulator.broadcast("I=1,1,0,0,0,0,0")
        await self.emulator.broadcast("I=1,0,0,0,0,0,0")
        await self.emulator.broadcast("PS=1,1")
        await self.emulator.broadcast("PL=1,1")
        self.assertEqual(
            [event[2] for event in self.events], ["closed", "opened", "short_press", "long_press"]
        )

    async def test_timeout_never_replays_write(self):
        self.emulator.ignore = "AT+SetOut=2,1,0,0,0,0,0,0,0"
        with self.assertRaises(TimeoutError):
            await self.client.request(
                self.emulator.ignore, lambda line: line == "RuleOK=2", timeout=0.05, mutation=True
            )
        self.assertFalse(self.client.connected)
        self.assertEqual(self.emulator.commands.count(self.emulator.ignore), 1)

    async def test_duplicate_id_rejected(self):
        self.emulator.modules[-1] = p.Module(2, "R0806T-OLD", "4")
        with self.assertRaisesRegex(p.ProtocolError, "Duplicate"):
            await self.client.discover()

    async def test_rs232_actual_async_transport_with_virtual_port(self):
        await self.client.close()
        import serial

        driver_socket, peer_socket = socket.socketpair()
        driver_socket.setblocking(False)
        peer_socket.setblocking(False)
        opened = []

        class VirtualSerial:
            def __init__(self, **kwargs):
                self.__dict__.update(kwargs)
                self.dtr = self.rts = True
                self.is_open = False
                opened.append(self)

            def open(self):
                self.is_open = True

            def close(self):
                self.is_open = False
                driver_socket.close()

            def fileno(self):
                return driver_socket.fileno()

            @property
            def in_waiting(self):
                return int(bool(select.select([driver_socket], [], [], 0)[0]))

            @property
            def out_waiting(self):
                return 0

            def read(self, count):
                return driver_socket.recv(count)

            def write(self, data):
                return driver_socket.send(data)

        reader, writer = await asyncio.open_connection(sock=peer_socket)
        serial_emulator = Emulator(ethernet=False)
        server_task = asyncio.create_task(serial_emulator.handle(reader, writer))
        self.client = c.GryfClient({"connection": "serial", "device": "VIRTUAL-ONLY"})
        try:
            with patch.object(serial, "Serial", VirtualSerial):
                await self.client.connect()
            found = await self.client.discover()
            self.assertEqual(len(found), 4)
            self.assertEqual(opened[0].baudrate, 115200)
            self.assertFalse(opened[0].dtr)
            self.assertFalse(opened[0].rts)
            await self.client.refresh()
            await self.client.thermostat(2, 1, mode=1, cooling=1, setpoint=250)
            self.assertEqual(serial_emulator.configs[2, 1].setpoint, 250)
            self.assertEqual(serial_emulator.configs[2, 1].cooling, 1)
        finally:
            await self.client.close()
            await server_task
