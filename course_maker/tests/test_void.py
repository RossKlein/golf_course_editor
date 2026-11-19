"""Void ground: class 255, no ground at all. Run from the repo root:
python -m unittest discover -s course_maker/tests -t ."""
import unittest

import numpy as np
from pydantic import ValidationError

from course_maker import spec
from course_maker.build.build import build_bundle
from course_maker.compiler.codec import read_png, write_png
from course_maker.compiler.validate import validate_bundle
from course_maker.design.models import DesignHole
from course_maker.tests.test_design import BundleCase, area, rect, region


class VoidModelTests(unittest.TestCase):
    def test_void_is_a_class_a_region_can_have(self):
        r = region("v", spec.VOID, rect(0, 0, 5, 5))
        self.assertEqual(r.class_, 255)

    def test_other_numbers_past_the_classes_are_still_refused(self):
        for bad in (9, 100, 254, 256):
            with self.assertRaises(ValidationError):
                region("v", bad, rect(0, 0, 5, 5))

    def test_void_belongs_to_no_hole_and_has_no_trees(self):
        with self.assertRaises(ValidationError):
            region("v", spec.VOID, rect(0, 0, 5, 5), hole=1)


class VoidBuildTests(BundleCase):
    def test_a_void_region_is_class_255_with_no_owner(self):
        self.regions(region("f", 1, rect(0, 0, 60, 60), hole=1), region("v", spec.VOID, rect(10, 10, 20, 20)))
        self.layout(holes=[DesignHole(number=1, route=[(2, 2), (50, 50)])])
        out = build_bundle(self.bundle)
        k = self.klass()
        self.assertEqual(int((k[..., 0] == 255).sum()), 400)  # 10 m x 10 m at 0.5 m cells
        self.assertEqual(int(k[30, 30, 1]), 0)  # the fairway's owner is gone with its ground
        self.assertEqual((k[5, 5, 0], k[5, 5, 1]), (1, 1))
        self.assertNotIn("class.png: contains values (R) that are not a defined class", out.report.errors)

    def test_painters_order_decides_between_void_and_a_surface(self):
        v, f = region("v", spec.VOID, rect(0, 0, 20, 20)), region("f", 1, rect(0, 0, 20, 20))
        self.regions(f, v)
        build_bundle(self.bundle)
        self.assertEqual(int(self.klass()[10, 10, 0]), 255)
        self.regions(v, f)  # a surface drawn after the void fills it again
        build_bundle(self.bundle)
        self.assertEqual(int(self.klass()[10, 10, 0]), 1)

    def test_no_hole_is_in_bounds_where_there_is_no_ground(self):
        self.regions(region("v", spec.VOID, rect(10, 10, 20, 20)))
        self.layout(holes=[DesignHole(number=1, route=[(2, 2), (3, 3)]), DesignHole(number=2, route=[(2, 2), (3, 3)])])
        build_bundle(self.bundle)
        mask = self.bounds_mask()
        self.assertEqual(int(mask[15, 15]), 0)  # inside the void: nobody's
        self.assertEqual(int(mask[10, 10]), 0)  # its first row and column too (1 m cells, the void covers them whole)
        self.assertEqual(int(mask[9, 15]), 0b11)  # the row before it is ground, in bounds for both
        self.assertEqual(int(mask[20, 15]), 0b11)  # and its far edge is not part of it (x=20 starts the next cell)

    def test_a_half_covered_bounds_cell_stays_in_bounds(self):
        self.regions(region("v", spec.VOID, rect(10.5, 10, 20, 20)))  # starts half way across a 1 m cell
        self.layout(holes=[DesignHole(number=1, route=[(2, 2), (3, 3)])])
        build_bundle(self.bundle)
        mask = self.bounds_mask()
        self.assertEqual(int(mask[15, 10]), 1)
        self.assertEqual(int(mask[15, 11]), 0)

    def test_the_bundle_validates_and_a_hole_whose_green_was_cut_away_is_a_problem(self):
        self.regions(
            region("t", 4, rect(5, 5, 9, 9), hole=1), region("g", 2, rect(30, 30, 40, 40), hole=1), region("v", spec.VOID, rect(0, 0, 119, 20)),
        )
        self.layout(holes=[DesignHole(number=1, route=[(7, 7), (35, 35)])])
        out = build_bundle(self.bundle)
        self.assertTrue(any("hole 1: owns no tee cells" in e for e in out.report.errors))
        self.assertFalse(any("green" in e for e in out.report.errors))

    def test_no_trees_grow_in_a_void(self):
        self.regions(region("w", 8, rect(0, 0, 100, 80)), region("v", spec.VOID, rect(20, 20, 60, 60)))
        build_bundle(self.bundle)
        trees = np.frombuffer((self.bundle / "trees.bin").read_bytes(), spec.TREE_DTYPE)
        self.assertGreater(len(trees), 0)
        inside = (trees["x"] > 20) & (trees["x"] < 60) & (trees["z"] > 20) & (trees["z"] < 60)
        self.assertFalse(inside.any())

    def test_the_validator_accepts_255_and_still_refuses_other_unknown_classes(self):
        build_bundle(self.bundle)
        arr = read_png(self.bundle / "class.png")[0].copy()
        arr[3, 3, 0] = 255
        write_png(self.bundle / "class.png", arr)
        self.assertFalse(any("not a defined class" in e for e in validate_bundle(self.bundle).errors))
        arr[3, 3, 0] = 77
        write_png(self.bundle / "class.png", arr)
        self.assertTrue(any("not a defined class" in e for e in validate_bundle(self.bundle).errors))


if __name__ == "__main__":
    unittest.main()
