"""Real HA config flow, registries, state rendering and entity services."""

import importlib.util
import shutil
import tempfile
import unittest
from pathlib import Path

from .support import Emulator


@unittest.skipUnless(
    importlib.util.find_spec("homeassistant"), "Home Assistant runtime is tested in Linux CI"
)
class HomeAssistantTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        from homeassistant import bootstrap, loader
        from homeassistant.core import HomeAssistant

        self.folder = tempfile.TemporaryDirectory()
        shutil.copytree(
            Path(__file__).resolve().parents[1] / "custom_components",
            Path(self.folder.name) / "custom_components",
            ignore=shutil.ignore_patterns("__pycache__"),
        )
        self.hass = HomeAssistant(self.folder.name)
        self.hass.config.skip_pip = True
        loader.async_setup(self.hass)
        result = await bootstrap.async_from_config_dict(
            {
                "frontend": {},
                "homeassistant": {
                    "latitude": 52,
                    "longitude": 21,
                    "elevation": 100,
                    "unit_system": "metric",
                    "time_zone": "UTC",
                }
            },
            self.hass,
        )
        self.assertIsNotNone(result)
        await self.hass.async_start()
        self.emulator = Emulator()
        self.settings = await self.emulator.start()

    async def asyncTearDown(self):
        for entry in self.hass.config_entries.async_entries("gryfsmart"):
            await self.hass.config_entries.async_unload(entry.entry_id)
        await self.emulator.stop()
        await self.hass.async_stop()
        self.folder.cleanup()

    async def test_config_flow_entities_events_and_controls(self):
        from homeassistant.data_entry_flow import FlowResultType
        from homeassistant.helpers import entity_registry as er

        flow = await self.hass.config_entries.flow.async_init(
            "gryfsmart", context={"source": "user"}
        )
        self.assertEqual(flow["type"], FlowResultType.MENU)
        self.assertIn("serial", flow["menu_options"])
        flow = await self.hass.config_entries.flow.async_configure(
            flow["flow_id"], {"next_step_id": "ethernet"}
        )
        self.assertEqual(flow["type"], FlowResultType.FORM)
        flow = await self.hass.config_entries.flow.async_configure(
            flow["flow_id"], {"host": self.settings["host"], "port": self.settings["port"]}
        )
        self.assertEqual(flow["type"], FlowResultType.CREATE_ENTRY, flow)
        await self.hass.async_block_till_done()
        entry = flow["result"]
        self.assertEqual(entry.state.value, "loaded")
        registry = er.async_get(self.hass)
        entities = er.async_entries_for_config_entry(registry, entry.entry_id)
        for domain, expected in [
            ("switch", 26),
            ("binary_sensor", 38),
            ("cover", 4),
            ("event", 38),
            ("climate", 4),
            ("sensor", 14),
            ("button", 5),
            ("number", 1),
        ]:
            self.assertEqual(sum(entity.domain == domain for entity in entities), expected, domain)

        import inspect
        from types import SimpleNamespace

        from custom_components.gryfsmart import panel

        self.assertIn("gryfsmart-config", self.hass.data["frontend_panels"])

        class Connection:
            user = SimpleNamespace(id="admin-test", is_admin=True)
            result = error = None

            def send_result(self, msg_id, result):
                self.result = result

            def send_error(self, msg_id, code, message):
                self.error = code, message

        connection = Connection()
        handler = inspect.unwrap(panel.config_command)
        request = {
            "id": 900,
            "type": "gryfsmart/config",
            "action": "read",
            "entry": entry.entry_id,
            "module": 3,
            "rule": 16,
        }
        await handler(self.hass, connection, request)
        self.assertIsNone(connection.error)
        token = connection.result["token"]
        rule = connection.result["configuration"]
        rule["events"][0] = 4
        rule["enabled"] = 1
        save_request = dict(request, action="save", token=token, configuration=rule)
        await handler(self.hass, connection, save_request)
        self.assertIsNone(connection.error)
        self.assertEqual(self.emulator.saved_rules[3, 16], rule)
        await handler(self.hass, connection, save_request)
        self.assertEqual(connection.error[0], "configuration_error")
        non_admin = Connection()
        non_admin.user = SimpleNamespace(id="guest", is_admin=False)
        await handler(self.hass, non_admin, dict(request, action="modules"))
        self.assertEqual(non_admin.error[0], "unauthorized")

        def entity_id(suffix):
            return next(
                entity.entity_id for entity in entities if entity.unique_id.endswith(suffix)
            )

        relay = entity_id("_R0808_2_relay_8")
        self.assertEqual(self.hass.states.get(relay).state, "off")
        await self.hass.services.async_call(
            "switch", "turn_on", {"entity_id": relay}, blocking=True
        )
        self.assertEqual(self.hass.states.get(relay).state, "on")
        cover = entity_id("_S0804_4_cover_2")
        self.assertEqual(self.hass.states.get(cover).attributes["current_position"], 50)
        await self.hass.services.async_call(
            "cover", "close_cover", {"entity_id": cover}, blocking=True
        )
        self.assertIn("AT+RolAct=4,2,2,0,8", self.emulator.commands)
        climate = entity_id("_R0806T_3_thermostat_1")
        self.assertEqual(self.hass.states.get(climate).state, "off")
        await self.hass.services.async_call(
            "climate", "set_temperature", {"entity_id": climate, "temperature": 23.5}, blocking=True
        )
        await self.hass.services.async_call(
            "climate", "set_hvac_mode", {"entity_id": climate, "hvac_mode": "heat"}, blocking=True
        )
        self.assertEqual(self.hass.states.get(climate).state, "heat")
        self.assertEqual(self.emulator.configs[3, 1].setpoint, 235)
        self.assertEqual(self.emulator.configs[3, 1].outputs, ((0, 2, 1),))
        pwm = entity_id("_R0806T_3_pwm")
        self.assertEqual(self.hass.states.get(pwm).state, "0")
        await self.hass.services.async_call(
            "number", "set_value", {"entity_id": pwm, "value": 50}, blocking=True
        )
        await self.hass.async_block_till_done()
        self.assertEqual(float(self.hass.states.get(pwm).state), 50)
        self.assertIn("AT+PWM=3,4,50,15,72", self.emulator.commands)
        await self.emulator.broadcast("PWM=3,20,70,70,1,2000")
        await self.hass.async_block_till_done()
        self.assertEqual(float(self.hass.states.get(pwm).state), 20)
        self.assertEqual(self.hass.states.get(pwm).attributes["target_percent"], 70)

        event = entity_id("_ETH0606T_1_event_1")
        self.assertEqual(self.hass.states.get(event).state, "unknown")
        for frame, event_type in [
            ("I=1,1,0,0,0,0,0", "closed"),
            ("I=1,0,0,0,0,0,0", "opened"),
            ("PS=1,1", "short_press"),
            ("PL=1,1", "long_press"),
        ]:
            await self.emulator.broadcast(frame)
            await self.hass.async_block_till_done()
            self.assertEqual(self.hass.states.get(event).attributes["event_type"], event_type)
        self.assertFalse(any("SaveConfig" in cmd for cmd in self.emulator.commands))
        save = entity_id("_R0806T_3_save")
        await self.hass.services.async_call("button", "press", {"entity_id": save}, blocking=True)
        self.assertIn("AT+SaveConfig=3,3", self.emulator.commands)
        old = entity_id("_R0806T-OLD_5_relay_1")
        self.assertEqual(self.hass.states.get(old).state, "unknown")
        await self.emulator.broadcast("o=5,1,0,0,0,0,0")
        self.assertEqual(self.hass.states.get(old).state, "on")
        await entry.runtime_data.client.close()
        entry.runtime_data.changed()
        self.assertEqual(self.hass.states.get(relay).state, "unavailable")
        hub = entry.runtime_data
        await self.hass.config_entries.async_unload(entry.entry_id)
        await self.hass.async_block_till_done()
        self.assertFalse(hub.client.connected)

    async def test_serial_config_form(self):
        from homeassistant.data_entry_flow import FlowResultType

        flow = await self.hass.config_entries.flow.async_init(
            "gryfsmart", context={"source": "user"}
        )
        flow = await self.hass.config_entries.flow.async_configure(
            flow["flow_id"], {"next_step_id": "serial"}
        )
        self.assertEqual(flow["type"], FlowResultType.FORM)
        self.assertEqual(flow["step_id"], "serial")
        # A nonexistent port produces a form error, never a fake configured entry.
        flow = await self.hass.config_entries.flow.async_configure(
            flow["flow_id"], {"device": "/dev/gryfsmart-does-not-exist"}
        )
        self.assertEqual(flow["errors"]["base"], "cannot_connect")
        self.hass.config_entries.flow.async_abort(flow["flow_id"])


if __name__ == "__main__":
    unittest.main()
