"""Terrain sculpting: the sparse delta file, the base cache, and the heights a build makes. Run from the repo root:
python -m unittest discover -s course_maker/tests -t ."""
import shutil
import unittest

import numpy as np
from fastapi.testclient import TestClient

from course_maker.build import height
from course_maker.build.build import build_bundle
from course_maker.compiler.bake import bake
from course_maker.compiler.codec import decode_height, read_png
from course_maker.design.store import DesignError, snapshot, restore
from course_maker.models import Course
from course_maker.server.app import create_app
from course_maker.tests.test_design import BundleCase


def heights_of(bundle):
    course = Course.read(bundle / "course.json")
    rgba, _ = read_png(bundle / "height.png")
    return decode_height(rgba, course.hMin, course.hMax), course


class DeltaFileTests(unittest.TestCase):
    def test_round_trip_to_the_millimetre_and_only_touched_tiles_are_stored(self):
        d = np.zeros((150, 200), np.float32)
        d[70:75, 130:140] = 1.2345
        d[149, 199] = -0.5  # the last, partial, tile
        data = height.encode_delta(d)
        self.assertEqual(height.HEADER.unpack_from(data)[5], 2)
        back = height.decode_delta(data, 150, 200)
        self.assertTrue(np.allclose(back, d, atol=0.0006))
        self.assertEqual(back[0, 0], 0)

    def test_an_empty_delta_is_just_a_header(self):
        self.assertEqual(len(height.encode_delta(np.zeros((10, 10), np.float32))), height.HEADER.size)

    def test_a_file_for_another_grid_or_a_damaged_one_is_refused(self):
        data = height.encode_delta(np.ones((70, 70), np.float32))
        with self.assertRaises(DesignError):
            height.decode_delta(data, 70, 71)
        with self.assertRaises(DesignError):
            height.decode_delta(data[:-2], 70, 70)
        with self.assertRaises(DesignError):
            height.decode_delta(b"nope" + data[4:], 70, 70)
        with self.assertRaises(DesignError):
            height.decode_delta(b"", 70, 70)

    def test_edits_beyond_32_metres_are_clamped_not_wrapped(self):
        d = np.full((4, 4), 100.0, np.float32)
        self.assertAlmostEqual(float(height.decode_delta(height.encode_delta(d), 4, 4)[0, 0]), 32.767, places=3)


class BuildHeightTests(BundleCase):
    def setUp(self):
        super().setUp()
        self.base_png = (self.bundle / "height.png").read_bytes()
        self.course = Course.read(self.bundle / "course.json")

    def delta(self, fn):
        d = np.zeros((self.course.height.rows, self.course.height.cols), np.float32)
        fn(d)
        height.write_delta_bytes(self.bundle, height.encode_delta(d), *d.shape)
        return d

    def test_no_delta_leaves_height_png_byte_for_byte(self):
        build_bundle(self.bundle)
        self.assertEqual((self.bundle / "height.png").read_bytes(), self.base_png)

    def test_the_build_adds_the_delta_to_the_baked_heights(self):
        before, _ = heights_of(self.bundle)
        d = self.delta(lambda a: a.__setitem__((slice(10, 20), slice(30, 40)), 2.0))
        build_bundle(self.bundle)
        after, course = heights_of(self.bundle)
        self.assertTrue(np.allclose(after - before, d, atol=0.01))
        self.assertGreater(course.hMax, course.hMin)

    def test_rebuilding_does_not_stack_the_delta_on_itself(self):
        before, _ = heights_of(self.bundle)
        d = self.delta(lambda a: a.__setitem__((slice(10, 20), slice(30, 40)), 2.0))
        for _ in range(3):
            build_bundle(self.bundle)
        after, _ = heights_of(self.bundle)
        self.assertTrue(np.allclose(after - before, d, atol=0.01))

    def test_removing_every_edit_restores_the_original_exactly(self):
        self.delta(lambda a: a.__setitem__((slice(10, 20), slice(30, 40)), 2.0))
        build_bundle(self.bundle)
        self.assertNotEqual((self.bundle / "height.png").read_bytes(), self.base_png)
        self.delta(lambda a: None)
        build_bundle(self.bundle)
        self.assertEqual((self.bundle / "height.png").read_bytes(), self.base_png)

    def test_the_range_grows_to_fit_a_big_edit_and_returns_when_it_is_gone(self):
        top = self.course.hMax
        self.delta(lambda a: a.__setitem__((slice(0, 5), slice(0, 5)), 20.0))
        build_bundle(self.bundle)
        grown, course = heights_of(self.bundle)
        self.assertGreater(course.hMax, top + 10)
        self.assertGreater(grown[0, 0], top + 10)
        self.delta(lambda a: None)
        build_bundle(self.bundle)
        self.assertEqual(Course.read(self.bundle / "course.json").hMax, top)

    def test_a_rebake_becomes_the_new_base_and_the_edits_stay_on_top(self):
        d = self.delta(lambda a: a.__setitem__((slice(10, 20), slice(30, 40)), 1.5))
        build_bundle(self.bundle)
        # a bake replaces height.png without touching the project folder
        bake(self.tmp / "stack.tif", self.bundle, "Test", replace=True)
        fresh, _ = heights_of(self.bundle)
        self.assertEqual(Course.read(self.bundle / "course.json").height.cols, self.course.height.cols)
        build_bundle(self.bundle)
        after, _ = heights_of(self.bundle)
        self.assertTrue(np.allclose(after - fresh, d, atol=0.01))

    def test_the_base_is_kept_apart_from_the_built_file(self):
        self.delta(lambda a: a.__setitem__((slice(0, 5), slice(0, 5)), 1.0))
        build_bundle(self.bundle)
        self.assertEqual((height.base_dir(self.bundle) / "height.png").read_bytes(), self.base_png)

    def test_sculpting_is_part_of_the_backups(self):
        self.layout()
        self.delta(lambda a: a.__setitem__((slice(0, 5), slice(0, 5)), 1.0))
        name = snapshot(self.bundle)
        self.assertIsNotNone(name)
        self.delta(lambda a: None)
        restore(self.bundle, name)
        self.assertTrue(height.read_delta(self.bundle, self.course.height.rows, self.course.height.cols).any())


class HeightEndpointTests(BuildHeightTests):
    def setUp(self):
        super().setUp()
        root = self.tmp / "data"
        root.mkdir()
        shutil.move(str(self.bundle), str(root / "b"))
        shutil.copy(self.tmp / "stack.tif", root / "stack.tif")
        self.bundle = root / "b"
        self.client = TestClient(create_app(root))
        self.client.app.state.builds.debounce = 0.05
        self.q = {"path": "b"}

    def tearDown(self):
        self.client.close()
        super().tearDown()

    def test_nothing_sculpted_gives_an_empty_body_and_the_base_is_served(self):
        self.assertEqual(self.client.get("/api/bundle/design/height", params=self.q).content, b"")
        info = self.client.get("/api/bundle/design/height/base", params=self.q).json()
        self.assertEqual((info["hMin"], info["hMax"]), (self.course.hMin, self.course.hMax))
        self.assertEqual(self.client.get("/api/bundle/design/height/base.png", params=self.q).content, self.base_png)

    def test_put_stores_the_file_and_the_build_applies_it(self):
        d = np.zeros((self.course.height.rows, self.course.height.cols), np.float32)
        d[5:10, 5:10] = 3.0
        data = height.encode_delta(d)
        self.assertEqual(self.client.put("/api/bundle/design/height", params=self.q, content=data).status_code, 204)
        self.assertEqual(self.client.get("/api/bundle/design/height", params=self.q).content, data)
        self.assertTrue(self.client.app.state.builds.wait_idle(self.bundle))
        before = decode_height(read_png(height.base_dir(self.bundle) / "height.png")[0], self.course.hMin, self.course.hMax)
        after, _ = heights_of(self.bundle)
        self.assertAlmostEqual(float((after - before)[7, 7]), 3.0, places=1)

    def test_a_file_for_the_wrong_grid_is_refused_and_nothing_is_written(self):
        bad = height.encode_delta(np.ones((10, 10), np.float32))
        res = self.client.put("/api/bundle/design/height", params=self.q, content=bad)
        self.assertEqual(res.status_code, 422)
        self.assertFalse(height.delta_path(self.bundle).exists())


if __name__ == "__main__":
    unittest.main()
