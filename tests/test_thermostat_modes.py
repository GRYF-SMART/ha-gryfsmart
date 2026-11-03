import importlib
import unittest
from dataclasses import replace

from .support import client as c
from .support import name as package_name
from .support import protocol as p

labels = importlib.import_module(package_name + ".project_names")


class ThermostatModeTests(unittest.IsolatedAsyncioTestCase):
    async def test_modes_roundtrip_and_old_firmware_blocked(self):
        cfg = p.ThermostatConfig(2, 0, 0, 1, 220, 5, ((0, 2, 3),))
        module = p.Module(2, "R0806T", "32", 2)
        client = c.GryfClient({})
        client.modules = {2: module, 1: p.Module(1, "R0808", "31", 1)}
        with self.assertRaisesRegex(p.ProtocolError, "po drodze"):
            await client.thermostat(2, 1, mode=2)
        client.modules[2] = p.Module(2, "R0806T", "31", 2)
        with self.assertRaisesRegex(p.ProtocolError, "32"):
            await client.thermostat(2, 1, mode=2)
        client.modules = {2: module}
        replies = []
        for mode in (0, 1, 2):
            desired = replace(cfg, mode=mode)
            replies.append(desired.command(2, 1))
            desired.validate()
        self.assertEqual(len(set(replies)), 3)
        with self.assertRaises(p.ProtocolError):
            replace(cfg, mode=3).validate()
        with self.assertRaises(p.ProtocolError):
            replace(cfg, outputs=()).validate()

    def test_project_names_match_identity_and_preserve_settings(self):
        module = p.Module(2, "R0806T", "32")
        project = {"Devices": [{"Id": 2, "Model": "R0806T", "Name": "Sypialnia",
                               "RegulatorNames": ["Podłoga", "Grzejnik"],
                               "Configuration": {"Thermostats": [{"Mode": 2}]}}]}
        imported = labels.project_labels(project, {2: module})
        self.assertEqual(set(imported["2"]["names"]), {"module", "thermostat_1", "thermostat_2"})
        labels.apply_labels({2: module}, imported)
        self.assertEqual(module.names["thermostat_1"], "Podłoga")
        for field, value in [("Id", 3), ("Model", "R0808"), ("RegulatorNames", ["a"]),
                             ("Name", "a" * 19), ("Name", "a\n")]:
            changed = {"Devices": [dict(project["Devices"][0]) | {field: value}]}
            with self.assertRaises(p.ProtocolError):
                labels.project_labels(changed, {2: module})
        with self.assertRaises(p.ProtocolError):
            labels.project_labels({"Devices": project["Devices"] * 2}, {2: module})
        other_model = p.Module(2, "R0808", "32")
        labels.apply_labels({2: other_model}, imported)
        self.assertEqual(other_model.names, {})
