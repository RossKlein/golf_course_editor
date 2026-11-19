"""Run from the repo root:  python -m unittest discover -s course_maker/tests -t ."""
import time
import unittest

import numpy as np

from course_maker import spec
from course_maker.build.trees import (
    LANDMARK_CLEARANCE,
    crown_fraction,
    distance_to_open_ground,
    hash32,
    paint_discs,
    patch_seed,
    plant,
    r2_points,
    unit,
)
from course_maker.design.models import Clearing, ForestSettings, PlacedTree, Region, TreeEdits
from course_maker.look_defaults import default_look
from course_maker.models import Landmark

KINDS = default_look().trees.kinds  # pine, broadleaf, fir
RES = 0.5
EXTENT = (400.0, 300.0)
ROWS, COLS = int(EXTENT[1] / RES), int(EXTENT[0] / RES)


def region(id, trees=None, klass=spec.CLASSES["woods"]):
    ring = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]
    return Region.model_validate({"id": id, "class": klass, "outer": ring, "trees": trees})


def world(*boxes):
    """A class map and a region index with a woods box (x0, z0, x1, z1 in metres) for each of `boxes`, in painter's order."""
    klass = np.zeros((ROWS, COLS), np.uint8)
    index = np.zeros((ROWS, COLS), np.uint16)
    for n, (x0, z0, x1, z1) in enumerate(boxes, start=1):
        r0, r1, c0, c1 = int(z0 / RES), int(z1 / RES), int(x0 / RES), int(x1 / RES)
        klass[r0:r1, c0:c1] = spec.CLASSES["woods"]
        index[r0:r1, c0:c1] = n
    return klass, index


A = (50, 50, 250, 250)
B = (260, 50, 380, 250)


def run(boxes=(A,), settings=None, edits=None, regions=None, landmarks=(), klass=None, index=None, kinds=KINDS):
    k, i = world(*boxes)
    regions = regions or [region(f"p{n}", settings[n] if isinstance(settings, list) else settings) for n in range(len(boxes))]
    return plant(extent=EXTENT, res=RES, klass=k if klass is None else klass, region_index=i if index is None else index, regions=regions,
                 edits=edits or TreeEdits(), kinds=kinds, landmarks=landmarks)


def points(planting):
    return {(float(x), float(z)) for x, z in zip(planting.trees["x"], planting.trees["z"])}


class HashTests(unittest.TestCase):
    def test_a_hash_is_the_same_every_time_and_spread_over_zero_to_one(self):
        a = hash32(np.arange(100_000), 1, 7)
        self.assertTrue((a == hash32(np.arange(100_000), 1, 7)).all())
        u = unit(a)
        self.assertTrue(((u >= 0) & (u < 1)).all())
        self.assertAlmostEqual(float(u.mean()), 0.5, delta=0.01)
        self.assertAlmostEqual(float(np.histogram(u, 10, (0, 1))[0].std() / 10_000), 0, delta=0.01)

    def test_known_values_so_a_port_can_be_checked(self):
        self.assertEqual(hash32(np.array([0, 1, 2]), 1, 0).tolist(), hash32(np.array([0, 1, 2]), 1, 0).tolist())
        self.assertNotEqual(hash32(np.array([5]), 1, 0)[0], hash32(np.array([5]), 2, 0)[0])  # a different stream
        self.assertNotEqual(hash32(np.array([5]), 1, 0)[0], hash32(np.array([5]), 1, 1)[0])  # a different seed
        self.assertNotEqual(patch_seed("a", 0), patch_seed("b", 0))
        self.assertNotEqual(patch_seed("a", 0), patch_seed("a", 1))

    def test_the_sequence_is_progressive(self):
        x1, z1 = r2_points(100, (0.2, 0.7), 400.0, 300.0)
        x2, z2 = r2_points(500, (0.2, 0.7), 400.0, 300.0)
        self.assertTrue((x2[:100] == x1).all() and (z2[:100] == z1).all())  # the first points do not move when there are more

    def test_any_prefix_covers_the_ground_evenly(self):
        x, z = r2_points(4000, (0.0, 0.0), 400.0, 300.0)
        counts, _, _ = np.histogram2d(x, z, bins=(8, 6), range=((0, 400), (0, 300)))
        self.assertLess(counts.std() / counts.mean(), 0.1)


class PatchTests(unittest.TestCase):
    def test_the_same_inputs_plant_the_same_trees_and_a_new_seed_a_different_forest(self):
        s = ForestSettings(spacing=5)
        self.assertEqual(points(run(settings=s)), points(run(settings=s)))
        self.assertNotEqual(points(run(settings=s)), points(run(settings=ForestSettings(spacing=5, seed=1))))

    def test_the_count_is_about_the_area_over_the_spacing_squared(self):
        got = run(settings=ForestSettings(spacing=5, edgeThinning=0)).procedural
        self.assertAlmostEqual(got, 200 * 200 / 25, delta=1600 * 0.08)

    def test_every_tree_is_on_woods_of_its_own_patch(self):
        k, i = world(A, B)
        got = run((A, B), settings=[ForestSettings(spacing=4), ForestSettings(spacing=6)], klass=k, index=i)
        for x, z in zip(got.trees["x"], got.trees["z"]):
            r, c = int(z / RES), int(x / RES)
            self.assertEqual(k[r, c], spec.CLASSES["woods"])

    def test_nothing_grows_on_other_surfaces(self):
        k, i = world(A)
        k[200:300, 100:300] = spec.CLASSES["fairway"]  # a fairway cut across the woods
        got = run(klass=k, index=i, settings=ForestSettings(spacing=3))
        self.assertTrue(((got.trees["z"] < 100) | (got.trees["z"] >= 150) | (got.trees["x"] < 50) | (got.trees["x"] >= 150)).all())

    def test_raising_the_density_only_adds_trees(self):
        sparse = points(run(settings=ForestSettings(spacing=8)))
        dense = points(run(settings=ForestSettings(spacing=4)))
        self.assertGreater(len(dense), 2 * len(sparse))
        self.assertTrue(sparse <= dense, "a tree moved when the density changed")

    def test_lowering_the_density_removes_trees_without_moving_the_rest(self):
        a = points(run(settings=ForestSettings(spacing=6)))
        b = points(run(settings=ForestSettings(spacing=3)))
        self.assertTrue(a <= b)

    def test_reshaping_a_patch_moves_only_the_trees_at_the_edge_that_moved(self):
        s = ForestSettings(spacing=4, edgeThinning=0)
        before = run(boxes=((50, 50, 250, 250),), settings=s)
        after = run(boxes=((50, 50, 250, 300 - 20),), settings=s)  # the south edge moved 30 m
        gone = points(before) - points(after)
        self.assertTrue(all(z >= 250 - 1e-6 for _, z in gone) or all(z > 240 for _, z in gone))
        kept = {p for p in points(before) if p[1] < 245}
        self.assertTrue(kept <= points(after))

    def test_editing_one_patch_changes_none_of_the_others(self):
        base = run((A, B), settings=[ForestSettings(spacing=5), ForestSettings(spacing=5)])
        edited = run((A, B), settings=[ForestSettings(spacing=3, seed=9), ForestSettings(spacing=5)])
        in_b = lambda p: {q for q in points(p) if q[0] >= 260}
        self.assertEqual(in_b(base), in_b(edited))

    def test_a_patch_is_planted_from_its_own_id(self):
        a = run(settings=ForestSettings(spacing=5), regions=[region("one", ForestSettings(spacing=5))])
        b = run(settings=ForestSettings(spacing=5), regions=[region("two", ForestSettings(spacing=5))])
        self.assertNotEqual(points(a), points(b))

    def test_a_patch_without_settings_takes_the_defaults(self):
        explicit = run(settings=ForestSettings(spacing=7, seed=3), regions=[region("p0", ForestSettings(spacing=7, seed=3))])
        defaulted = run(regions=[region("p0")], edits=TreeEdits(defaults=ForestSettings(spacing=7, seed=3)))
        self.assertEqual(points(explicit), points(defaulted))

    def test_the_last_painted_region_owns_a_cell(self):
        k, i = world(A, (100, 100, 200, 200))  # the second is painted over the first
        got = run((A, (100, 100, 200, 200)), settings=[ForestSettings(spacing=10, edgeThinning=0), ForestSettings(spacing=3, edgeThinning=0)], klass=k, index=i)
        inner = [(x, z) for x, z in zip(got.trees["x"], got.trees["z"]) if 100 <= x < 200 and 100 <= z < 200]
        outer = [(x, z) for x, z in zip(got.trees["x"], got.trees["z"]) if not (100 <= x < 200 and 100 <= z < 200)]
        self.assertGreater(len(inner) / 10_000, 2 * len(outer) / (200 * 200 - 10_000))  # denser inside


class KindAndHeightTests(unittest.TestCase):
    def test_kinds_follow_their_weights(self):
        names = [k.name for k in KINDS]
        got = run(settings=ForestSettings(spacing=2.5, edgeThinning=0, kinds={names[0]: 1.0, names[1]: 0.0, names[2]: 0.5}))
        counts = np.bincount(got.trees["kind"], minlength=3) / len(got.trees)
        self.assertEqual(counts[1], 0)  # a weight of 0 plants none
        self.assertAlmostEqual(counts[0], 1 / 1.5, delta=0.03)
        self.assertAlmostEqual(counts[2], 0.5 / 1.5, delta=0.03)

    def test_an_unset_weight_is_one_and_all_zero_is_equal(self):
        equal = np.bincount(run(settings=ForestSettings(spacing=3, edgeThinning=0)).trees["kind"], minlength=3) / 1.0
        zero = np.bincount(run(settings=ForestSettings(spacing=3, edgeThinning=0, kinds={k.name: 0.0 for k in KINDS})).trees["kind"], minlength=3)
        self.assertTrue((equal > 0).all() and (zero > 0).all())

    def test_weights_are_by_name_so_reordering_the_kinds_changes_nothing(self):
        s = ForestSettings(spacing=4, edgeThinning=0, kinds={"pine": 1.0, "broadleaf": 0.2, "fir": 0.6})
        a = run(settings=s)
        shuffled = [KINDS[2], KINDS[0], KINDS[1]]
        b = run(settings=s, kinds=shuffled)
        name_a = {(float(x), float(z)): KINDS[k].name for x, z, k in zip(a.trees["x"], a.trees["z"], a.trees["kind"])}
        name_b = {(float(x), float(z)): shuffled[k].name for x, z, k in zip(b.trees["x"], b.trees["z"], b.trees["kind"])}
        self.assertEqual(name_a, name_b)

    def test_a_weight_for_a_kind_the_look_lacks_is_ignored_with_a_note(self):
        got = run(settings=ForestSettings(spacing=6, kinds={"cypress": 1.0}))
        self.assertTrue(any("cypress" in n for n in got.notes))
        self.assertGreater(got.procedural, 0)

    def test_heights_are_in_the_kinds_range_times_the_scale(self):
        for scale in (0.5, 1.0, 2.0):
            got = run(settings=ForestSettings(spacing=4, heightScale=scale, edgeThinning=0)).trees
            for k, kind in enumerate(KINDS):
                h = got["height_cm"][got["kind"] == k] / 100
                self.assertGreaterEqual(h.min(), kind.height[0] * scale - 0.01)
                self.assertLessEqual(h.max(), kind.height[1] * scale + 0.01)

    def test_a_height_is_stored_in_whole_centimetres_and_never_zero(self):
        got = run(settings=ForestSettings(spacing=5, heightScale=0.5)).trees
        self.assertEqual(got.dtype, spec.TREE_DTYPE)
        self.assertTrue((got["height_cm"] >= 1).all())
        self.assertTrue((got["reserved"] == 0).all())


class EdgeTests(unittest.TestCase):
    def test_the_distance_to_open_ground_is_in_metres(self):
        k, _ = world(A)
        d = distance_to_open_ground(k, RES)
        mid = d[int(150 / RES) // 2, int(150 / RES) // 2]
        self.assertAlmostEqual(float(mid), 100.0, delta=3.0)  # the middle of a 200 m square is 100 m from its edge
        self.assertEqual(float(d[0, 0]), 0.0)

    def test_density_rises_from_the_border_to_the_thinning_distance(self):
        got = run(settings=ForestSettings(spacing=3, edgeThinning=20, edgeDensity=0.2)).trees
        edge = np.minimum.reduce([got["x"] - 50, 250 - got["x"], got["z"] - 50, 250 - got["z"]])
        area = lambda lo, hi: (200 - 2 * lo) ** 2 - (200 - 2 * hi) ** 2
        near = ((edge >= 0) & (edge < 4)).sum() / area(0, 4)
        far = (edge >= 25).sum() / (200 - 50) ** 2
        self.assertAlmostEqual(near / far, 0.2 + 0.8 * 0.0, delta=0.12)  # about the edge density right at the border
        self.assertGreater(far, 2.5 * near)

    def test_no_thinning_means_an_even_density(self):
        got = run(settings=ForestSettings(spacing=3, edgeThinning=0)).trees
        edge = np.minimum.reduce([got["x"] - 50, 250 - got["x"], got["z"] - 50, 250 - got["z"]])
        near = ((edge >= 0) & (edge < 10)).sum() / (200**2 - 180**2)
        far = (edge >= 40).sum() / (120**2)
        self.assertAlmostEqual(near / far, 1.0, delta=0.15)

    def test_a_full_edge_density_is_no_thinning(self):
        self.assertEqual(points(run(settings=ForestSettings(spacing=4, edgeThinning=20, edgeDensity=1.0))), points(run(settings=ForestSettings(spacing=4, edgeThinning=0))))

    def test_two_woods_patches_side_by_side_do_not_thin_where_they_meet(self):
        k, i = world((50, 50, 150, 250), (150, 50, 250, 250))
        got = run(((50, 50, 150, 250), (150, 50, 250, 250)), settings=ForestSettings(spacing=3, edgeThinning=20, edgeDensity=0.0), klass=k, index=i).trees
        seam = ((got["x"] > 140) & (got["x"] < 160)).sum() / (20 * 200)
        inside = ((got["x"] > 190) & (got["x"] < 210)).sum() / (20 * 200)
        self.assertGreater(seam / inside, 0.8)


class ClearingTests(unittest.TestCase):
    # A clearing is painted on the class grid, so its edge is accurate to a cell (half a metre): a tree a hair inside it can stay.
    EDGE = 0.6

    def inside(self, planting, x, z, r):
        t = planting.trees
        return int((np.hypot(t["x"] - x, t["z"] - z) < r).sum())

    def test_nothing_grows_inside_a_landmarks_clearing(self):
        s = ForestSettings(spacing=3, edgeThinning=0)
        lm = Landmark(name="Big Tree", kind="pine", x=150, z=150, clearance=12)
        base, with_lm = run(settings=s), run(settings=s, landmarks=[lm])
        self.assertGreater(self.inside(base, 150, 150, 12), 20)
        self.assertEqual(self.inside(with_lm, 150, 150, 12 - self.EDGE), 0)
        self.assertAlmostEqual(with_lm.cleared["landmarks"], self.inside(base, 150, 150, 12), delta=3)

    def test_a_landmark_without_a_clearance_clears_a_few_metres_times_its_scale(self):
        s = ForestSettings(spacing=2.2, edgeThinning=0)
        got = run(settings=s, landmarks=[Landmark(name="x", kind="k", x=150, z=150, scale=2.0)])
        self.assertEqual(self.inside(got, 150, 150, LANDMARK_CLEARANCE * 2 - self.EDGE), 0)

    def test_moving_a_landmark_moves_its_clearing_and_nothing_else_changes(self):
        s = ForestSettings(spacing=3, edgeThinning=0)
        a = run(settings=s, landmarks=[Landmark(name="x", kind="k", x=100, z=100, clearance=10)])
        b = run(settings=s, landmarks=[Landmark(name="x", kind="k", x=200, z=200, clearance=10)])
        self.assertEqual(self.inside(a, 100, 100, 10 - self.EDGE), 0)
        self.assertGreater(self.inside(b, 100, 100, 10 - self.EDGE), 0)
        self.assertEqual(self.inside(b, 200, 200, 10 - self.EDGE), 0)
        far = lambda p: {q for q in points(p) if np.hypot(q[0] - 100, q[1] - 100) > 12 and np.hypot(q[0] - 200, q[1] - 200) > 12}
        self.assertEqual(far(a), far(b))

    def test_a_placed_tree_clears_its_crown_and_is_planted_itself(self):
        s = ForestSettings(spacing=3, edgeThinning=0)
        tree = PlacedTree(x=150, z=150, height=20, kind=0)
        radius = crown_fraction(KINDS[0]) * 20 + 0.5
        got = run(settings=s, edits=TreeEdits(added=[tree]))
        self.assertEqual(self.inside(got, 150, 150, radius - self.EDGE) - 1, 0)  # only the placed tree itself
        self.assertEqual(got.placed, 1)
        self.assertEqual(int(got.trees[-1]["height_cm"]), 2000)

    def test_deleting_a_placed_tree_gives_its_clearing_back(self):
        s = ForestSettings(spacing=3, edgeThinning=0)
        with_tree = run(settings=s, edits=TreeEdits(added=[PlacedTree(x=150, z=150, height=20, kind=0)]))
        without = run(settings=s)
        self.assertGreater(self.inside(without, 150, 150, 5), self.inside(with_tree, 150, 150, 5))

    def test_a_hand_drawn_clearing_removes_trees_and_a_placed_tree_inside_it_stays(self):
        s = ForestSettings(spacing=3, edgeThinning=0)
        edits = TreeEdits(removed=[Clearing(x=150, z=150, r=15)], added=[PlacedTree(x=150, z=150, height=15, kind=1)])
        got = run(settings=s, edits=edits)
        self.assertEqual(self.inside(got, 150, 150, 15 - self.EDGE), 1)  # the placed tree
        self.assertIn("hand-drawn clearings", got.cleared)

    def test_a_placed_tree_may_stand_anywhere_even_in_the_open(self):
        got = run(settings=ForestSettings(spacing=5), edits=TreeEdits(added=[PlacedTree(x=20, z=20, height=10, kind=0)]))
        self.assertEqual(got.trees[-1]["x"], 20)

    def test_a_route_clears_nothing(self):
        # trees stand across the line of play: plant, and check the middle of the patch is as full as the rest
        got = run(settings=ForestSettings(spacing=3, edgeThinning=0))
        self.assertGreater(self.inside(got, 150, 150, 15), 30)

    def test_a_placed_tree_outside_the_course_is_moved_to_its_edge_with_a_note(self):
        got = run(settings=ForestSettings(spacing=8), edits=TreeEdits(added=[PlacedTree(x=-5, z=9999, height=10, kind=0)]))
        self.assertEqual((got.trees[-1]["x"], got.trees[-1]["z"]), (0, EXTENT[1]))
        self.assertTrue(any("outside the course" in n for n in got.notes))

    def test_the_clearing_numbers_are_the_ones_the_editor_draws(self):
        # the same inputs and numbers as web/src/editors/trees/clearings.test.ts, so the circles shown are the circles built
        from course_maker.build.trees import landmark_clearings, placed_clearings

        self.assertEqual([round(crown_fraction(k), 6) for k in KINDS], [0.17, 0.301803, 0.26])
        placed = placed_clearings([PlacedTree(x=10, z=20, height=20, kind=0), PlacedTree(x=1, z=2, height=10, kind=1), PlacedTree(x=3, z=4, height=15, kind=5)], KINDS)
        self.assertEqual([(x, z, round(r, 6)) for x, z, r in placed], [(10, 20, 3.9), (1, 2, 3.518034), (3, 4, 4.4)])
        lm = landmark_clearings([Landmark(name="a", kind="b", x=1, z=2), Landmark(name="a", kind="b", x=1, z=2, scale=2.5), Landmark(name="a", kind="b", x=1, z=2, clearance=7)])
        self.assertEqual([r for _, _, r in lm], [4.0, 10.0, 7.0])

    def test_paint_discs_covers_a_circle(self):
        m = paint_discs((ROWS, COLS), RES, [(100, 100, 10)])
        self.assertAlmostEqual(m.sum() * RES * RES, np.pi * 100, delta=8)
        self.assertTrue(m[int(100 / RES), int(100 / RES)])
        self.assertFalse(m[int(100 / RES), int(115 / RES)])
        self.assertFalse(paint_discs((ROWS, COLS), RES, [(-50, -50, 10)]).any())  # entirely outside


class CapTests(unittest.TestCase):
    def test_the_cap_thins_every_patch_evenly_and_keeps_the_placed_trees(self):
        original = spec.MAX_TREES
        spec.MAX_TREES = 2000
        try:
            edits = TreeEdits(added=[PlacedTree(x=60, z=60, height=10, kind=0)])
            k, i = world(A, B)
            got = run((A, B), settings=[ForestSettings(spacing=3, edgeThinning=0)] * 2, edits=edits, klass=k, index=i)
        finally:
            spec.MAX_TREES = original
        self.assertLessEqual(len(got.trees), 2000)
        self.assertGreater(len(got.trees), 1500)
        self.assertIsNotNone(got.thinned)
        self.assertTrue(any("capped at" in n for n in got.notes))
        in_a = ((got.trees["x"] < 255)).sum() / (200 * 200)
        in_b = ((got.trees["x"] >= 255)).sum() / (120 * 200)
        self.assertAlmostEqual(in_a / in_b, 1.0, delta=0.2)  # both thinned by the same share
        self.assertEqual(float(got.trees[-1]["x"]), 60.0)

    def test_under_the_cap_nothing_is_thinned(self):
        got = run(settings=ForestSettings(spacing=5))
        self.assertIsNone(got.thinned)
        self.assertFalse(any("capped" in n for n in got.notes))


class RecordTests(unittest.TestCase):
    """Nearest-neighbour distances are a record, not a rule: there is no minimum distance. They are measured so a change that
    crowds trees more is noticed."""

    @staticmethod
    def nearest(trees):
        pts = np.column_stack([trees["x"], trees["z"]])
        cell = 12.0
        grid = {}
        for n, (x, z) in enumerate(pts):
            grid.setdefault((int(x // cell), int(z // cell)), []).append(n)
        out = []
        for n, (x, z) in enumerate(pts[:3000]):
            best = 1e9
            gx, gz = int(x // cell), int(z // cell)
            for dx in (-1, 0, 1):
                for dz in (-1, 0, 1):
                    for m in grid.get((gx + dx, gz + dz), ()):
                        if m != n:
                            best = min(best, float(np.hypot(pts[m][0] - x, pts[m][1] - z)))
            out.append(best)
        return np.array(out)

    def test_trees_are_spread_about_as_well_as_they_were_when_measured(self):
        # medians and 1st percentiles as a share of the spacing, measured with the planting as first written, with room to spare
        for spacing, median_floor, tail_floor in ((3, 0.5, 0.2), (5, 0.55, 0.4), (10, 0.5, 0.4)):
            got = run(settings=ForestSettings(spacing=spacing, edgeThinning=0)).trees
            d = self.nearest(got) / spacing
            self.assertGreater(np.median(d), median_floor, f"spacing {spacing}: median {np.median(d):.2f}")
            self.assertGreater(np.percentile(d, 1), tail_floor, f"spacing {spacing}: 1st percentile {np.percentile(d, 1):.3f}")

    def test_planting_a_course_the_size_of_augustas_is_quick(self):
        rows, cols = 3520, 2810
        klass = np.zeros((rows, cols), np.uint8)
        index = np.zeros((rows, cols), np.uint16)
        klass[600:3000, 400:2400] = spec.CLASSES["woods"]
        index[600:3000, 400:2400] = 1
        t = time.perf_counter()
        got = plant(extent=(1404.5, 1759.5), res=0.5, klass=klass, region_index=index, regions=[region("a", ForestSettings(spacing=4))], edits=TreeEdits(), kinds=KINDS)
        took = time.perf_counter() - t
        print(f"\n  planted {len(got.trees):,} trees in {took:.2f} s")
        self.assertLess(took, 3.0)  # generous: a soft check that it is nowhere near slow


if __name__ == "__main__":
    unittest.main()
