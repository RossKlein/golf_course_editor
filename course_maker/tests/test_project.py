"""The .course_maker/ store and the replace-without-deleting bake. Run from the repo root:
python -m unittest discover -s course_maker/tests -t ."""
import json
import os
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from course_maker.compiler import bake as bake_module
from course_maker.compiler.bake import BakeError, bake
from course_maker.compiler.validate import validate_bundle
from course_maker.models import EditorState, LayerPref, Viewport
from course_maker.project import store
from course_maker.tests.test_bundle import make_stack


class EditorStoreTests(unittest.TestCase):
    def setUp(self):
        self.bundle = Path(tempfile.mkdtemp())
        self.file = self.bundle / ".course_maker" / "editor.json"

    def tearDown(self):
        shutil.rmtree(self.bundle, ignore_errors=True)

    def put(self, data):
        self.file.parent.mkdir(exist_ok=True)
        self.file.write_text(data if isinstance(data, str) else json.dumps(data), encoding="utf-8")

    def test_missing_file_gives_defaults(self):
        res = store.read_editor(self.bundle)
        self.assertEqual((res.status, res.state), ("default", EditorState()))
        self.assertFalse(self.file.parent.exists())  # reading never creates the folder

    def test_round_trip_and_inner_gitignore(self):
        state = EditorState(viewport=Viewport(x=1, z=2, scale=3), exaggeration=5,
                            layers={"class": LayerPref(visible=True, opacity=0.5)}, hole=4,
                            contourInterval=0.5, slopeMap=True)
        store.write_editor(self.bundle, state)
        self.assertEqual(store.read_editor(self.bundle).state, state)
        self.assertEqual(store.read_editor(self.bundle).status, "loaded")
        self.assertIn("editor.json", (self.file.parent / ".gitignore").read_text())
        self.assertEqual([p.name for p in self.file.parent.glob("*.tmp")], [])

    def test_failed_write_leaves_the_old_file_intact(self):
        store.write_editor(self.bundle, EditorState(exaggeration=2))
        before = self.file.read_text()
        with mock.patch.object(store.os, "replace", side_effect=OSError("disk full")):
            with self.assertRaises(OSError):
                store.write_editor(self.bundle, EditorState(exaggeration=9))
        self.assertEqual(self.file.read_text(), before)
        self.assertEqual([p.name for p in self.file.parent.glob("*.tmp")], [])

    def test_unreadable_file_is_reset_but_kept_as_bad(self):
        for original in ("{not json", "[1, 2]", '{"version": 2}', "null"):
            with self.subTest(original=original):
                self.put(original)
                res = store.read_editor(self.bundle)
                self.assertEqual((res.status, res.state), ("reset", EditorState()))
                self.assertEqual((self.file.parent / "editor.json.bad").read_text(), original)
                self.assertFalse(self.file.exists())

    def test_invalid_fields_fall_back_and_the_rest_loads(self):
        self.put({"version": 1, "exaggeration": 99, "hole": 3, "mystery": True,
                  "viewport": {"x": 1, "z": 2, "scale": 4}})
        res = store.read_editor(self.bundle)
        self.assertEqual(res.status, "loaded")
        self.assertEqual(res.state.exaggeration, 3.0)  # invalid -> default
        self.assertEqual(res.state.hole, 3)  # valid -> kept
        self.assertEqual(res.state.viewport, Viewport(x=1, z=2, scale=4))
        self.assertTrue(self.file.exists())  # a repaired file is not renamed

    def test_project_file_round_trip_and_missing_stack(self):
        self.assertIsNone(store.read_project(self.bundle))
        self.assertIsNone(store.stack_for(self.bundle))
        (self.bundle / ".course_maker").mkdir()
        (self.bundle / ".course_maker" / "project.json").write_text('{"stack": "nope.tif"}')  # invalid
        self.assertIsNone(store.read_project(self.bundle))


class ReplaceBakeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        make_stack(self.tmp / "stack.tif")
        self.out = self.tmp / "bundles" / "augusta"
        bake(self.tmp / "stack.tif", self.out, "Augusta")
        store.write_editor(self.out, EditorState(exaggeration=8))
        (self.out / ".course_maker" / "annotations").mkdir()
        (self.out / ".course_maker" / "annotations" / "greens.json").write_text('{"keep": "me"}')

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def siblings(self):
        return sorted(p.name for p in self.out.parent.iterdir())

    def test_replace_carries_over_the_project_folder(self):
        (self.out / "height.png").write_bytes(b"corrupt")  # proves the generated files really are rebuilt
        bake(self.tmp / "stack.tif", self.out, "Augusta II", replace=True)
        self.assertEqual(validate_bundle(self.out).errors, [])
        self.assertEqual(store.read_editor(self.out).state.exaggeration, 8)
        self.assertEqual((self.out / ".course_maker/annotations/greens.json").read_text(), '{"keep": "me"}')
        self.assertEqual(store.read_project(self.out).bake.name, "Augusta II")  # project.json is refreshed
        self.assertEqual(self.siblings(), ["augusta"])

    def test_without_replace_nothing_is_touched(self):
        before = (self.out / "course.json").read_text()
        with self.assertRaises(FileExistsError):
            bake(self.tmp / "stack.tif", self.out, "Other")
        self.assertEqual((self.out / "course.json").read_text(), before)
        self.assertEqual(self.siblings(), ["augusta"])

    def test_a_folder_that_is_not_a_bundle_is_never_replaced(self):
        other = self.tmp / "bundles" / "notes"
        other.mkdir()
        (other / "readme.txt").write_text("keep me")
        with self.assertRaises(FileExistsError):
            bake(self.tmp / "stack.tif", other, "X", replace=True)
        self.assertEqual((other / "readme.txt").read_text(), "keep me")

    def test_a_failed_bake_leaves_the_old_bundle_untouched(self):
        before = (self.out / "course.json").read_text()
        with mock.patch.object(bake_module, "macro_grid_from_stack", side_effect=ValueError("no elevation")):
            with self.assertRaises(ValueError):
                bake(self.tmp / "stack.tif", self.out, "Broken", replace=True)
        self.assertEqual((self.out / "course.json").read_text(), before)
        self.assertEqual(store.read_editor(self.out).state.exaggeration, 8)
        self.assertEqual(self.siblings(), ["augusta"])

    def test_an_invalid_new_bundle_is_not_swapped_in(self):
        from course_maker.models import Report

        bad = Report(errors=["boom"])
        before = (self.out / "course.json").read_text()
        with mock.patch.object(bake_module, "validate_bundle", return_value=bad):
            with self.assertRaises(BakeError):
                bake(self.tmp / "stack.tif", self.out, "Invalid", replace=True)
        self.assertEqual((self.out / "course.json").read_text(), before)
        self.assertEqual(self.siblings(), ["augusta"])

    def test_a_failed_swap_puts_the_old_bundle_back(self):
        real = os.replace

        def flaky(src, dst):
            if str(src).endswith(bake_module.BUILDING_SUFFIX):
                raise OSError("locked")
            return real(src, dst)

        before = (self.out / "course.json").read_text()
        with mock.patch.object(bake_module.os, "replace", side_effect=flaky):
            with self.assertRaises(OSError):
                bake(self.tmp / "stack.tif", self.out, "Locked", replace=True)
        self.assertEqual((self.out / "course.json").read_text(), before)
        self.assertEqual(store.read_editor(self.out).state.exaggeration, 8)
        self.assertEqual(self.siblings(), ["augusta"])


if __name__ == "__main__":
    unittest.main()
