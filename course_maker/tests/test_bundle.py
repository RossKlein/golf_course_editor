"""Run from the repo root:  python -m unittest discover -s course_maker/tests -t ."""
import json
import shutil
import tempfile
import unittest
from pathlib import Path

import numpy as np
import rasterio
from rasterio.transform import from_origin

from pydantic import ValidationError

from course_maker import spec as S
from course_maker.compiler.bake import bake
from course_maker.compiler.codec import decode_height, encode_height, read_png, sample_bilinear, write_png
from course_maker.compiler.validate import validate_bundle
from course_maker.models import Course, Landmark
from course_maker.project.store import read_project, stack_for

LEFT, TOP = 404000.0, 3708000.0


def plane(easting, northing):
    return 50 + 0.01 * (easting - LEFT) + 0.02 * (TOP - northing)


def make_stack(path, width=200, height=160, res=0.6):
    """A 4-band north-up UTM raster whose elevation is a plane, so the expected grid values are exact."""
    cols, rows = np.meshgrid(np.arange(width), np.arange(height))
    easting = LEFT + (cols + 0.5) * res
    northing = TOP - (rows + 0.5) * res
    data = np.zeros((4, height, width), np.float32)
    data[3] = plane(easting, northing)
    with rasterio.open(path, "w", driver="GTiff", count=4, dtype="float32", width=width, height=height,
                       crs="EPSG:26917", transform=from_origin(LEFT, TOP, res, res)) as ds:
        ds.write(data)
        for i, n in enumerate(["red", "green", "blue", "elevation_m"], 1):
            ds.set_band_description(i, n)


class CodecTests(unittest.TestCase):
    def test_height_round_trip_is_within_one_step(self):
        h = np.random.default_rng(1).uniform(10, 20, (30, 40))
        back = decode_height(encode_height(h, 10, 20), 10, 20)
        self.assertLess(np.abs(back - h).max(), 10 / 65535)

    def test_height_outside_range_is_rejected(self):
        with self.assertRaises(ValueError):
            encode_height(np.array([[5.0]]), 10, 20)

    def test_bilinear_is_exact_on_a_plane(self):
        zz, xx = np.mgrid[0:6, 0:8]
        grid = 3 + 0.5 * xx + 0.25 * zz
        self.assertAlmostEqual(float(sample_bilinear(grid, 1.0, 2.3, 3.7)), 3 + 0.5 * 2.3 + 0.25 * 3.7)
        # clamps beyond the edge
        self.assertAlmostEqual(float(sample_bilinear(grid, 1.0, 99, 99)), float(grid[-1, -1]))


class ModelTests(unittest.TestCase):
    def test_unknown_key_is_rejected(self):
        with self.assertRaises(ValidationError):
            Course.model_validate({"nope": 1})

    def test_booleans_and_strings_are_not_numbers(self):
        for bad in (True, "3"):
            with self.assertRaises(ValidationError):
                Landmark.model_validate({"name": "a", "kind": "b", "x": bad, "z": 1})

    def test_blank_names_are_rejected(self):
        with self.assertRaises(ValidationError):
            Landmark.model_validate({"name": "  ", "kind": "b", "x": 1, "z": 1})


class BundleTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp())
        make_stack(cls.tmp / "stack.tif")
        cls.course = bake(cls.tmp / "stack.tif", cls.tmp / "base", "Test Course")

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def setUp(self):
        self.dir = self.tmp / self._testMethodName
        shutil.copytree(self.tmp / "base", self.dir)

    def course_json(self):
        return json.loads((self.dir / "course.json").read_text())

    def save_course(self, d):
        (self.dir / "course.json").write_text(json.dumps(d))

    def assertErrors(self, text):
        report = validate_bundle(self.dir)
        self.assertTrue(any(text in e for e in report.errors), f"{text!r} not in {report.errors}")

    # --- bake ---

    def test_baked_bundle_is_valid(self):
        report = validate_bundle(self.dir)
        self.assertEqual(report.errors, [])
        self.assertEqual((self.course.height.cols, self.course.height.rows), (119, 95))
        self.assertEqual((self.course.class_.cols, self.course.class_.rows), (236, 188))

    def test_bake_records_its_source_stack_in_project_json(self):
        base = self.tmp / "base"
        self.assertEqual(stack_for(base), (self.tmp / "stack.tif").resolve())
        project = read_project(base)
        self.assertEqual(project.stack, "../stack.tif")  # relative to the bundle folder, forward slashes
        self.assertEqual(project.bake.name, "Test Course")
        self.assertFalse((self.tmp / "base.source.json").exists())  # the old sidecar is gone

    def test_the_hidden_project_folder_does_not_affect_validation(self):
        (self.dir / ".course_maker" / "annotations").mkdir(parents=True)
        (self.dir / ".course_maker" / "annotations" / "x.json").write_text("{}")
        self.assertEqual(validate_bundle(self.dir).errors, [])
        self.assertNotIn(".course_maker", " ".join(validate_bundle(self.dir).sizes))

    def test_course_json_round_trips_through_the_model(self):
        d = self.course_json()
        self.assertIn("class", d)
        self.assertEqual(json.loads(Course.model_validate(d).model_dump_json(by_alias=True, exclude_none=True)), d)

    def test_bake_refuses_a_geographic_raster(self):
        with rasterio.open(self.tmp / "geo.tif", "w", driver="GTiff", count=1, dtype="float32", width=4, height=4,
                           crs="EPSG:4326", transform=from_origin(-82, 33.5, 1e-5, 1e-5)) as ds:
            ds.write(np.ones((1, 4, 4), np.float32))
        with self.assertRaises(ValueError):
            bake(self.tmp / "geo.tif", self.tmp / "geo_out", "Geo")

    def test_heights_land_on_the_right_ground(self):
        img, _ = read_png(self.dir / "height.png")
        h = decode_height(img, self.course.hMin, self.course.hMax)
        c, r = np.meshgrid(np.arange(h.shape[1]), np.arange(h.shape[0]))
        expect = plane(self.course.originEasting + c, self.course.originNorthing - r)
        self.assertLess(np.abs(h - expect).max(), 0.003)  # quantization + float32

    # --- validator ---

    def test_missing_manifest_and_files(self):
        (self.dir / "class.png").unlink()
        self.assertErrors("class.png: file is missing")

    def test_path_traversal_is_rejected(self):
        d = self.course_json()
        d["height"]["file"] = "../height.png"
        self.save_course(d)
        self.assertErrors("escapes the bundle")

    def test_dimensions_must_cover_the_macro_extent(self):
        d = self.course_json()
        d["bounds"]["cols"] += 1
        self.save_course(d)
        self.assertErrors("bounds grid must be")

    def test_bad_class_value_and_misplaced_owner(self):
        img, _ = read_png(self.dir / "class.png")
        img = img.copy()
        img[0, 0, 0] = 99
        img[1, 1, 1] = 1  # owner on a rough cell
        write_png(self.dir / "class.png", img)
        self.assertErrors("not a defined class")
        self.assertErrors("not fairway, green or tee")

    def test_tree_file_size_must_match_count(self):
        (self.dir / "trees.bin").write_bytes(b"\0" * 11)
        d = self.course_json()
        d["trees"]["count"] = 1
        self.save_course(d)
        self.assertErrors("does not match count")

    def test_trees_are_checked(self):
        rec = np.zeros(1, dtype=[("x", "<f4"), ("z", "<f4"), ("h", "<u2"), ("k", "u1"), ("r", "u1")])
        rec["x"], rec["z"], rec["h"] = 5000, 5, 900  # far outside the course
        (self.dir / "trees.bin").write_bytes(rec.tobytes())
        d = self.course_json()
        d["trees"]["count"] = 1
        self.save_course(d)
        self.assertErrors("tree outside the course")

    # --- patches ---

    def make_patch(self, name, x0, z0, cx, cz, bump=0.0):
        """A patch whose border matches the macro surface, with an optional bump in the middle."""
        img, _ = read_png(self.dir / "height.png")
        macro = decode_height(img, self.course.hMin, self.course.hMax)
        cols, rows = cx * 4 + 1, cz * 4 + 1
        c, r = np.meshgrid(np.arange(cols), np.arange(rows))
        h = sample_bilinear(macro, 1.0, x0 + c * 0.25, z0 + r * 0.25)
        h[2:-2, 2:-2] += bump
        (self.dir / "patches").mkdir(exist_ok=True)
        write_png(self.dir / name, encode_height(h, self.course.hMin, self.course.hMax))
        return {"file": name, "x0": x0, "z0": z0, "cellsX": cx, "cellsZ": cz}

    def test_good_patch_passes(self):
        d = self.course_json()
        d["patches"] = [self.make_patch("patches/p0.png", 10, 10, 6, 5, bump=0.3)]
        self.save_course(d)
        self.assertEqual(validate_bundle(self.dir).errors, [])

    def test_patch_border_must_match_macro(self):
        d = self.course_json()
        d["patches"] = [self.make_patch("patches/p0.png", 10, 10, 6, 5, bump=0.0)]
        img, _ = read_png(self.dir / "patches/p0.png")
        img = img.copy()
        img[0, 3, 1] = (int(img[0, 3, 1]) + 40) % 256  # nudge a border sample
        write_png(self.dir / "patches/p0.png", img)
        self.save_course(d)
        self.assertErrors("border differs from the macro surface")

    def test_overlapping_patches_are_rejected(self):
        d = self.course_json()
        d["patches"] = [self.make_patch("patches/p0.png", 10, 10, 6, 5), self.make_patch("patches/p1.png", 14, 12, 6, 5)]
        self.save_course(d)
        self.assertErrors("overlap")

    def test_touching_patches_are_allowed(self):
        d = self.course_json()
        d["patches"] = [self.make_patch("patches/p0.png", 10, 10, 6, 5), self.make_patch("patches/p1.png", 16, 10, 6, 5)]
        self.save_course(d)
        self.assertEqual(validate_bundle(self.dir).errors, [])

    def test_patch_must_be_inside_the_macro_grid(self):
        d = self.course_json()
        d["patches"] = [self.make_patch("patches/p0.png", 100, 10, 30, 5)]
        self.save_course(d)
        self.assertErrors("outside the macro grid")

    # --- holes ---

    def add_hole(self, with_bounds=True, split_green=False):
        klass, _ = read_png(self.dir / "class.png")
        klass = klass.copy()
        klass[10:14, 10:14, :2] = (S.TEE, 1)
        klass[40:60, 40:200, :2] = (S.FAIRWAY, 1)
        klass[100:120, 150:170, :2] = (S.GREEN, 1)
        if split_green:
            klass[100:120, 158:162, :2] = (S.COLLAR, 0)
        write_png(self.dir / "class.png", klass)
        bounds = np.zeros((94, 118, 3), np.uint8)
        if with_bounds:
            bounds[..., 0] = 1  # in bounds for hole 1 everywhere
        write_png(self.dir / "bounds.png", bounds)
        d = self.course_json()
        d["holes"] = [{"number": 1, "par": 4, "route": [[5, 5], [90, 60]]}]
        self.save_course(d)

    def test_valid_hole(self):
        self.add_hole()
        self.assertEqual(validate_bundle(self.dir).errors, [])

    def test_owned_cells_must_be_in_bounds(self):
        self.add_hole(with_bounds=False)
        self.assertErrors("out of bounds for it")

    def test_green_must_be_one_region(self):
        self.add_hole(split_green=True)
        self.assertErrors("not one connected region")

    def test_hole_needs_tee_and_green(self):
        self.add_hole()
        d = self.course_json()
        d["holes"].append({"number": 2, "par": 3, "route": [[5, 5], [20, 20]]})
        self.save_course(d)
        self.assertErrors("hole 2: owns no tee cells")
        self.assertErrors("hole 2: owns no green cells")

    def test_hole_numbers_must_be_contiguous(self):
        d = self.course_json()
        d["holes"] = [{"number": 2, "par": 4, "route": [[5, 5], [9, 9]]}]
        self.save_course(d)
        self.assertErrors("1-based and contiguous")


if __name__ == "__main__":
    unittest.main()
