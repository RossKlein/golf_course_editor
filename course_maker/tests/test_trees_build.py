"""The forest in the build: trees.bin from forest patches, the tree edits and the landmarks. Run with
python -m unittest discover -s course_maker/tests -t ."""
import json
import shutil
import unittest

import numpy as np
from fastapi.testclient import TestClient
from pydantic import ValidationError

from course_maker import spec
from course_maker.build.build import build_bundle
from course_maker.compiler.validate import validate_bundle
from course_maker.design import store
from course_maker.design.models import Clearing, ForestSettings, PlacedTree, RegionsFile, TreeEdits
from course_maker.look_defaults import default_look
from course_maker.models import Course, Landmark, Look
from course_maker.server.app import create_app
from course_maker.tests.test_design import BundleCase, rect, region


def trees_of(bundle):
    return np.frombuffer((bundle / "trees.bin").read_bytes(), spec.TREE_DTYPE)


class ForestBuildTests(BundleCase):
    # the test course is 119 x 95 m; the woods are a 60 x 50 m rectangle with its corner at (20, 20)
    WOODS = rect(20, 20, 80, 70)

    def edits(self, **kw):
        store.write_design_file(self.bundle, "trees", TreeEdits(**kw))

    def woods(self, trees=None, rid="w"):
        return region(rid, 8, self.WOODS) if trees is None else type(region(rid, 8, self.WOODS)).model_validate({"id": rid, "class": 8, "outer": self.WOODS, "trees": trees})

    def landmarks(self, *lms):
        path = self.bundle / "course.json"
        Course.read(path).model_copy(update={"landmarks": list(lms)}).write(path)

    def test_a_bundle_with_no_woods_has_no_trees(self):
        out = build_bundle(self.bundle)
        self.assertEqual((out.trees, trees_of(self.bundle).size), (0, 0))
        self.assertEqual(Course.read(self.bundle / "course.json").trees.count, 0)

    def test_woods_are_planted_and_the_bundle_validates(self):
        self.regions(self.woods())
        out = build_bundle(self.bundle)
        trees = trees_of(self.bundle)
        self.assertGreater(trees.size, 60)
        self.assertEqual(out.trees, trees.size)
        self.assertEqual(Course.read(self.bundle / "course.json").trees.count, trees.size)
        self.assertEqual((self.bundle / "trees.bin").stat().st_size, trees.size * spec.TREE_RECORD_BYTES)
        self.assertEqual(validate_bundle(self.bundle).errors, [])

    def test_trees_stand_in_the_woods_and_nowhere_else(self):
        self.regions(self.woods())
        build_bundle(self.bundle)
        t = trees_of(self.bundle)
        self.assertTrue(((t["x"] >= 20) & (t["x"] <= 80) & (t["z"] >= 20) & (t["z"] <= 70)).all())

    def test_a_fairway_painted_over_the_woods_has_no_trees(self):
        self.regions(self.woods(), region("f", 1, rect(30, 30, 60, 60)))
        build_bundle(self.bundle)
        t = trees_of(self.bundle)
        self.assertFalse(((t["x"] > 31) & (t["x"] < 59) & (t["z"] > 31) & (t["z"] < 59)).any())

    def test_the_same_design_builds_the_same_trees_bytes(self):
        self.regions(self.woods())
        build_bundle(self.bundle)
        first = (self.bundle / "trees.bin").read_bytes()
        build_bundle(self.bundle)
        self.assertEqual((self.bundle / "trees.bin").read_bytes(), first)

    def test_a_patchs_own_spacing_beats_the_defaults_and_the_defaults_beat_nothing(self):
        self.regions(self.woods())
        self.edits(defaults=ForestSettings(spacing=4, edgeThinning=0))
        dense = build_bundle(self.bundle).trees
        self.edits(defaults=ForestSettings(spacing=8, edgeThinning=0))
        sparse = build_bundle(self.bundle).trees
        self.assertGreater(dense, 3 * sparse)
        self.regions(self.woods(ForestSettings(spacing=4, edgeThinning=0)))
        self.assertEqual(build_bundle(self.bundle).trees, dense)  # its own settings win over the (sparser) defaults

    def test_kind_weights_are_by_name(self):
        self.regions(self.woods(ForestSettings(spacing=3, edgeThinning=0, kinds={"pine": 1.0, "broadleaf": 0.0, "fir": 0.0})))
        build_bundle(self.bundle)
        self.assertEqual(set(trees_of(self.bundle)["kind"].tolist()), {0})

    def test_placed_trees_are_in_the_file_and_clear_the_forest_around_them(self):
        self.regions(self.woods())
        self.edits(defaults=ForestSettings(spacing=2.5, edgeThinning=0), added=[PlacedTree(x=50, z=45, height=22, kind=2)])
        build_bundle(self.bundle)
        t = trees_of(self.bundle)
        self.assertEqual((float(t[-1]["x"]), float(t[-1]["z"]), int(t[-1]["height_cm"]), int(t[-1]["kind"])), (50.0, 45.0, 2200, 2))
        near = np.hypot(t["x"] - 50, t["z"] - 45) < 3
        self.assertEqual(int(near.sum()), 1)  # the placed tree alone

    def test_a_landmark_clears_the_forest_around_it(self):
        self.regions(self.woods())
        self.edits(defaults=ForestSettings(spacing=2.5, edgeThinning=0))
        before = trees_of(self.bundle) if build_bundle(self.bundle) else None
        self.landmarks(Landmark(name="Old Oak", kind="oak", x=50, z=45, clearance=9))
        build_bundle(self.bundle)
        after = trees_of(self.bundle)
        self.assertGreater(int((np.hypot(before["x"] - 50, before["z"] - 45) < 8).sum()), 10)
        self.assertEqual(int((np.hypot(after["x"] - 50, after["z"] - 45) < 8.4).sum()), 0)
        self.assertEqual(Course.read(self.bundle / "course.json").landmarks[0].clearance, 9)  # the build keeps the landmark

    def test_a_hand_drawn_clearing_is_applied_and_given_back_when_removed(self):
        self.regions(self.woods())
        self.edits(defaults=ForestSettings(spacing=2.5, edgeThinning=0), removed=[Clearing(x=50, z=45, r=10)])
        build_bundle(self.bundle)
        self.assertEqual(int((np.hypot(trees_of(self.bundle)["x"] - 50, trees_of(self.bundle)["z"] - 45) < 9.4).sum()), 0)
        self.edits(defaults=ForestSettings(spacing=2.5, edgeThinning=0))
        build_bundle(self.bundle)
        self.assertGreater(int((np.hypot(trees_of(self.bundle)["x"] - 50, trees_of(self.bundle)["z"] - 45) < 9.4).sum()), 10)

    def test_the_build_notes_a_weight_for_a_kind_the_look_lacks(self):
        self.regions(self.woods(ForestSettings(kinds={"cypress": 1.0})))
        self.assertTrue(any("cypress" in n for n in build_bundle(self.bundle).notes))

    def test_the_look_s_kinds_are_what_the_forest_is_made_of(self):
        self.regions(self.woods(ForestSettings(spacing=3, edgeThinning=0)))
        path = self.bundle / "course.json"
        course = Course.read(path)
        look = course.look.model_copy(deep=True)
        look.trees.kinds = look.trees.kinds[:1]  # one model only
        course.model_copy(update={"look": look}).write(path)
        build_bundle(self.bundle)
        self.assertEqual(set(trees_of(self.bundle)["kind"].tolist()), {0})


class ModelTests(unittest.TestCase):
    def test_only_woods_regions_have_tree_settings(self):
        region("a", 8, rect(0, 0, 5, 5))
        with self.assertRaises(ValidationError):
            type(region("a", 8, rect(0, 0, 5, 5))).model_validate({"id": "a", "class": 1, "outer": rect(0, 0, 5, 5), "trees": {}})

    def test_settings_are_kept_in_range(self):
        for field, bad in (("spacing", 1), ("spacing", 21), ("heightScale", 0.4), ("edgeThinning", -1), ("edgeDensity", 1.1), ("seed", -1), ("kinds", {"pine": 2})):
            with self.assertRaises(ValidationError, msg=f"{field} = {bad}"):
                ForestSettings(**{field: bad})

    def test_a_tree_edit_is_kept_in_range(self):
        for bad in ({"x": 1, "z": 1, "height": 0, "kind": 0}, {"x": 1, "z": 1, "height": 70, "kind": 0}, {"x": 1, "z": 1, "height": 5, "kind": 8}):
            with self.assertRaises(ValidationError):
                PlacedTree(**bad)
        with self.assertRaises(ValidationError):
            Clearing(x=0, z=0, r=0)

    def test_the_look_refuses_two_tree_kinds_with_one_name(self):
        data = default_look().model_dump()
        data["trees"]["kinds"][1]["name"] = data["trees"]["kinds"][0]["name"]
        with self.assertRaisesRegex(ValueError, "different names"):
            Look.model_validate(data)

    def test_a_landmark_clearance_is_optional_and_positive(self):
        self.assertIsNone(Landmark(name="a", kind="b", x=0, z=0).clearance)
        self.assertEqual(Landmark(name="a", kind="b", x=0, z=0, clearance=6).clearance, 6)
        with self.assertRaises(ValidationError):
            Landmark(name="a", kind="b", x=0, z=0, clearance=0)


class TreeEndpointTests(BundleCase):
    def setUp(self):
        super().setUp()
        self.root = self.tmp / "data"
        self.root.mkdir()
        shutil.move(str(self.bundle), str(self.root / "b"))
        self.bundle = self.root / "b"
        self.client = TestClient(create_app(self.root))
        self.client.app.state.builds.debounce = 0.05
        self.q = {"path": "b"}

    def tearDown(self):
        self.client.close()
        super().tearDown()

    def test_the_design_carries_the_tree_edits_and_they_can_be_saved(self):
        doc = self.client.get("/api/bundle/design", params=self.q).json()
        self.assertEqual(doc["trees"]["added"], [])
        self.assertEqual(doc["trees"]["defaults"]["spacing"], 5)
        body = {"defaults": {"spacing": 6}, "added": [{"x": 40, "z": 40, "height": 15, "kind": 1}], "removed": [{"x": 30, "z": 30, "r": 5}]}
        self.assertEqual(self.client.put("/api/bundle/design/trees", params=self.q, json=body).status_code, 204)
        saved = self.client.get("/api/bundle/design", params=self.q).json()["trees"]
        self.assertEqual((saved["defaults"]["spacing"], saved["added"][0]["kind"], saved["removed"][0]["r"]), (6, 1, 5))
        self.assertTrue((store.design_dir(self.bundle) / "trees.json").is_file())

    def test_saving_trees_builds_them_and_the_status_counts_them(self):
        regions = {"regions": [{"id": "w", "class": 8, "outer": rect(20, 20, 80, 70), "inner": []}]}
        self.client.put("/api/bundle/design/regions", params=self.q, json=regions)
        self.client.app.state.builds.wait_idle(self.bundle)
        self.client.put("/api/bundle/design/trees", params=self.q, json={"defaults": {"spacing": 4}, "added": [], "removed": []})
        status = self.client.app.state.builds.wait_idle(self.bundle)
        self.assertEqual(status.state, "done")
        self.assertGreater(status.trees, 60)
        self.assertEqual(status.trees, trees_of(self.bundle).size)

    def test_a_setting_out_of_range_is_refused_with_the_field_named_and_nothing_is_saved(self):
        body = {"defaults": {"spacing": 0.5}, "added": [], "removed": []}
        res = self.client.put("/api/bundle/design/trees", params=self.q, json=body)
        self.assertEqual(res.status_code, 422)
        self.assertIn("spacing", json.dumps(res.json()))
        self.assertFalse((store.design_dir(self.bundle) / "trees.json").exists())

    def test_tree_settings_ride_with_the_regions(self):
        body = {"regions": [{"id": "w", "class": 8, "outer": rect(20, 20, 80, 70), "inner": [], "trees": {"spacing": 7, "kinds": {"pine": 0.5}}}]}
        self.assertEqual(self.client.put("/api/bundle/design/regions", params=self.q, json=body).status_code, 204)
        got = self.client.get("/api/bundle/design", params=self.q).json()["regions"]["regions"][0]
        self.assertEqual((got["trees"]["spacing"], got["trees"]["kinds"]), (7, {"pine": 0.5}))
        bad = {"regions": [{"id": "f", "class": 1, "outer": rect(0, 0, 5, 5), "inner": [], "trees": {}}]}
        self.assertEqual(self.client.put("/api/bundle/design/regions", params=self.q, json=bad).status_code, 422)

    def test_a_bad_trees_file_is_reported_and_left_alone(self):
        path = store.design_dir(self.bundle) / "trees.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text('{"defaults": {"spacing": 99}}')
        self.assertEqual(self.client.get("/api/bundle/design", params=self.q).status_code, 422)
        self.assertEqual(path.read_text(), '{"defaults": {"spacing": 99}}')

    def test_backups_include_the_tree_edits(self):
        self.client.put("/api/bundle/design/trees", params=self.q, json={"defaults": {"spacing": 6}, "added": [], "removed": []})
        self.client.app.state.builds.wait_idle(self.bundle)
        name = self.client.get("/api/bundle/design/backups", params=self.q).json()["backups"][0]
        self.assertTrue((self.bundle / ".course_maker" / "backups" / name / "trees.json").is_file())


if __name__ == "__main__":
    unittest.main()
