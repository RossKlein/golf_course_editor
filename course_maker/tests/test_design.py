"""Design files, backups, the build, its manager and the endpoints. Run from the repo root:
python -m unittest discover -s course_maker/tests -t ."""
import shutil
import tempfile
import time
import unittest
from pathlib import Path

import numpy as np
from fastapi.testclient import TestClient
from pydantic import ValidationError

from course_maker.build.build import build_bundle
from course_maker.build.manager import BuildManager
from course_maker.compiler.bake import bake
from course_maker.compiler.codec import read_png
from course_maker.design import store
from course_maker.design.models import BoundsArea, BoundsFile, DesignHole, Layout, Region, RegionsFile
from course_maker.models import Course, Hole
from course_maker.server.app import create_app
from course_maker.tests.test_bundle import make_stack


def rect(x0, z0, x1, z1):
    return [[x0, z0], [x1, z0], [x1, z1], [x0, z1], [x0, z0]]


def region(rid, cls, outer, hole=None, inner=None):
    return Region.model_validate({"id": rid, "class": cls, "hole": hole, "outer": outer, "inner": inner or []})


class ModelTests(unittest.TestCase):
    def test_a_ring_must_be_closed(self):
        with self.assertRaises(ValidationError):
            region("a", 1, [[0, 0], [10, 0], [10, 10], [0, 10]])

    def test_only_owned_classes_take_a_hole_number(self):
        region("a", 2, rect(0, 0, 5, 5), hole=3)  # green: fine
        with self.assertRaises(ValidationError):
            region("b", 0, rect(0, 0, 5, 5), hole=3)  # rough

    def test_ids_are_unique_and_class_uses_its_json_name(self):
        r = region("a", 1, rect(0, 0, 5, 5))
        with self.assertRaises(ValidationError):
            RegionsFile(regions=[r, r])
        self.assertIn('"class"', r.model_dump_json(by_alias=True))

    def test_hole_numbers_must_be_contiguous(self):
        Layout(holes=[DesignHole(number=1), DesignHole(number=2)])
        with self.assertRaises(ValidationError):
            Layout(holes=[DesignHole(number=2)])

    def test_bounds_areas_need_closed_rings_unique_ids_and_a_hole(self):
        with self.assertRaises(ValidationError):
            area("a", 1, [[0, 0], [10, 0], [10, 10], [0, 10]])
        with self.assertRaises(ValidationError):
            area("a", 0, rect(0, 0, 5, 5))
        a = area("a", 1, rect(0, 0, 5, 5))
        with self.assertRaises(ValidationError):
            BoundsFile(areas=[a, a])

    def test_unknown_keys_and_bad_classes_are_rejected(self):
        for bad in ({"id": "a", "class": 9, "outer": rect(0, 0, 5, 5)}, {"id": "a", "class": 1, "outer": rect(0, 0, 5, 5), "x": 1}):
            with self.assertRaises(ValidationError):
                Region.model_validate(bad)


def area(aid, hole, outer, inner=None):
    return BoundsArea.model_validate({"id": aid, "hole": hole, "outer": outer, "inner": inner or []})


class BundleCase(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        make_stack(self.tmp / "stack.tif")
        self.bundle = self.tmp / "bundle"
        bake(self.tmp / "stack.tif", self.bundle, "Test")  # 119 x 95 m; class grid 236 x 188 at 0.5 m

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def regions(self, *rs):
        store.write_design_file(self.bundle, "regions", RegionsFile(regions=list(rs)))

    def layout(self, **kw):
        store.write_design_file(self.bundle, "layout", Layout(**kw))

    def bounds(self, *areas):
        store.write_design_file(self.bundle, "bounds", BoundsFile(areas=list(areas)))

    def two_holes(self):
        self.layout(holes=[DesignHole(number=1, route=[(2, 2), (3, 3)]), DesignHole(number=2, route=[(2, 2), (3, 3)])])

    def bounds_mask(self):
        arr, _ = read_png(self.bundle / "bounds.png")
        return arr[..., 0].astype(int) | (arr[..., 1].astype(int) << 8) | (arr[..., 2].astype(int) << 16)

    def klass(self):
        arr, _ = read_png(self.bundle / "class.png")
        return arr


class StoreTests(BundleCase):
    def test_missing_files_give_empty_defaults(self):
        doc = store.read_design(self.bundle)
        self.assertEqual((doc.regions.regions, doc.layout.holes, doc.bounds.areas), ([], [], []))

    def test_bounds_round_trip_and_survive_a_restore(self):
        self.bounds(area("a", 2, rect(1, 1, 9, 9)))
        self.assertEqual(store.read_design(self.bundle).bounds.areas[0].hole, 2)
        name = store.snapshot(self.bundle)
        self.bounds()
        store.restore(self.bundle, name)
        self.assertEqual([a.id for a in store.read_bounds(self.bundle).areas], ["a"])

    def test_round_trip(self):
        self.regions(region("a", 1, rect(1, 1, 9, 9)))
        self.layout(name="Renamed", holes=[DesignHole(number=1, par=3, route=[(1, 1), (9, 9)])])
        doc = store.read_design(self.bundle)
        self.assertEqual(doc.regions.regions[0].outer, [(1, 1), (9, 1), (9, 9), (1, 9), (1, 1)])
        self.assertEqual((doc.layout.name, doc.layout.holes[0].par), ("Renamed", 3))
        self.assertFalse((store.design_dir(self.bundle) / ".gitignore").exists())  # design files are meant to be versioned

    def test_an_invalid_file_is_reported_and_left_alone(self):
        self.regions(region("a", 1, rect(1, 1, 9, 9)))
        path = store.design_dir(self.bundle) / "regions.json"
        path.write_text('{"regions": [{"id": "a", "class": 1}]}')
        before = path.read_text()
        with self.assertRaises(store.DesignError) as ctx:
            store.read_regions(self.bundle)
        self.assertIn("regions.json", str(ctx.exception))
        self.assertEqual(path.read_text(), before)
        self.assertEqual(list(store.design_dir(self.bundle).glob("*.bad")), [])

    def test_backups_skip_unchanged_prune_and_restore(self):
        self.regions(region("a", 1, rect(1, 1, 9, 9)))
        first = store.snapshot(self.bundle)
        self.assertIsNotNone(first)
        self.assertIsNone(store.snapshot(self.bundle))  # unchanged
        for i in range(25):
            self.regions(region(f"r{i}", 1, rect(1, 1, 9 + i, 9)))
            time.sleep(0.002)
            store.snapshot(self.bundle, keep=5)
        names = store.list_backups(self.bundle)
        self.assertEqual(len(names), 5)
        self.assertEqual(names, sorted(names, reverse=True))  # newest first
        self.regions(region("final", 2, rect(2, 2, 3, 3)))
        store.restore(self.bundle, names[-1])
        self.assertNotEqual(store.read_regions(self.bundle).regions[0].id, "final")
        # the design that was replaced is itself a backup, so a restore can be undone
        root = store.project_dir(self.bundle) / store.BACKUP_DIR
        self.assertTrue(any('"final"' in (root / n / "regions.json").read_text() for n in store.list_backups(self.bundle)))
        with self.assertRaises(store.DesignError):
            store.restore(self.bundle, "../../etc")


class BuildTests(BundleCase):
    def test_empty_design_builds_a_valid_bundle(self):
        out = build_bundle(self.bundle)
        self.assertEqual(out.report.errors, [])
        self.assertFalse(self.klass()[..., 0].any())

    def test_a_region_becomes_exact_pixels(self):
        self.regions(region("g", 2, rect(10, 10, 20, 20), hole=1))
        self.layout(holes=[DesignHole(number=1, route=[(2, 2), (15, 15)])])
        build_bundle(self.bundle)
        k = self.klass()
        self.assertEqual(int((k[..., 0] == 2).sum()), 400)  # 10 m x 10 m at 0.5 m cells
        self.assertEqual(int((k[..., 1] == 1).sum()), 400)
        self.assertEqual((k[30, 30, 0], k[30, 30, 1]), (2, 1))  # cell covering z=15..15.5, x=15..15.5
        self.assertEqual(k[19, 30, 0], 0)  # z=9.5: just outside
        self.assertEqual(k[20, 30, 0], 2)  # z=10.0: first row inside

    def test_later_regions_paint_over_earlier_ones(self):
        fairway = region("f", 1, rect(0, 0, 40, 40), hole=1)
        bunker = region("b", 5, rect(10, 10, 20, 20))
        self.regions(fairway, bunker)
        build_bundle(self.bundle)
        k = self.klass()
        self.assertEqual((k[30, 30, 0], k[30, 30, 1]), (5, 0))  # bunker on top, and it owns no hole
        self.assertEqual((k[5, 5, 0], k[5, 5, 1]), (1, 1))
        self.regions(bunker, fairway)  # reversed: the fairway wins
        build_bundle(self.bundle)
        self.assertEqual(self.klass()[30, 30, 0], 1)

    def test_holes_in_a_polygon_stay_empty(self):
        self.regions(region("w", 6, rect(0, 0, 40, 40), inner=[rect(10, 10, 20, 20)]))
        build_bundle(self.bundle)
        k = self.klass()
        self.assertEqual((k[30, 30, 0], k[5, 5, 0]), (0, 6))

    def test_holes_come_from_the_layout_and_unfinished_ones_are_skipped(self):
        self.layout(name="Edited", attribution="Mine", holes=[
            DesignHole(number=1, par=3, route=[(2, 2), (30, 30)]),
            DesignHole(number=2),  # no route yet
            DesignHole(number=3, route=[(5, 5), (9, 9)]),
        ])
        out = build_bundle(self.bundle)
        course = Course.read(self.bundle / "course.json")
        self.assertEqual([h.number for h in course.holes], [1])
        self.assertEqual((course.name, course.attribution, course.holes[0].par), ("Edited", "Mine", 3))
        self.assertTrue(any("hole 2 has no route" in n for n in out.notes))

    def test_until_bounds_are_designed_every_cell_is_in_bounds(self):
        self.layout(holes=[DesignHole(number=1, route=[(2, 2), (3, 3)]), DesignHole(number=2, route=[(2, 2), (3, 3)])])
        build_bundle(self.bundle)
        bounds, _ = read_png(self.bundle / "bounds.png")
        self.assertTrue((bounds[..., 0] == 3).all() and not bounds[..., 1:].any())

    def test_a_hole_is_in_bounds_inside_its_areas_only(self):
        self.two_holes()
        self.bounds(area("a", 1, rect(10, 10, 30, 20)))  # hole 2 has none, so it is in bounds everywhere
        build_bundle(self.bundle)
        m = self.bounds_mask()
        self.assertEqual(int((m & 1).sum()), 20 * 10)
        self.assertEqual((m[15, 20] & 1, m[15, 5] & 1, m[5, 20] & 1), (1, 0, 0))  # row = z, column = x
        self.assertTrue(((m >> 1) & 1).all())

    def test_areas_of_one_hole_are_a_union_and_may_overlap_other_holes(self):
        self.two_holes()
        self.bounds(area("a", 1, rect(0, 0, 20, 20)), area("b", 1, rect(10, 10, 40, 40)), area("c", 2, rect(15, 15, 25, 25)))
        build_bundle(self.bundle)
        m = self.bounds_mask()
        self.assertEqual((m[5, 5] & 3, m[30, 30] & 3, m[18, 18] & 3, m[60, 60] & 3), (1, 1, 3, 0))
        self.assertEqual(int((m & 1).sum()), 400 + 900 - 100)
        self.assertEqual(int(((m >> 1) & 1).sum()), 100)

    def test_a_ring_inside_an_area_is_not_in_bounds(self):
        self.two_holes()
        self.bounds(area("a", 1, rect(0, 0, 40, 40), inner=[rect(10, 10, 20, 20)]))
        build_bundle(self.bundle)
        m = self.bounds_mask()
        self.assertEqual((m[15, 15] & 1, m[5, 5] & 1), (0, 1))

    def test_areas_for_holes_that_are_not_built_are_ignored_with_a_note(self):
        self.layout(holes=[DesignHole(number=1, route=[(2, 2), (3, 3)])])
        self.bounds(area("far", 3, rect(0, 0, 10, 10)))
        out = build_bundle(self.bundle)
        self.assertTrue(any("bounds area far" in n for n in out.notes))
        self.assertTrue((self.bounds_mask() == 1).all())

    def test_owned_surfaces_outside_their_holes_bounds_are_reported(self):
        self.layout(holes=[DesignHole(number=1, route=[(2, 2), (3, 3)])])
        self.regions(region("t", 4, rect(60, 60, 64, 64), hole=1), region("g", 2, rect(10, 10, 20, 20), hole=1))
        self.bounds(area("a", 1, rect(0, 0, 30, 30)))
        out = build_bundle(self.bundle)
        self.assertTrue(any("hole 1" in e and "out of bounds" in e for e in out.report.errors))

    def test_a_bowtie_is_repaired_not_fatal(self):
        out = build_bundle_with(self, region("bow", 1, [[0, 0], [10, 10], [10, 0], [0, 10], [0, 0]]))
        self.assertTrue(any("self-intersecting" in n for n in out.notes))
        self.assertGreater(int((self.klass()[..., 0] == 1).sum()), 0)

    def test_validator_findings_are_reported_but_the_bundle_is_still_written(self):
        self.regions(region("g", 2, rect(10, 10, 20, 20), hole=1))  # hole 1 is not in the layout
        out = build_bundle(self.bundle)
        self.assertTrue(any("not listed in holes" in e for e in out.report.errors))
        self.assertEqual(int((self.klass()[..., 0] == 2).sum()), 400)

    def test_an_unbuildable_design_leaves_the_bundle_untouched(self):
        self.regions(region("g", 2, rect(10, 10, 20, 20)))
        build_bundle(self.bundle)
        before = (self.bundle / "class.png").read_bytes(), (self.bundle / "course.json").read_bytes()
        (store.design_dir(self.bundle) / "regions.json").write_text("{not json")
        with self.assertRaises(store.DesignError):
            build_bundle(self.bundle)
        self.assertEqual(((self.bundle / "class.png").read_bytes(), (self.bundle / "course.json").read_bytes()), before)
        self.assertFalse((self.bundle / ".course_maker" / "build" / "staging").exists())

    def test_the_project_folder_and_unchanged_files_survive(self):
        (self.bundle / ".course_maker" / "editor.json").write_text('{"keep": true}')
        height = (self.bundle / "height.png").read_bytes()
        build_bundle(self.bundle)
        self.assertEqual((self.bundle / ".course_maker" / "editor.json").read_text(), '{"keep": true}')
        self.assertEqual((self.bundle / "height.png").read_bytes(), height)


def build_bundle_with(case, *regions):
    case.regions(*regions)
    return build_bundle(case.bundle)


class ManagerTests(BundleCase):
    def test_a_burst_of_schedules_makes_one_build(self):
        mgr = BuildManager(debounce=0.1)
        self.regions(region("g", 2, rect(10, 10, 20, 20)))
        for _ in range(5):
            mgr.schedule(self.bundle)
        status = mgr.wait_idle(self.bundle)
        self.assertEqual((status.state, status.id, status.regions), ("done", 1, 1))
        self.assertGreater(status.ms["total"], 0)
        self.assertEqual(len(store.list_backups(self.bundle)), 1)

    def test_a_failed_build_reports_why_and_keeps_the_id(self):
        mgr = BuildManager(debounce=0)
        mgr.run_now(self.bundle)
        store.design_dir(self.bundle).mkdir(parents=True, exist_ok=True)
        (store.design_dir(self.bundle) / "regions.json").write_text("{not json")
        status = mgr.run_now(self.bundle)
        self.assertEqual((status.state, status.id), ("failed", 1))
        self.assertIn("regions.json", status.error or "")

    def test_edits_during_a_build_trigger_another(self):
        mgr = BuildManager(debounce=0)
        mgr.run_now(self.bundle)
        self.assertEqual(mgr.status(self.bundle).id, 1)
        mgr.run_now(self.bundle)
        self.assertEqual(mgr.status(self.bundle).id, 2)


class EndpointTests(BundleCase):
    def setUp(self):
        super().setUp()
        self.root = self.tmp / "data"
        self.root.mkdir()
        shutil.move(str(self.bundle), str(self.root / "b"))
        shutil.copy(self.tmp / "stack.tif", self.root / "stack.tif")
        self.bundle = self.root / "b"
        self.client = TestClient(create_app(self.root))
        self.client.app.state.builds.debounce = 0.05
        self.q = {"path": "b"}

    def tearDown(self):
        self.client.close()
        super().tearDown()

    def wait(self):
        return self.client.app.state.builds.wait_idle(self.bundle)

    def test_defaults_then_save_then_the_build_applies_it(self):
        doc = self.client.get("/api/bundle/design", params=self.q).json()
        self.assertEqual((doc["regions"]["regions"], doc["layout"]["holes"]), ([], []))
        body = {"regions": [{"id": "g", "class": 2, "hole": 1, "outer": rect(10, 10, 20, 20), "inner": []}]}
        self.assertEqual(self.client.put("/api/bundle/design/regions", params=self.q, json=body).status_code, 204)
        layout = {"holes": [{"number": 1, "par": 3, "route": [[2, 2], [15, 15]]}]}
        self.assertEqual(self.client.put("/api/bundle/design/layout", params=self.q, json=layout).status_code, 204)
        status = self.wait()
        self.assertEqual(status.state, "done")
        self.assertEqual(self.client.get("/api/bundle/build", params=self.q).json()["id"], status.id)
        self.assertEqual(int((self.klass_at()[..., 0] == 2).sum()), 400)
        self.assertEqual(self.client.get("/api/bundle", params=self.q).json()["holes"][0]["par"], 3)
        self.assertEqual(len(self.client.get("/api/bundle/design/backups", params=self.q).json()["backups"]), 1)

    def klass_at(self):
        arr, _ = read_png(self.bundle / "class.png")
        return arr

    def test_bounds_are_saved_returned_and_built(self):
        self.client.put("/api/bundle/design/layout", params=self.q, json={"holes": [{"number": 1, "route": [[2, 2], [3, 3]]}]})
        body = {"areas": [{"id": "a", "hole": 1, "outer": rect(10, 10, 30, 20), "inner": []}]}
        self.assertEqual(self.client.put("/api/bundle/design/bounds", params=self.q, json=body).status_code, 204)
        self.wait()
        self.assertEqual(self.client.get("/api/bundle/design", params=self.q).json()["bounds"]["areas"][0]["id"], "a")
        self.assertEqual(int((self.bounds_mask() & 1).sum()), 200)
        bad = {"areas": [{"id": "a", "hole": 1, "outer": [[0, 0], [1, 0], [1, 1], [0, 1]], "inner": []}]}
        self.assertEqual(self.client.put("/api/bundle/design/bounds", params=self.q, json=bad).status_code, 422)

    def test_invalid_designs_are_rejected_with_422(self):
        for body in ({"regions": [{"id": "a", "class": 1, "outer": [[0, 0], [1, 0], [1, 1], [0, 1]], "inner": []}]},
                     {"regions": [{"id": "a", "class": 0, "hole": 2, "outer": rect(0, 0, 5, 5), "inner": []}]},
                     {"regions": [{"id": "a", "class": 1, "outer": rect(0, 0, 5, 5), "inner": [], "nope": 1}]}):
            self.assertEqual(self.client.put("/api/bundle/design/regions", params=self.q, json=body).status_code, 422)
        self.assertEqual(self.client.put("/api/bundle/design/layout", params=self.q, json={"holes": [{"number": 2}]}).status_code, 422)
        self.assertFalse((store.design_dir(self.bundle) / "regions.json").exists())

    def test_a_corrupt_design_file_is_a_422_not_a_reset(self):
        (store.design_dir(self.bundle)).mkdir(parents=True)
        path = store.design_dir(self.bundle) / "regions.json"
        path.write_text("{oops")
        self.assertEqual(self.client.get("/api/bundle/design", params=self.q).status_code, 422)
        self.assertEqual(path.read_text(), "{oops")

    def test_design_endpoints_only_touch_bundles(self):
        for path in ("..", "nope", "stack.tif"):
            self.assertEqual(self.client.get("/api/bundle/design", params={"path": path}).status_code, 404, path)
            self.assertEqual(self.client.put("/api/bundle/design/layout", params={"path": path}, json={}).status_code, 404, path)

    def test_post_build_waits_and_reports_problems(self):
        body = {"regions": [{"id": "g", "class": 2, "hole": 1, "outer": rect(10, 10, 20, 20), "inner": []}]}
        self.client.put("/api/bundle/design/regions", params=self.q, json=body)
        status = self.client.post("/api/bundle/build", params=self.q).json()
        self.assertEqual(status["state"], "done")
        self.assertTrue(any("not listed in holes" in e for e in status["report"]["errors"]))  # no hole 1 in the layout yet

    def test_a_replace_bake_reapplies_the_design(self):
        body = {"regions": [{"id": "g", "class": 2, "outer": rect(10, 10, 20, 20), "inner": []}]}
        self.client.put("/api/bundle/design/regions", params=self.q, json=body)
        self.wait()
        res = self.client.post("/api/bake", json={"stack": "stack.tif", "out": "b", "name": "Again", "replace": True})
        self.assertEqual(res.status_code, 200, res.text)
        self.wait()
        self.assertEqual(int((self.klass_at()[..., 0] == 2).sum()), 400)

    def test_files_does_not_serve_the_design(self):
        self.client.put("/api/bundle/design/layout", params=self.q, json={})
        self.assertEqual(self.client.get("/files/b/.course_maker/design/layout.json").status_code, 404)


class RangeBuildTests(BundleCase):
    def as_range(self):
        path = self.bundle / "course.json"
        Course.read(path).model_copy(update={"kind": "range"}).write(path)

    def test_several_greens_and_one_tee_validate(self):
        self.as_range()
        # hole numbers are set on purpose: a range build must ignore them
        self.regions(
            region("tee", 4, rect(10, 10, 20, 16), hole=1),
            region("fair", 1, rect(10, 16, 30, 50), hole=1),
            region("near", 2, rect(12, 50, 22, 58), hole=1),
            region("far", 2, rect(40, 50, 50, 58), hole=1),
        )
        out = build_bundle(self.bundle)
        self.assertEqual(out.report.errors, [])
        saved = Course.read(self.bundle / "course.json")
        self.assertEqual((saved.kind, saved.holes), ("range", []))
        klass = self.klass()
        self.assertFalse(klass[..., 1].any())
        self.assertGreater(int((klass[..., 0] == 2).sum()), 0)
        self.assertGreater(int((klass[..., 0] == 4).sum()), 0)

    def test_two_tees_are_reported_and_the_build_is_kept(self):
        self.as_range()
        self.regions(region("a", 4, rect(10, 10, 16, 16)), region("b", 4, rect(40, 10, 46, 16)))
        out = build_bundle(self.bundle)
        self.assertTrue(any("tees" in e for e in out.report.errors))

    def test_a_range_cannot_list_holes(self):
        course = Course.read(self.bundle / "course.json")
        data = course.model_dump()
        data["kind"] = "range"
        data["holes"] = [Hole(number=1, par=3, route=[(1.0, 1.0), (2.0, 2.0)]).model_dump()]
        with self.assertRaises(ValidationError):
            Course.model_validate(data)


if __name__ == "__main__":
    unittest.main()
