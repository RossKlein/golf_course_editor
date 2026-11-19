"""The blank flat bundle the range is drawn on. Run with the other course_maker tests."""
import shutil
import tempfile
import unittest
from pathlib import Path

import numpy as np

from course_maker.compiler.codec import decode_height, read_png
from course_maker.compiler.validate import validate_bundle
from course_maker.models import Course
from course_maker.range import FLAT_M, write_range


class RangeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_a_flat_500m_bundle_validates(self):
        course = write_range(self.tmp / "range")
        self.assertEqual(validate_bundle(self.tmp / "range").errors, [])
        self.assertEqual(course.extent, (500, 500))
        self.assertEqual(course.kind, "range")
        self.assertEqual(course.holes, [])
        img = read_png(self.tmp / "range" / course.height.file)[0]
        heights = decode_height(img, course.hMin, course.hMax)
        self.assertTrue(np.all(heights == FLAT_M))

    def test_an_existing_bundle_is_left_alone(self):
        write_range(self.tmp / "range")
        with self.assertRaises(FileExistsError):
            write_range(self.tmp / "range", "Other")
        self.assertEqual(Course.read(self.tmp / "range" / "course.json").name, "Practice Range")
