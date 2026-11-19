"""Cropping a bundle to a smaller rectangle of itself, and taking it back. Run from the repo root:
python -m unittest discover -s course_maker/tests -t ."""
import json
import unittest

import numpy as np
from fastapi.testclient import TestClient

from course_maker.build import height
from course_maker.build.build import build_bundle
from course_maker.build.crop import CropError, crop_bundle, list_crops, undo_crop
from course_maker.build.manager import BuildManager
from course_maker.compiler.codec import decode_height, read_png
from course_maker.compiler.validate import validate_bundle
from course_maker.design import store
from course_maker.design.models import DesignHole, PlacedTree, Clearing, TreeEdits
from course_maker.models import Course, Viewport
from course_maker.server.app import create_app
from course_maker.project.store import read_editor, write_editor
from course_maker.tests.test_design import BundleCase, area, rect, region


def heights_of(bundle):
    course = Course.read(bundle / "course.json")
    rgba, _ = read_png(bundle / "height.png")
    return decode_height(rgba, course.hMin, course.hMax)


class CropTests(BundleCase):
    def setUp(self):
        super().setUp()
        self.regions(
            region("green", 2, rect(60, 40, 70, 50), hole=1),
            region("tee", 4, rect(20, 20, 26, 26), hole=1),
            region("long", 1, rect(10, 70, 110, 80)),  # crosses both sides of any crop below
            region("away", 5, rect(100, 5, 110, 12)),
        )
        self.layout(name="Cropped", holes=[DesignHole(number=1, par=4, route=[(23, 23), (65, 45)])])
        self.bounds(area("b1", 1, rect(5, 5, 90, 60)))
        store.write_design_file(self.bundle, "trees", TreeEdits(added=[PlacedTree(x=30, z=30, height=8, kind=0), PlacedTree(x=105, z=10, height=8, kind=0)], removed=[Clearing(x=50, z=50, r=3)]))
        d = np.zeros((95, 119), np.float32)
        d[40:50, 60:70] = 1.5
        d[5:10, 100:110] = -2.0
        store.design_dir(self.bundle).joinpath("height").mkdir(parents=True, exist_ok=True)
        height.write_delta_bytes(self.bundle, height.encode_delta(d), 95, 119)
        build_bundle(self.bundle)
        self.before = Course.read(self.bundle / "course.json")
        self.heights = heights_of(self.bundle)

    def crop(self, x0=15, z0=10, x1=90, z1=75):
        return crop_bundle(self.bundle, x0, z0, x1, z1)

    def test_the_grids_and_the_place_on_the_earth_move_together(self):
        result = self.crop()
        c = Course.read(self.bundle / "course.json")
        self.assertEqual((c.height.cols, c.height.rows), (76, 66))
        self.assertEqual((c.class_.cols, c.class_.rows, c.bounds.cols, c.bounds.rows), (150, 130, 75, 65))
        self.assertEqual((result.cols, result.rows), (76, 66))
        self.assertAlmostEqual(c.originEasting, self.before.originEasting + 15)  # the test stack is in metres
        self.assertAlmostEqual(c.originNorthing, self.before.originNorthing - 10)  # z runs south
        self.assertEqual(c.hMin, self.before.hMin)

    def test_the_heights_are_the_same_ground_not_resampled(self):
        self.crop()
        self.assertTrue(np.array_equal(heights_of(self.bundle), self.heights[10:76, 15:91]))

    def test_the_sculpting_and_the_base_follow(self):
        self.crop()
        delta = height.read_delta(self.bundle, 66, 76)
        self.assertAlmostEqual(float(delta[30:40, 45:55].min()), 1.5, places=3)  # 40:50, 60:70 moved by (10, 15)
        self.assertEqual(float(delta[0:5, :].max()), 0.0)
        build_bundle(self.bundle)  # the build starts from the cropped base, and keeps the sculpting rather than baking it in
        self.assertTrue(np.array_equal(height.read_delta(self.bundle, 66, 76) != 0, delta != 0))
        info = json.loads((height.base_dir(self.bundle) / "height.json").read_text())  # the base keeps its own range
        base = decode_height(read_png(height.base_dir(self.bundle) / "height.png")[0], info["hMin"], info["hMax"])
        self.assertAlmostEqual(float(heights_of(self.bundle)[35, 50] - base[35, 50]), 1.5, places=2)

    def test_the_design_is_moved_and_cut_to_the_map(self):
        result = self.crop()
        regions = {r.id: r for r in store.read_regions(self.bundle).regions}
        self.assertEqual(regions["green"].outer[0], (45, 30))
        self.assertEqual(regions["green"].hole, 1)
        self.assertNotIn("away", regions)  # wholly outside
        xs = [p[0] for p in regions["long"].outer]
        self.assertEqual((min(xs), max(xs)), (0, 75))  # cut at both sides
        self.assertTrue(any("lay wholly outside" in n for n in result.notes))
        self.assertEqual(store.read_layout(self.bundle).holes[0].route, [(8, 13), (50, 35)])
        self.assertEqual(store.read_layout(self.bundle).name, "Cropped")
        corners = store.read_bounds(self.bundle).areas[0].outer
        self.assertEqual((min(p[0] for p in corners), min(p[1] for p in corners), max(p[0] for p in corners)), (0, 0, 75))  # corner (5, 5) was before the map; x 90 is its edge
        trees = store.read_trees(self.bundle)
        self.assertEqual([(t.x, t.z) for t in trees.added], [(15, 20)])  # the other tree is outside
        self.assertEqual([(c.x, c.z) for c in trees.removed], [(35, 40)])

    def test_the_build_after_a_crop_is_valid_and_has_the_surfaces_in_the_right_place(self):
        self.crop()
        out = build_bundle(self.bundle)
        self.assertEqual(out.report.errors, [])
        klass, _ = read_png(self.bundle / "class.png")
        self.assertEqual(klass.shape[:2], (130, 150))
        self.assertEqual(klass[2 * 30 + 2, 2 * 45 + 2, 0], 2)  # inside the green, now at (45, 30)
        self.assertEqual(klass[2 * 30 + 2, 2 * 45 + 2, 1], 1)
        self.assertEqual(out.holes, 1)
        self.assertEqual(Course.read(self.bundle / "course.json").holes[0].route[0], (8, 13))

    def test_a_crop_beyond_the_map_or_too_small_or_the_whole_map_is_refused_and_changes_nothing(self):
        before = (self.bundle / "course.json").read_bytes()
        for box in ((-1, 0, 50, 50), (0, 0, 500, 50), (0, 0, 4, 50), (0, 0, 118, 94), (1.5, 0, 50, 50)):
            with self.assertRaises(CropError):
                crop_bundle(self.bundle, *box)
        self.assertEqual((self.bundle / "course.json").read_bytes(), before)
        self.assertEqual(list_crops(self.bundle), [])

    def test_a_patch_the_crop_would_cut_stops_it(self):
        course = Course.read(self.bundle / "course.json")
        patch = {"file": "patches/p0.png", "x0": 80, "z0": 60, "cellsX": 20, "cellsZ": 20}
        (self.bundle / "course.json").write_text(json.dumps({**json.loads(course.model_dump_json(by_alias=True, exclude_none=True)), "patches": [patch]}), encoding="utf-8")
        with self.assertRaises(CropError):
            self.crop()

    def test_taking_it_back_restores_the_bundle_and_the_design_exactly(self):
        files = {n: (self.bundle / n).read_bytes() for n in ("course.json", "height.png", "class.png", "bounds.png", "trees.bin")}
        design = {p.name: p.read_bytes() for p in store.design_dir(self.bundle).glob("*.json")} | {"macro.delta": height.delta_path(self.bundle).read_bytes()}
        self.crop()
        self.assertEqual(len(list_crops(self.bundle)), 1)
        undo_crop(self.bundle)
        self.assertEqual(list_crops(self.bundle), [])
        for name, data in files.items():
            self.assertEqual((self.bundle / name).read_bytes(), data, name)
        for p in store.design_dir(self.bundle).glob("*.json"):
            self.assertEqual(p.read_bytes(), design[p.name], p.name)
        self.assertEqual(height.delta_path(self.bundle).read_bytes(), design["macro.delta"])
        self.assertTrue(validate_bundle(self.bundle).ok)
        out = build_bundle(self.bundle)  # and it still builds as before
        self.assertEqual(out.report.errors, [])
        self.assertTrue(np.array_equal(heights_of(self.bundle), self.heights))

    def test_the_saved_view_is_cleared_because_it_was_in_the_old_coordinates(self):
        state = read_editor(self.bundle).state
        write_editor(self.bundle, state.model_copy(update={"viewport": Viewport(x=90.0, z=80.0, scale=4.0)}))
        self.crop()
        self.assertIsNone(read_editor(self.bundle).state.viewport)

    def test_two_crops_in_a_row_can_be_taken_back_in_turn(self):
        self.crop()
        crop_bundle(self.bundle, 5, 5, 60, 50)
        c = Course.read(self.bundle / "course.json")
        self.assertEqual((c.height.cols, c.height.rows), (56, 46))
        undo_crop(self.bundle)
        self.assertEqual(Course.read(self.bundle / "course.json").height.cols, 76)
        undo_crop(self.bundle)
        self.assertEqual(Course.read(self.bundle / "course.json").height.cols, 119)


class CropEndpointTests(BundleCase):
    def setUp(self):
        super().setUp()
        self.client = TestClient(create_app(self.tmp))
        self.q = {"path": "bundle"}

    def test_crop_lists_and_undo_over_http(self):
        self.assertEqual(self.client.get("/api/bundle/crops", params=self.q).json(), {"crops": []})
        r = self.client.post("/api/bundle/crop", params=self.q, json={"x0": 10, "z0": 10, "x1": 60, "z1": 50})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual((r.json()["cols"], r.json()["rows"], len(r.json()["crops"])), (51, 41, 1))
        self.client.app.state.builds.wait_idle(self.bundle)  # the build that follows a crop makes a valid bundle of the new size
        self.assertTrue(self.client.get("/api/bundle/validate", params=self.q).json()["ok"])
        self.assertEqual(self.client.get("/api/bundle", params=self.q).json()["height"]["cols"], 51)
        self.assertEqual(self.client.post("/api/bundle/crop/undo", params=self.q).json(), {"crops": []})
        self.assertEqual(self.client.get("/api/bundle", params=self.q).json()["height"]["cols"], 119)

    def test_a_bad_crop_is_refused_with_a_reason(self):
        r = self.client.post("/api/bundle/crop", params=self.q, json={"x0": 0, "z0": 0, "x1": 3, "z1": 50})
        self.assertEqual(r.status_code, 422)
        self.assertIn("at least", r.json()["detail"])
        self.assertEqual(self.client.post("/api/bundle/crop/undo", params=self.q).status_code, 404)


class HoldTests(BundleCase):
    def test_no_build_runs_while_a_bundle_is_held_and_one_runs_after(self):
        mgr = BuildManager(debounce=0.05)
        with mgr.exclusive(self.bundle):
            mgr.schedule(self.bundle, delay=0)
            self.assertEqual(mgr.run_now(self.bundle).id, 0)
            mgr.wait_idle(self.bundle)
            self.assertEqual(mgr.status(self.bundle).id, 0)
        mgr.schedule(self.bundle, delay=0)
        self.assertEqual(mgr.wait_idle(self.bundle).id, 1)


if __name__ == "__main__":
    unittest.main()
