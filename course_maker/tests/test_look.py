"""Run from the repo root:  python -m unittest discover -s course_maker/tests -t ."""
import json
import re
import unittest
from pathlib import Path

from pydantic import ValidationError

from course_maker import spec
from course_maker.look_defaults import default_look
from course_maker.models import Course, Look


class LookTests(unittest.TestCase):
    def test_default_look_has_a_surface_for_every_class(self):
        look = default_look()
        self.assertEqual(list(look.surfaces), list(spec.CLASSES))
        self.assertEqual(look.surfaces["fairway"].stripe, 2.4)
        self.assertEqual(look.surfaces["bunker"].shade, 0.67)  # a bunker is shaded by its slope a little less than the rest of the ground (Augusta's tuning)
        self.assertEqual([s.tuft > 0 for s in look.surfaces.values()], [True, False, False, False, False, False, False, False, True])

    def test_the_collar_is_plain_and_a_darker_green_than_the_green(self):
        look = default_look()
        collar, green = look.surfaces["collar"], look.surfaces["green"]
        self.assertEqual(collar.stripe, 0)
        self.assertLess(sum(collar.color), sum(green.color))

    def test_default_shadows_are_a_cool_darkening_that_fades_out(self):
        s = default_look().shadows
        self.assertGreater(s.strength, 0)
        self.assertLess(s.tint[0], s.tint[2])  # shade is bluer than light
        self.assertGreater(s.distance, 0)

    def test_a_look_without_shadows_gets_the_default_ones(self):
        data = default_look().model_dump()
        del data["shadows"]
        self.assertEqual(Look.model_validate(data).shadows, default_look().shadows)

    def test_surface_edges_are_nearly_clean_by_default(self):
        self.assertLess(default_look().grass.wobble, 0.1)  # golf courses have clean edges: the grass only just roughens them (Augusta's tuning)

    def test_edges_are_smoothed_over_a_couple_of_metres_by_default(self):
        smoothing = default_look().grass.smoothing
        self.assertGreaterEqual(smoothing, 1)
        self.assertLessEqual(smoothing, 3)  # what the renderer's spline can reach

    def test_a_look_without_smoothing_gets_the_default(self):
        data = default_look().model_dump()
        del data["grass"]["smoothing"]
        self.assertEqual(Look.model_validate(data).grass.smoothing, default_look().grass.smoothing)

    def test_the_default_relief_is_smoothed_over_a_couple_of_metres(self):
        smoothing = default_look().relief.smoothing
        self.assertGreaterEqual(smoothing, 1)
        self.assertLessEqual(smoothing, 6)  # what the renderer's spline can reach

    def test_a_look_without_relief_gets_the_default_one(self):
        data = default_look().model_dump()
        del data["relief"]
        self.assertEqual(Look.model_validate(data).relief, default_look().relief)

    def test_the_default_relief_is_shaded_as_the_editor_always_has(self):
        relief = default_look().relief
        self.assertEqual((relief.exaggeration, relief.shading), (5, 1.8))  # Augusta's tuning

    def test_a_relief_without_exaggeration_or_shading_gets_the_defaults(self):
        data = default_look().model_dump()
        del data["relief"]["exaggeration"], data["relief"]["shading"]
        self.assertEqual(Look.model_validate(data).relief, default_look().relief)

    def test_relief_exaggeration_and_shading_are_kept_in_range(self):
        for field, bad in (("exaggeration", 0.5), ("exaggeration", 21), ("shading", -0.1), ("shading", 3.5)):
            data = default_look().model_dump()
            data["relief"][field] = bad
            with self.assertRaises(ValidationError, msg=f"{field} = {bad}"):
                Look.model_validate(data)

    def test_the_default_grass_heights_are_a_mowers(self):
        h = {name: s.height for name, s in default_look().surfaces.items()}
        self.assertLess(h["green"], h["collar"])
        self.assertLess(h["collar"], h["fairway"] + 1e-9)
        self.assertLess(h["fairway"], h["rough"])
        self.assertTrue(all(0 <= v <= 0.15 for v in h.values()))  # centimetres, not metres
        self.assertLessEqual(h["bunker"], 0.005)  # sand is a hair off the ground (Augusta's tuning), and water is level with it
        self.assertEqual(h["water"], 0)

    def test_a_surface_without_a_height_gets_its_classes_default(self):
        data = default_look().model_dump()
        for s in data["surfaces"].values():
            del s["height"]
        look = Look.model_validate(data)
        self.assertEqual({n: s.height for n, s in look.surfaces.items()}, {n: s.height for n, s in default_look().surfaces.items()})

    def test_a_height_that_is_written_is_kept_even_when_it_is_zero(self):
        data = default_look().model_dump()
        data["surfaces"]["rough"]["height"] = 0.0
        self.assertEqual(Look.model_validate(data).surfaces["rough"].height, 0.0)

    def test_a_height_is_kept_in_range(self):
        data = default_look().model_dump()
        data["surfaces"]["rough"]["height"] = 0.6
        with self.assertRaises(ValidationError):
            Look.model_validate(data)

    def test_a_look_without_edge_settings_gets_the_defaults(self):
        data = default_look().model_dump()
        for k in ("edgeWidth", "edgeRagged", "edgeShadow", "edgeGain"):
            del data["grass"][k]
        self.assertEqual(Look.model_validate(data).grass, default_look().grass)

    def test_the_default_step_looks_taller_than_it_is(self):
        self.assertEqual(default_look().grass.edgeGain, 1.5)  # Augusta's tuning

    def test_the_edge_settings_are_kept_in_range(self):
        for field, bad in (("edgeWidth", 0), ("edgeWidth", 0.6), ("edgeRagged", -0.01), ("edgeShadow", 1.1), ("edgeGain", 0.5), ("edgeGain", 11)):
            data = default_look().model_dump()
            data["grass"][field] = bad
            with self.assertRaises(ValidationError, msg=f"{field} = {bad}"):
                Look.model_validate(data)

    def test_the_default_tufts_are_clumps_of_blades(self):
        t = default_look().tufts
        self.assertEqual((t.spread, t.blades), (0.7, 18))  # Augusta's tuning
        self.assertLess(t.bladeWidth, 0.1)  # centimetres, not metres

    def test_a_look_with_the_old_tuft_width_is_read_and_the_width_let_go(self):
        data = default_look().model_dump()
        for k in ("spread", "bladeWidth", "blades"):
            del data["tufts"][k]
        data["tufts"]["width"] = 1.1
        look = Look.model_validate(data)
        self.assertEqual(look.tufts, default_look().tufts)
        self.assertNotIn("width", look.model_dump()["tufts"])

    def test_the_tuft_settings_are_kept_in_range(self):
        for field, bad in (("spread", 0), ("spread", 2.1), ("bladeWidth", 0), ("bladeWidth", 0.2), ("blades", 2), ("blades", 65), ("blades", 8.5)):
            data = default_look().model_dump()
            data["tufts"][field] = bad
            with self.assertRaises(ValidationError, msg=f"{field} = {bad}"):
                Look.model_validate(data)

    def test_the_forest_floor_is_sparse_and_in_patches_and_the_rough_is_not(self):
        s = default_look().surfaces
        self.assertLess(s["woods"].tuftDensity, s["rough"].tuftDensity)
        self.assertGreater(s["woods"].tuftClump, s["rough"].tuftClump)

    def test_a_surface_without_tuft_density_or_clumping_gets_its_classes_default(self):
        data = default_look().model_dump()
        for surface in data["surfaces"].values():
            del surface["tuftDensity"], surface["tuftClump"]
        look = Look.model_validate(data)
        for name, surface in look.surfaces.items():
            self.assertEqual((surface.tuftDensity, surface.tuftClump), (default_look().surfaces[name].tuftDensity, default_look().surfaces[name].tuftClump), name)

    def test_a_tuft_density_that_is_written_is_kept(self):
        data = default_look().model_dump()
        data["surfaces"]["woods"]["tuftDensity"] = 1.0
        data["surfaces"]["woods"]["tuftClump"] = 0.0
        woods = Look.model_validate(data).surfaces["woods"]
        self.assertEqual((woods.tuftDensity, woods.tuftClump), (1.0, 0.0))

    def test_tuft_density_and_clumping_are_kept_in_range(self):
        for field, bad in (("tuftDensity", -0.1), ("tuftDensity", 1.1), ("tuftClump", -0.1), ("tuftClump", 1.1)):
            data = default_look().model_dump()
            data["surfaces"]["rough"][field] = bad
            with self.assertRaises(ValidationError, msg=f"{field} = {bad}"):
                Look.model_validate(data)

    def test_the_default_surfaces_have_the_detail_they_should(self):
        look = default_look()
        bump = look.surfaces
        self.assertEqual(bump["water"].bump, 0)  # water is smooth
        self.assertEqual((bump["bunker"].bumpMap, bump["path"].bumpMap), ("grain", "grain"))  # sand and paths are grains
        self.assertEqual(bump["fairway"].bumpMap, "grass")
        self.assertGreater(bump["fairway"].bump, bump["green"].bump)  # a green is smoother than a fairway

    def test_a_look_without_detail_has_none(self):
        data = default_look().model_dump()
        for s in data["surfaces"].values():
            del s["bump"], s["bumpMap"]
        self.assertTrue(all(s.bump == 0 for s in Look.model_validate(data).surfaces.values()))

    def test_surfaces_are_named_for_the_classes_and_a_wrong_name_is_refused(self):
        data = default_look().model_dump()
        del data["surfaces"]["water"]
        with self.assertRaisesRegex(ValueError, "missing: \\['water'\\]"):
            Look.model_validate(data)
        data = default_look().model_dump()
        data["surfaces"]["lava"] = data["surfaces"].pop("water")
        with self.assertRaisesRegex(ValueError, "not a class: \\['lava'\\]"):
            Look.model_validate(data)

    def test_surfaces_come_out_in_class_order_however_they_were_written(self):
        data = default_look().model_dump()
        data["surfaces"] = dict(reversed(list(data["surfaces"].items())))
        self.assertEqual(list(Look.model_validate(data).surfaces), list(spec.CLASSES))

    def test_the_web_app_knows_the_same_classes_in_the_same_order(self):
        limits = (Path(__file__).resolve().parents[2] / "web" / "src" / "terrain" / "limits.ts").read_text(encoding="utf-8")
        names = re.search(r"SURFACE_NAMES = \[(.*?)\]", limits, re.S).group(1)
        self.assertEqual(re.findall(r'"(\w+)"', names), list(spec.CLASSES))

    def test_it_survives_a_json_round_trip(self):
        look = default_look()
        again = Look.model_validate_json(look.model_dump_json())
        self.assertEqual(again, look)

    def test_a_course_without_a_look_gets_the_default(self):
        data = {
            "name": "x", "attribution": "y", "crs": "EPSG:32617", "originEasting": 0, "originNorthing": 0, "hMin": 0, "hMax": 1,
            "height": {"file": "h.png", "cols": 2, "rows": 2, "res": 1},
            "class": {"file": "c.png", "cols": 2, "rows": 2, "res": 0.5},
            "bounds": {"file": "b.png", "cols": 1, "rows": 1, "res": 1},
            "trees": {"file": "t.bin", "count": 0},
            "holes": [],
        }
        course = Course.model_validate(data)
        self.assertEqual(course.look, default_look())
        self.assertIn("look", json.loads(course.model_dump_json(by_alias=True)))

    def test_values_are_checked(self):
        data = default_look().model_dump()
        data["surfaces"] = dict(list(data["surfaces"].items())[:3])  # most of the classes have none
        with self.assertRaises(ValidationError):
            Look.model_validate(data)
        data = default_look().model_dump()
        data["sky"] = (0.5, 1.5, 0.5)  # a colour channel above 1
        with self.assertRaises(ValidationError):
            Look.model_validate(data)
        data = default_look().model_dump()
        data["trees"]["kinds"][0]["parts"][0]["shape"] = "cube"
        with self.assertRaises(ValidationError):
            Look.model_validate(data)


if __name__ == "__main__":
    unittest.main()
