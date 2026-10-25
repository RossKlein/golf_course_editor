"""Run from the repo root:  python -m unittest discover -s viewer/tests -t ."""
import io
import json
import shutil
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path

from PIL import Image

from compiler.bake import bake
from compiler.tests.test_compiler import LEFT, TOP, make_stack
from viewer.server import make_server


class ServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp())
        make_stack(cls.tmp / "stack.tif")
        cls.course = bake(cls.tmp / "stack.tif", cls.tmp / "bundle", "Test Course")
        (cls.tmp / "secret.txt").write_text("secret")
        cls.server = make_server(cls.tmp / "bundle", cls.tmp / "stack.tif", port=0)
        cls.base = f"http://127.0.0.1:{cls.server.server_address[1]}"
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def get(self, path):
        with urllib.request.urlopen(self.base + path) as r:
            return r.status, r.headers.get_content_type(), r.read()

    def status(self, path):
        try:
            return self.get(path)[0]
        except urllib.error.HTTPError as e:
            e.close()
            return e.code

    def test_page_and_static_files(self):
        self.assertEqual(self.get("/")[:2], (200, "text/html"))
        self.assertEqual(self.status("/static/viewer.js"), 200)

    def test_bundle_files_are_served(self):
        status, _, body = self.get("/bundle/course.json")
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)["name"], "Test Course")
        self.assertEqual(self.get("/bundle/height.png")[1], "image/png")

    def test_nothing_outside_the_bundle_is_served(self):
        self.assertEqual(self.status("/bundle/../secret.txt"), 404)
        self.assertEqual(self.status("/bundle/%2e%2e/secret.txt"), 404)
        self.assertEqual(self.status("/static/../server.py"), 404)
        self.assertEqual(self.status("/nope"), 404)

    def test_aerial_is_placed_in_course_coordinates(self):
        meta = json.loads(self.get("/aerial.json")[2])
        # the stack's corner is the 1 m margin north-west of the course origin
        self.assertAlmostEqual(meta["x0"], LEFT - self.course.originEasting)
        self.assertAlmostEqual(meta["z0"], self.course.originNorthing - TOP)
        self.assertAlmostEqual(meta["x0"], -1.0)
        self.assertAlmostEqual(meta["z0"], -1.0)
        self.assertEqual(meta["res"], 0.6)
        img = Image.open(io.BytesIO(self.get("/aerial.jpg")[2]))
        self.assertEqual(img.size, (meta["width"], meta["height"]))


if __name__ == "__main__":
    unittest.main()
