import unittest
from unittest.mock import AsyncMock

from .support import client as c
from .support import protocol as p


class PulseTests(unittest.IsolatedAsyncioTestCase):
    async def test_hardware_duration_and_no_retry(self):
        client = c.GryfClient({})
        client.modules = {2: p.Module(2, "R0806T", "32")}
        client.request = AsyncMock()
        await client.pulse(2, 3, 0.7)
        args = client.request.call_args
        self.assertEqual(args.args[0], "AT+Pulse=2,3,7,0")
        self.assertTrue(args.kwargs["mutation"])
        self.assertTrue(args.args[1]("RuleOK=2"))
        self.assertFalse(args.args[1]("RuleOK=3"))
        client.request.reset_mock()
        client.request.side_effect = TimeoutError("lost ack")
        with self.assertRaises(TimeoutError):
            await client.pulse(2, 3, 0.1)
        self.assertEqual(client.request.await_count, 1)

    async def test_invalid_duration_never_sends(self):
        client = c.GryfClient({})
        client.modules = {2: p.Module(2, "R0806T", "32")}
        client.request = AsyncMock()
        for duration in [0, -1, 0.15, 60.1, float("nan"), float("inf"), "bad", None]:
            with self.subTest(duration=duration), self.assertRaises(p.ProtocolError):
                await client.pulse(2, 1, duration)
        for channel in [0, 7]:
            with self.assertRaises(p.ProtocolError):
                await client.pulse(2, channel, 0.5)
        client.request.assert_not_awaited()
