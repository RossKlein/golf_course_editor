"""Previewing trees before they are saved, and the memo that makes it quick. Run with python -m unittest discover -s course_maker/tests -t ."""
import shutil
import time
import unittest
from unittest import mock

import numpy as np
from fastapi.testclient import TestClient

from course_maker import spec
from course_maker.build import trees as trees_module
from course_maker.build.build import build_bundle
from course_maker.build.preview import preview_trees
from course_maker.build.trees import forget_forests
from course_maker.design import store
from course_maker.design.models import Clearing, ForestSettings, PlacedTree, TreeEdits
from course_maker.server.app import create_app
from course_maker.tests.test_design import BundleCase, rect
from course_maker.tests.test_trees_build import trees_of


def woods(rid, outer, trees=None):
    from course_maker.design.models import Region

    return Region.model_validate({"id": rid, "class": 8, "outer": outer, "inner": [], "trees": trees})


class PreviewTests(BundleCase):
    def setUp(self):
        super().setUp()
        forget_forests()
        self.west, self.east = rect(5, 10, 55, 85), rect(60, 10, 112, 85)

    def design(self, west=None, east=None, edits=None):
        self.regions(woods("west", self.west, west), woods("east", self.east, east))
        store.write_design_file(self.bundle, "trees", edits or TreeEdits())

    def test_a_preview_is_exactly_what_the_build_writes(self):
        edits = TreeEdits(defaults=ForestSettings(spacing=4), added=[PlacedTree(x=30, z=40, height=18, kind=1)], removed=[Clearing(x=80, z=40, r=8)])
        self.design(west=ForestSettings(spacing=3, seed=2), edits=edits)
        build_bundle(self.bundle)
        built = trees_of(self.bundle)
        forget_forests()
        previewed = preview_trees(self.bundle, edits, {"west": ForestSettings(spacing=3, seed=2), "east": None}).trees
        self.assertEqual(previewed.tobytes(), built.tobytes())

    def test_settings_that_are_not_saved_are_what_is_previewed(self):
        self.design()
        build_bundle(self.bundle)
        saved = trees_of(self.bundle)
        previewed = preview_trees(self.bundle, TreeEdits(), {"west": ForestSettings(spacing=2.5), "east": None}).trees
        self.assertGreater(len(previewed), len(saved))
        # and saving them makes exactly that
        self.design(west=ForestSettings(spacing=2.5))
        build_bundle(self.bundle)
        self.assertEqual(trees_of(self.bundle).tobytes(), previewed.tobytes())

    def test_a_preview_writes_nothing(self):
        self.design()
        build_bundle(self.bundle)
        before = {p.name: p.stat().st_mtime_ns for p in self.bundle.iterdir() if p.is_file()}
        folders = sorted(str(p) for p in self.bundle.rglob("*"))
        preview_trees(self.bundle, TreeEdits(added=[PlacedTree(x=3, z=3, height=10, kind=0)]), {"west": ForestSettings(spacing=3)})
        self.assertEqual({p.name: p.stat().st_mtime_ns for p in self.bundle.iterdir() if p.is_file()}, before)
        self.assertEqual(sorted(str(p) for p in self.bundle.rglob("*")), folders)

    def test_a_region_it_is_not_told_about_keeps_its_saved_settings(self):
        self.design(east=ForestSettings(spacing=3))
        build_bundle(self.bundle)
        built = trees_of(self.bundle)
        previewed = preview_trees(self.bundle, TreeEdits(), {}).trees
        self.assertEqual(previewed.tobytes(), built.tobytes())

    def test_settings_for_a_region_that_is_not_woods_or_does_not_exist_are_ignored(self):
        self.design()
        base = preview_trees(self.bundle, TreeEdits(), {}).trees
        again = preview_trees(self.bundle, TreeEdits(), {"nope": ForestSettings(spacing=2)}).trees
        self.assertEqual(again.tobytes(), base.tobytes())


class MemoTests(BundleCase):
    def setUp(self):
        super().setUp()
        forget_forests()
        self.regions(woods("west", rect(5, 10, 55, 85)), woods("east", rect(60, 10, 112, 85)))

    def planted(self):
        return mock.patch.object(trees_module, "plant_patch", wraps=trees_module.plant_patch)

    def test_a_second_preview_replants_nothing(self):
        with self.planted() as spy:
            preview_trees(self.bundle, TreeEdits(), {})
            first = spy.call_count
            preview_trees(self.bundle, TreeEdits(), {})
        self.assertEqual((first, spy.call_count - first), (2, 0))

    def test_changing_one_patch_replants_only_that_patch(self):
        preview_trees(self.bundle, TreeEdits(), {})
        with self.planted() as spy:
            preview_trees(self.bundle, TreeEdits(), {"west": ForestSettings(spacing=3)})
        self.assertEqual(spy.call_count, 1)
        with self.planted() as spy:
            preview_trees(self.bundle, TreeEdits(), {"west": ForestSettings(spacing=3)})  # the same again
            self.assertEqual(spy.call_count, 0)
            preview_trees(self.bundle, TreeEdits(), {"west": ForestSettings(spacing=5)})  # and back: remembered too
            self.assertEqual(spy.call_count, 0)

    def test_changing_the_woods_defaults_replants_the_patches_that_use_them(self):
        preview_trees(self.bundle, TreeEdits(), {"west": ForestSettings(spacing=3)})
        with self.planted() as spy:
            preview_trees(self.bundle, TreeEdits(defaults=ForestSettings(spacing=7)), {"west": ForestSettings(spacing=3)})
        self.assertEqual(spy.call_count, 1)  # east takes the defaults; west has its own

    def test_placed_trees_and_clearings_replant_nothing(self):
        preview_trees(self.bundle, TreeEdits(), {})
        with self.planted() as spy:
            preview_trees(self.bundle, TreeEdits(added=[PlacedTree(x=9, z=9, height=10, kind=0)], removed=[Clearing(x=30, z=40, r=6)]), {})
        self.assertEqual(spy.call_count, 0)

    def test_new_outlines_replant_everything(self):
        preview_trees(self.bundle, TreeEdits(), {})
        self.regions(woods("west", rect(5, 10, 58, 85)), woods("east", rect(60, 10, 112, 85)))
        with self.planted() as spy:
            preview_trees(self.bundle, TreeEdits(), {})
        self.assertEqual(spy.call_count, 2)

    def test_the_memo_gives_the_same_trees_as_planting_from_scratch(self):
        a = preview_trees(self.bundle, TreeEdits(), {"west": ForestSettings(spacing=3.5)}).trees.tobytes()
        b = preview_trees(self.bundle, TreeEdits(), {"west": ForestSettings(spacing=3.5)}).trees.tobytes()
        forget_forests()
        c = preview_trees(self.bundle, TreeEdits(), {"west": ForestSettings(spacing=3.5)}).trees.tobytes()
        self.assertEqual((a, b), (c, c))

    def test_a_build_after_a_preview_uses_what_was_planted(self):
        preview_trees(self.bundle, TreeEdits(), {})
        with self.planted() as spy:
            build_bundle(self.bundle)
        self.assertEqual(spy.call_count, 0)

    def test_only_a_few_bundles_are_remembered(self):
        for n in range(4):
            trees_module.forest_for(f"/bundle/{n}", "k", lambda: (np.zeros((2, 2), np.uint8), np.zeros((2, 2), np.uint16)))
        self.assertLessEqual(len(trees_module._forests), trees_module.MAX_REMEMBERED)


class PreviewEndpointTests(BundleCase):
    def setUp(self):
        super().setUp()
        forget_forests()
        self.root = self.tmp / "data"
        self.root.mkdir()
        shutil.move(str(self.bundle), str(self.root / "b"))
        self.bundle = self.root / "b"
        self.client = TestClient(create_app(self.root))
        self.q = {"path": "b"}
        self.regions(woods("west", rect(5, 10, 55, 85)))

    def tearDown(self):
        self.client.close()
        super().tearDown()

    def test_it_returns_the_trees_as_trees_bin_would_have_them(self):
        body = {"edits": {"defaults": {"spacing": 4}, "added": [], "removed": []}, "settings": {"west": {"spacing": 3}}}
        res = self.client.post("/api/bundle/trees/preview", params=self.q, json=body)
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.headers["content-type"], "application/octet-stream")
        self.assertEqual(len(res.content) % spec.TREE_RECORD_BYTES, 0)
        self.assertEqual(int(res.headers["x-tree-count"]), len(res.content) // spec.TREE_RECORD_BYTES)
        self.assertGreater(int(res.headers["x-tree-count"]), 100)

    def test_it_saves_nothing_and_builds_nothing(self):
        before = self.client.get("/api/bundle/build", params=self.q).json()["id"]
        self.client.post("/api/bundle/trees/preview", params=self.q, json={"edits": {"defaults": {}, "added": [], "removed": []}, "settings": {}})
        time.sleep(1.2)
        self.assertEqual(self.client.get("/api/bundle/build", params=self.q).json()["id"], before)
        self.assertFalse((store.design_dir(self.bundle) / "trees.json").exists())

    def test_a_setting_out_of_range_is_refused_with_the_field_named(self):
        body = {"edits": {"defaults": {}, "added": [], "removed": []}, "settings": {"west": {"spacing": 0.5}}}
        res = self.client.post("/api/bundle/trees/preview", params=self.q, json=body)
        self.assertEqual(res.status_code, 422)
        self.assertIn("spacing", res.text)

    def test_an_unknown_bundle_is_not_found(self):
        res = self.client.post("/api/bundle/trees/preview", params={"path": "nope"}, json={"edits": {"defaults": {}, "added": [], "removed": []}, "settings": {}})
        self.assertEqual(res.status_code, 404)


if __name__ == "__main__":
    unittest.main()
