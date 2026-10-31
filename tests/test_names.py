import importlib
import unittest

from .support import client as c
from .support import name as package_name
from .support import protocol as p

names = importlib.import_module(package_name + ".names")


class NameTests(unittest.IsolatedAsyncioTestCase):
    def test_encoding_and_mapping(self):
        for model, count in [
            ("ETH0606T", 13),
            ("R0808", 21),
            ("R0806T", 20),
            ("S0804", 13),
            ("R0806T-OLD", 15),
        ]:
            module = p.Module(2, model, str(names.MINIMUM[model]))
            self.assertEqual(len(names.keys(module)), count)
            body = "2,0," + bytes(range(128, 146)).hex().upper()
            self.assertEqual(names.parse(f"Name={body},{p.crc16(body):04X}", 2, 0), names.POLISH)
        for body in ["2,0,FF", "2,0," + "41" * 19, "3,0,41", "2,1,41", "2,0,F"]:
            with self.assertRaises(p.ProtocolError):
                names.parse(f"Name={body},{p.crc16(body):04X}", 2, 0)
        with self.assertRaises(p.ProtocolError):
            names.parse("Name=2,0,41,0000", 2, 0)

    async def test_read_only_startup_and_fallback(self):
        client = c.GryfClient({})
        modern = p.Module(2, "R0806T", "29")
        older = p.Module(3, "R0808", "28")
        client.modules = {2: modern, 3: older}
        commands = []

        async def request(command, expected):
            commands.append(command)
            address, slot = command.split("=")[1].split(",")
            body = f"{address},{slot},8081"
            response = f"Name={body},{p.crc16(body):04X}"
            self.assertTrue(expected(response))
            return response

        client.request = request
        await client.read_names()
        self.assertEqual(len(commands), 20)
        self.assertTrue(all(x.startswith("AT+NameGet=2,") for x in commands))
        self.assertEqual(names.label(modern, "input_1", "default"), "ĄĆ")
        self.assertEqual(names.label(modern, "event_1", "default"), "Zdarzenia: ĄĆ")
        self.assertEqual(names.label(older, "input_1", "default"), "default")
        before = modern.names.copy()

        async def broken(command, expected):
            return "NameERROR=2,0,MIGRATE"

        client.request = broken
        await client.read_names()
        self.assertEqual(modern.names, before)
        modern.names["input_1"] = "   "
        self.assertEqual(names.label(modern, "input_1", "default"), "default")
