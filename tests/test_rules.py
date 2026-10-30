"""Rule writes against a mixed network; no physical devices."""

import copy
import unittest

from .support import Emulator, client, protocol


class RuleTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.peer = Emulator()
        self.client = client.GryfClient(await self.peer.start())
        await self.client.connect()
        await self.client.discover()

    async def asyncTearDown(self):
        await self.client.close()
        await self.peer.stop()

    async def test_read_write_each_model_and_preserve_other_rules(self):
        for address in (1, 2, 3, 4):
            baseline = await self.client.read_rule(address, 16)
            desired = copy.deepcopy(baseline)
            desired["enabled"] = 1
            desired["events"][0] = 15
            desired["actions"][0] = 1
            before = copy.deepcopy(self.peer.rules)
            actual = await self.client.write_rule(address, 16, desired, baseline)
            self.assertEqual(actual, desired)
            self.assertEqual(self.peer.saved_rules[address, 16], desired)
            for key in before:
                if key != (address, 16):
                    self.assertEqual(before[key], self.peer.rules[key])

    async def test_slots_pwm_temperature_and_pulse_roundtrip(self):
        baseline = await self.client.read_rule(3, 1)
        desired = copy.deepcopy(baseline)
        desired.update(enabled=1, pwm=[4, 70, 15], temperature=[2, 2, 1, 0, -50, 5, 20])
        desired["slots"] = [
            {"target": 4, "type": 1, "data": [7, 50, 1, 0, 2, 0, 0, 0]},
            {"target": 2, "type": 3, "data": [1, 2, 3, 0, 0, 0, 0, 0]},
            {"target": 3, "type": 5, "data": [2, 255, 255, 1]},
            {"target": 6, "type": 4, "data": [4, 80, 15]},
        ]
        await self.client.write_rule(3, 1, desired, baseline)
        self.assertEqual(await self.client.read_rule(3, 1), desired)
        commands = self.peer.commands
        self.assertIn(protocol.csv("RulePulse", 3, 1, 3, 3, 2, 65535, 1), commands)
        self.assertTrue(
            commands[commands.index(protocol.csv("SaveConfig", 3)) - 1].startswith(
                "AT+GetRuleTemp="
            )
        )

    async def test_conflict_and_invalid_input_never_write(self):
        baseline = await self.client.read_rule(3, 1)
        self.peer.rules[3, 1]["events"][0] = 1
        before = len(self.peer.commands)
        with self.assertRaises(protocol.ProtocolError):
            await self.client.write_rule(3, 1, baseline, baseline)
        self.assertFalse(
            any(c.startswith(("AT+Rule=", "AT+SaveConfig=")) for c in self.peer.commands[before:])
        )
        bad = copy.deepcopy(baseline)
        bad["events"][0] = 16
        before = len(self.peer.commands)
        with self.assertRaises(protocol.ProtocolError):
            await self.client.write_rule(3, 1, bad, baseline)
        self.assertEqual(len(self.peer.commands), before)
        with self.assertRaises(protocol.ProtocolError):
            await self.client.read_rule(5, 1)

    async def test_readback_failure_blocks_enable_and_save(self):
        baseline = await self.client.read_rule(3, 1)
        desired = copy.deepcopy(baseline)
        desired["enabled"] = 1
        desired["events"][0] = 4
        original = self.peer.reply

        def reply(command):
            result = original(command)
            if command.startswith("AT+RulePWM="):
                self.peer.rules[3, 1]["events"][0] = 8
            return result

        self.peer.reply = reply
        with self.assertRaises(protocol.ProtocolError):
            await self.client.write_rule(3, 1, desired, baseline)
        self.assertEqual(self.peer.rules[3, 1]["enabled"], 0)
        self.assertIsNone(self.peer.saved_rules)

    async def test_uncertain_write_is_not_replayed(self):
        baseline = await self.client.read_rule(1, 1)
        command = protocol.csv("Rule", 1, 1, 0, *baseline["events"], *baseline["actions"])
        self.peer.ignore = command
        with self.assertRaises((TimeoutError, protocol.ProtocolError)):
            await self.client.write_rule(1, 1, baseline, baseline)
        self.assertEqual(self.peer.commands.count(command), 1)
        self.assertIsNone(self.peer.saved_rules)
        self.assertFalse(self.client.connected)
