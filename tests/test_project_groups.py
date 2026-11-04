import copy
import importlib
import unittest

from .support import name as package_name
from .support import protocol as p

project_labels = importlib.import_module(package_name + ".project_names").project_labels


class ProjectGroupsTests(unittest.TestCase):
    def setUp(self):
        self.modules = {2: p.Module(2, "R0806T", "32"), 3: p.Module(3, "S0804", "32")}
        self.project = {"roomGroups": [{"id": "salon", "name": "Salon", "icon": "🛋️"}],
                        "devices": [{"id": 2, "model": "R0806T", "name": "Parter",
                                     "outputGroups": {"1": "salon"}, "inputGroups": {"8": "salon"},
                                     "thermostatGroups": {"2": "salon"}, "pwmGroup": "salon"},
                                    {"id": 3, "model": "S0804", "outputGroups": {"4": "salon"}}]}

    def test_group_keys_and_no_hardware_config(self):
        result = project_labels(self.project, self.modules)
        self.assertEqual(set(result["2"]["groups"]), {"relay_1", "input_8", "thermostat_2", "pwm"})
        self.assertEqual(result["3"]["groups"]["cover_4"]["name"], "Salon")
        self.assertEqual(result["2"]["names"], {"module": "Parter"})
        legacy = copy.deepcopy(self.project)
        del legacy["roomGroups"]
        self.assertNotIn("groups", project_labels(legacy, self.modules)["2"])

    def test_invalid_group_does_not_partially_import(self):
        for value in [{"7": "salon"}, {"1": "missing"}, ["salon"]]:
            bad = copy.deepcopy(self.project)
            bad["devices"][0]["outputGroups"] = value
            with self.assertRaises(p.ProtocolError):
                project_labels(bad, self.modules)
        bad = copy.deepcopy(self.project)
        bad["roomGroups"].append(bad["roomGroups"][0])
        with self.assertRaises(p.ProtocolError):
            project_labels(bad, self.modules)

    def test_removing_assignment_is_explicit(self):
        project = {"roomGroups": [], "devices": [{"id": 2, "model": "R0806T"}]}
        self.assertEqual(project_labels(project, self.modules)["2"]["groups"], {})
