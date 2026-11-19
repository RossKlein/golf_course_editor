"""What a build skips when its inputs did not change. Run with python -m unittest discover -s course_maker/tests -t ."""
import hashlib
import time
import unittest
from unittest import mock

import numpy as np

from course_maker.build import build as build_module
from course_maker.build import height as height_module
from course_maker.build.build import build_bundle
from course_maker.build.height import delta_path, encode_delta
from course_maker.build.manager import BuildManager
from course_maker.build.cache import read_cache
from course_maker.design import store
from course_maker.design.models import ForestSettings, TreeEdits
from course_maker.tests.test_design import BundleCase, rect, region
from course_maker.models import Course


def sha(path):
    return hashlib.sha1(path.read_bytes()).hexdigest()


class CountsEncodes:
    """Counts the slow steps a build runs."""

    def __enter__(self):
        self.pngs = mock.patch.object(build_module, "write_png", wraps=build_module.write_png)
        self.heights = mock.patch.object(height_module, "encode_height", wraps=height_module.encode_height)
        self.png_calls, self.height_calls = self.pngs.__enter__(), self.heights.__enter__()
        return self

    def __exit__(self, *exc):
        self.pngs.__exit__(*exc)
        self.heights.__exit__(*exc)


class BuildCacheTests(BundleCase):
    def sculpt(self, amount=0.3):
        """A little sculpting, so the heights have a delta to apply."""
        rows, cols = (self.course_dims())
        delta = np.zeros((rows, cols), np.float32)
        delta[10:20, 10:20] = amount
        path = delta_path(self.bundle)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(encode_delta(delta))

    def course_dims(self):
        from course_maker.models import Course

        c = Course.read(self.bundle / "course.json")
        return c.height.rows, c.height.cols

    def test_a_second_build_does_not_encode_the_heights_or_the_images_again(self):
        self.sculpt()
        self.regions(region("w", 8, rect(10, 10, 60, 60)))
        with CountsEncodes() as c:
            build_bundle(self.bundle)
            first = (c.png_calls.call_count, c.height_calls.call_count)
            build_bundle(self.bundle)
            second = (c.png_calls.call_count - first[0], c.height_calls.call_count - first[1])
        self.assertEqual(first, (2, 1))  # class.png, bounds.png and the sculpted height.png
        self.assertEqual(second, (0, 0))

    def test_the_same_bytes_come_out_whether_or_not_the_cache_was_used(self):
        self.sculpt()
        self.regions(region("w", 8, rect(10, 10, 60, 60)))
        build_bundle(self.bundle)
        first = {n: sha(self.bundle / n) for n in ("class.png", "bounds.png", "height.png", "trees.bin")}
        build_bundle(self.bundle)
        self.assertEqual(first, {n: sha(self.bundle / n) for n in first})
        (self.bundle / ".course_maker" / "build" / "cache.json").unlink()
        build_bundle(self.bundle)
        self.assertEqual(first, {n: sha(self.bundle / n) for n in first})

    def test_editing_the_trees_changes_only_the_trees(self):
        self.sculpt()
        self.regions(region("w", 8, rect(10, 10, 60, 60)))
        build_bundle(self.bundle)
        before = {n: sha(self.bundle / n) for n in ("class.png", "bounds.png", "height.png", "trees.bin")}
        store.write_design_file(self.bundle, "trees", TreeEdits(defaults=ForestSettings(spacing=3)))
        with CountsEncodes() as c:
            build_bundle(self.bundle)
        self.assertEqual((c.png_calls.call_count, c.height_calls.call_count), (0, 0))
        after = {n: sha(self.bundle / n) for n in before}
        self.assertNotEqual(before["trees.bin"], after["trees.bin"])
        self.assertEqual({k: v for k, v in before.items() if k != "trees.bin"}, {k: v for k, v in after.items() if k != "trees.bin"})

    def test_changing_the_surfaces_encodes_the_class_image_and_not_the_bounds_or_heights(self):
        self.sculpt()
        self.regions(region("w", 8, rect(10, 10, 60, 60)))
        build_bundle(self.bundle)
        self.regions(region("w", 8, rect(10, 10, 70, 70)))
        with CountsEncodes() as c:
            build_bundle(self.bundle)
        self.assertEqual((c.png_calls.call_count, c.height_calls.call_count), (1, 0))

    def test_changing_the_sculpting_encodes_the_heights_again(self):
        self.sculpt(0.3)
        build_bundle(self.bundle)
        before = sha(self.bundle / "height.png")
        self.sculpt(0.9)
        with CountsEncodes() as c:
            build_bundle(self.bundle)
        self.assertEqual(c.height_calls.call_count, 1)
        self.assertNotEqual(before, sha(self.bundle / "height.png"))

    def test_an_image_replaced_behind_the_builds_back_is_made_again(self):
        self.regions(region("w", 8, rect(10, 10, 60, 60)))
        build_bundle(self.bundle)
        good = sha(self.bundle / "class.png")
        (self.bundle / "class.png").write_bytes(b"not a png")
        build_bundle(self.bundle)
        self.assertEqual(sha(self.bundle / "class.png"), good)

    def test_a_broken_cache_is_ignored(self):
        self.regions(region("w", 8, rect(10, 10, 60, 60)))
        build_bundle(self.bundle)
        (self.bundle / ".course_maker" / "build" / "cache.json").write_text("{not json")
        self.assertEqual(read_cache(self.bundle), {})
        self.assertEqual(build_bundle(self.bundle).report.errors, [])

    def test_the_outcome_names_a_hash_for_every_file_it_wrote(self):
        self.regions(region("w", 8, rect(10, 10, 60, 60)))
        out = build_bundle(self.bundle)
        self.assertEqual(set(out.files), {"class.png", "bounds.png", "trees.bin", "course.json", "height.png", Course.read(self.bundle / "course.json").waterMesh})
        for name, digest in out.files.items():
            self.assertEqual(digest, sha(self.bundle / name), name)


class WaitingBuildTests(BundleCase):
    def test_a_build_asked_for_now_cancels_the_one_that_was_waiting(self):
        mgr = BuildManager(debounce=0.2)
        self.regions(region("w", 8, rect(10, 10, 60, 60)))
        with mock.patch("course_maker.build.manager.build_bundle", wraps=build_bundle) as built:
            mgr.schedule(self.bundle)  # what saving a design does
            mgr.run_now(self.bundle)  # and then the editor asks for the build at once
            time.sleep(0.5)  # long enough for the waiting one to have fired, if it had not been cancelled
            mgr.wait_idle(self.bundle)
        self.assertEqual(built.call_count, 1)

    def test_the_status_carries_the_hashes(self):
        mgr = BuildManager(debounce=0.05)
        self.regions(region("w", 8, rect(10, 10, 60, 60)))
        status = mgr.run_now(self.bundle)
        self.assertEqual(status.files["trees.bin"], sha(self.bundle / "trees.bin"))
        self.assertEqual(status.state, "done")


if __name__ == "__main__":
    unittest.main()
