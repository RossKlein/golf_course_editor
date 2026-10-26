"""Run from the repo root:  python -m unittest discover -s course_maker/tests -t ."""
import json
import unittest

from pydantic import ValidationError

from course_maker import spec
from course_maker.look_defaults import default_look
from course_maker.models import Course, Look


class LookTests(unittest.TestCase):
    def test_default_look_has_a_surface_for_every_class(self):
        look = default_look()
        self.assertEqual(len(look.surfaces), len(spec.CLASSES))
        self.assertEqual(look.surfaces[spec.CLASSES["fairway"]].stripe, 2.4)
        self.assertEqual(look.surfaces[spec.CLASSES["bunker"]].shade, 0.12)
        self.assertEqual([s.tuft > 0 for s in look.surfaces], [True, False, False, False, False, False, False, False, True])

    def test_default_shadows_are_a_cool_darkening_that_fades_out(self):
        s = default_look().shadows
        self.assertGreater(s.strength, 0)
        self.assertLess(s.tint[0], s.tint[2])  # shade is bluer than light
        self.assertGreater(s.distance, 0)

    def test_a_look_without_shadows_gets_the_default_ones(self):
        data = default_look().model_dump()
        del data["shadows"]
        self.assertEqual(Look.model_validate(data).shadows, default_look().shadows)

    def test_surface_edges_blend_over_about_a_metre_by_default(self):
        edge = default_look().grass.edge
        self.assertGreater(edge, 0)
        self.assertLessEqual(edge, 1.5)

    def test_a_look_without_an_edge_gets_the_default_one(self):
        data = default_look().model_dump()
        del data["grass"]["edge"]
        self.assertEqual(Look.model_validate(data).grass.edge, default_look().grass.edge)

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
        data["surfaces"] = data["surfaces"][:3]
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
