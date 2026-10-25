"""Run from the repo root:  python -m unittest discover -s course_maker/tests -t ."""
import io
import shutil
import tempfile
import unittest
from pathlib import Path

import numpy as np
import rasterio
from fastapi.testclient import TestClient
from PIL import Image
from rasterio.transform import from_origin

from course_maker.compiler.codec import decode_height
from course_maker.server.app import create_app
from course_maker.tests.test_bundle import LEFT, TOP, make_stack


def make_dem(path):
    """A 1-band geographic DEM with a nodata corner, like the decoded site DEMs."""
    z = np.linspace(40, 60, 20 * 30, dtype=np.float32).reshape(20, 30)
    z[0, 0] = -9999
    with rasterio.open(path, "w", driver="GTiff", count=1, dtype="float32", width=30, height=20, nodata=-9999,
                       crs="EPSG:4326", transform=from_origin(-82.03, 33.5, 1e-5, 1e-5)) as ds:
        ds.write(z[None])


class ServerTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        (self.root / "augusta").mkdir()
        make_stack(self.root / "augusta" / "course_stack.tif")
        make_dem(self.root / "dem.tif")
        (self.root / ".venv").mkdir()
        make_dem(self.root / ".venv" / "hidden.tif")  # skipped by the index
        (self.root / "secret.txt").write_text("secret")
        self.client = TestClient(create_app(self.root))

    def tearDown(self):
        self.client.close()
        shutil.rmtree(self.root, ignore_errors=True)

    def bake(self, **extra):
        body = {"stack": "augusta/course_stack.tif", "out": "bundles/augusta", "name": "Augusta"} | extra
        return self.client.post("/api/bake", json=body)

    # --- index ---

    def test_index_lists_tifs_and_skips_hidden_folders(self):
        index = self.client.get("/api/index").json()
        self.assertEqual([t["path"] for t in index["tifs"]], ["dem.tif", "augusta/course_stack.tif"])
        self.assertEqual(index["bundles"], [])

    # --- GeoTIFF views ---

    def test_stack_renders_imagery_and_elevation(self):
        view = self.client.get("/api/tif", params={"path": "augusta/course_stack.tif"}).json()
        self.assertEqual((view["width"], view["height"], view["count"]), (200, 160, 4))
        self.assertEqual(view["rgb"], {"width": 200, "height": 160})
        self.assertTrue(view["bakeable"])
        self.assertAlmostEqual(view["resX"], 0.6)
        self.assertEqual(self.client.get("/api/tif/rgb.jpg", params={"path": "augusta/course_stack.tif"}).status_code, 200)

    def test_geographic_dem_renders_elevation_with_nodata(self):
        view = self.client.get("/api/tif", params={"path": "dem.tif"}).json()
        self.assertIsNone(view["rgb"])
        self.assertTrue(view["geographic"])
        self.assertFalse(view["bakeable"])
        self.assertAlmostEqual(view["resZ"], 1.105, places=2)  # 1e-5 degrees of latitude in metres
        png = self.client.get("/api/tif/elevation.png", params={"path": "dem.tif"})
        arr = np.asarray(Image.open(io.BytesIO(png.content)))
        self.assertEqual(arr[0, 0, 3], 0)  # the nodata pixel
        h = decode_height(arr, view["elevation"]["hMin"], view["elevation"]["hMax"])
        self.assertAlmostEqual(float(h[-1, -1]), 60.0, places=2)
        self.assertEqual(self.client.get("/api/tif/rgb.jpg", params={"path": "dem.tif"}).status_code, 404)

    def test_nothing_outside_the_data_folder_is_read(self):
        for path in ("../x.tif", "secret.txt", "missing.tif"):
            self.assertEqual(self.client.get("/api/tif", params={"path": path}).status_code, 404, path)

    # --- upload ---

    def test_upload_stores_a_readable_tif(self):
        data = (self.root / "dem.tif").read_bytes()
        res = self.client.put("/api/tifs/upload", params={"name": "copy.tif"}, content=data)
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual(res.json()["path"], "uploads/copy.tif")
        self.assertEqual((self.root / "uploads" / "copy.tif").read_bytes(), data)
        again = self.client.put("/api/tifs/upload", params={"name": "copy.tif"}, content=data)
        self.assertEqual(again.status_code, 409)

    def test_upload_rejects_bad_names_and_non_tifs(self):
        for name in ("../escape.tif", "a/b.tif", "notes.txt", ".hidden.tif"):
            res = self.client.put("/api/tifs/upload", params={"name": name}, content=b"x")
            self.assertEqual(res.status_code, 400, name)
        res = self.client.put("/api/tifs/upload", params={"name": "junk.tif"}, content=b"not a tiff")
        self.assertEqual(res.status_code, 400)
        self.assertEqual(list((self.root / "uploads").iterdir()), [])  # no leftovers

    # --- bake and bundles ---

    def test_bake_then_view_the_bundle(self):
        res = self.bake()
        self.assertEqual(res.status_code, 200, res.text)
        self.assertTrue(res.json()["report"]["ok"])
        self.assertEqual(self.client.get("/api/index").json()["bundles"], [{"path": "bundles/augusta", "name": "Augusta"}])
        course = self.client.get("/files/bundles/augusta/course.json").json()
        self.assertIn("class", course)
        self.assertEqual(self.client.get("/api/bundle", params={"path": "bundles/augusta"}).json()["name"], "Augusta")
        self.assertEqual(self.client.get("/files/bundles/augusta/height.png").headers["content-type"], "image/png")
        self.assertTrue(self.client.get("/api/bundle/validate", params={"path": "bundles/augusta"}).json()["ok"])

    def test_bundle_aerial_is_placed_in_course_coordinates(self):
        self.bake()
        meta = self.client.get("/api/bundle/aerial", params={"path": "bundles/augusta"}).json()
        self.assertEqual(meta["stack"], "augusta/course_stack.tif")
        # the stack's corner is the 1 m bake margin north-west of the course origin
        self.assertAlmostEqual(meta["x0"], -1.0)
        self.assertAlmostEqual(meta["z0"], -1.0)
        self.assertAlmostEqual(meta["res"], 0.6)

    def test_bake_refuses_to_replace_unless_asked(self):
        self.bake()
        self.assertEqual(self.bake().status_code, 409)
        self.assertEqual(self.bake(replace=True).status_code, 200)

    def test_bake_never_replaces_a_folder_that_is_not_a_bundle(self):
        (self.root / "augusta" / "notes.txt").write_text("keep me")
        res = self.bake(out="augusta", replace=True)
        self.assertEqual(res.status_code, 409)
        self.assertTrue((self.root / "augusta" / "notes.txt").is_file())

    def test_bake_refuses_a_geographic_dem(self):
        res = self.bake(stack="dem.tif")
        self.assertEqual(res.status_code, 422)
        self.assertIn("projected raster in metres", res.json()["detail"])

    def test_bake_request_is_validated_by_its_model(self):
        self.assertEqual(self.bake(name="   ").status_code, 422)
        self.assertEqual(self.bake(colour="green").status_code, 422)

    def test_files_serves_only_bundle_files(self):
        self.bake()
        self.assertEqual(self.client.get("/files/secret.txt").status_code, 404)
        self.assertEqual(self.client.get("/files/augusta/course_stack.tif").status_code, 404)
        self.assertEqual(self.client.get("/files/bundles/augusta/../../secret.txt").status_code, 404)

    def test_page_explains_when_the_web_app_is_not_built(self):
        res = self.client.get("/")
        self.assertIn(res.status_code, (200, 503))

    # --- editor state (.course_maker/editor.json) ---

    def test_editor_state_defaults_then_round_trips(self):
        self.bake()
        q = {"path": "bundles/augusta"}
        first = self.client.get("/api/bundle/editor", params=q).json()
        self.assertEqual(first["status"], "default")
        self.assertEqual(first["state"]["exaggeration"], 3.0)
        state = first["state"] | {
            "viewport": {"x": 12.5, "z": 40.0, "scale": 0.8},
            "layers": {"class": {"visible": True, "opacity": 0.25}},
            "exaggeration": 6.0,
        }
        self.assertEqual(self.client.put("/api/bundle/editor", params=q, json=state).status_code, 204)
        again = self.client.get("/api/bundle/editor", params=q).json()
        self.assertEqual((again["status"], again["state"]), ("loaded", state))
        self.assertTrue((self.root / "bundles/augusta/.course_maker/editor.json").is_file())

    def test_editor_put_is_validated_strictly(self):
        self.bake()
        q = {"path": "bundles/augusta"}
        good = self.client.get("/api/bundle/editor", params=q).json()["state"]
        for bad in (
            good | {"layers": {"class": {"visible": True, "opacity": 2}}},
            good | {"exaggeration": 99},
            good | {"viewport": {"x": 1, "z": 1, "scale": 0}},
            good | {"colour": "green"},
            good | {"version": 2},
        ):
            self.assertEqual(self.client.put("/api/bundle/editor", params=q, json=bad).status_code, 422, bad)

    def test_editor_endpoints_only_touch_bundles(self):
        for path in ("augusta", "../x", "missing"):
            self.assertEqual(self.client.get("/api/bundle/editor", params={"path": path}).status_code, 404, path)
            self.assertEqual(self.client.put("/api/bundle/editor", params={"path": path}, json={}).status_code, 404, path)

    def test_files_never_serves_the_hidden_project_folder(self):
        self.bake()
        q = {"path": "bundles/augusta"}
        self.client.put("/api/bundle/editor", params=q, json=self.client.get("/api/bundle/editor", params=q).json()["state"])
        self.assertEqual(self.client.get("/files/bundles/augusta/.course_maker/editor.json").status_code, 404)
        self.assertEqual(self.client.get("/files/bundles/augusta/.course_maker/project.json").status_code, 404)

    def test_replacing_a_bundle_keeps_its_editor_state(self):
        self.bake()
        q = {"path": "bundles/augusta"}
        state = self.client.get("/api/bundle/editor", params=q).json()["state"] | {"exaggeration": 7.5}
        self.client.put("/api/bundle/editor", params=q, json=state)
        res = self.bake(replace=True, name="Augusta Renamed")
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual(self.client.get("/api/bundle/editor", params=q).json()["state"]["exaggeration"], 7.5)
        self.assertEqual(self.client.get("/api/bundle", params=q).json()["name"], "Augusta Renamed")
        leftovers = [p.name for p in (self.root / "bundles").iterdir()]
        self.assertEqual(leftovers, ["augusta"])  # no .baking or .replaced folders

    def test_index_ignores_in_progress_bake_folders(self):
        self.bake()
        shutil.copytree(self.root / "bundles/augusta", self.root / "bundles/augusta.baking")
        shutil.copytree(self.root / "bundles/augusta", self.root / "bundles/augusta.replaced")
        self.assertEqual([b["path"] for b in self.client.get("/api/index").json()["bundles"]], ["bundles/augusta"])


if __name__ == "__main__":
    unittest.main()
