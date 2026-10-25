"""Spike: rasterize saved regions the way the real build will (rasterio, painter's order, spec pixel rules), write the
class map, and check it against Shapely point-in-polygon.

    python py/rasterize.py            (from spike/openlayers, with the repo venv)
"""
import json
import sys
import time
from pathlib import Path

import numpy as np
import rasterio.features
from affine import Affine
from PIL import Image
from shapely.geometry import Point, Polygon

OUT = Path(__file__).resolve().parent.parent / "out"
W, H, RES = 1405, 1760, 0.5
COLORS = ["#6a8f3a", "#8fd14f", "#1faa59", "#7fc77a", "#e0b84a", "#f1e3a0", "#3b82c4", "#9a9a9a", "#2f5a2a"]
OWNED = (1, 2, 4)

T0 = time.perf_counter()
doc = json.loads((OUT / "regions.json").read_text())
cols, rows = round(W / RES), round(H / RES)
# spec: class cell (r, c) covers [c*0.5, (c+1)*0.5) in x and z, z increasing with row
transform = Affine(RES, 0, 0, 0, RES, 0)

t_rast = time.perf_counter()
polys = []
class_shapes, owner_shapes, cover_shapes = [], [], []
for rid in doc["order"]:  # list order is painter's order: within one rasterize call, later shapes win
    r = doc["regions"][rid]
    poly = Polygon(r["outer"], r["inner"])
    if not poly.is_valid:
        poly = poly.buffer(0)
    polys.append((poly, r["cls"]))
    class_shapes.append((poly, r["cls"]))
    cover_shapes.append((poly, 1))
    if r["cls"] in OWNED and r.get("hole"):
        owner_shapes.append((poly, r["hole"]))
# ONE call per channel: a call per region copies the whole 10 MB array each time and is ~50x slower
shape = (rows, cols)
klass = rasterio.features.rasterize(class_shapes, out_shape=shape, transform=transform, dtype="uint8")
covered = rasterio.features.rasterize(cover_shapes, out_shape=shape, transform=transform, dtype="uint8")
owner = rasterio.features.rasterize(owner_shapes, out_shape=shape, transform=transform, dtype="uint8") if owner_shapes else np.zeros(shape, np.uint8)
owner[~np.isin(klass, OWNED)] = 0  # spec: only fairway, green and tee cells carry a hole number

ms_rasterize = (time.perf_counter() - t_rast) * 1000
t_enc = time.perf_counter()
spec = np.zeros((rows, cols, 4), np.uint8)
spec[..., 0], spec[..., 1], spec[..., 3] = klass, owner, 255
Image.fromarray(spec).save(OUT / "class_test.png", optimize=True)

view = np.zeros((rows, cols, 4), np.uint8)
palette = np.array([[int(c[i:i + 2], 16) for i in (1, 3, 5)] for c in COLORS], np.uint8)
view[..., :3] = palette[np.minimum(klass, len(COLORS) - 1)]
view[..., 3] = covered * 255
Image.fromarray(view).save(OUT / "class_test_view.png", optimize=True)

ms_encode = (time.perf_counter() - t_enc) * 1000
t_chk = time.perf_counter()
# check: random points, expected class by Shapely (painter's order) vs the raster cell the point falls in
rng = np.random.default_rng(7)
checked = skipped = bad = 0
for x, z in rng.uniform([0, 0], [W, H], size=(6000, 2)):
    pt = Point(x, z)
    if any(p.exterior.distance(pt) < 0.75 for p, _ in polys) or any(i.distance(pt) < 0.75 for p, _ in polys for i in p.interiors):
        skipped += 1  # within a cell of an edge, either answer is legitimate
        continue
    want = 0
    for p, c in polys:
        if p.contains(pt):
            want = c
    got = klass[int(z / RES), int(x / RES)]
    checked += 1
    bad += int(got != want)

ms_check = (time.perf_counter() - t_chk) * 1000
report = {"ms_rasterize": round(ms_rasterize), "ms_encode_both_pngs": round(ms_encode), "ms_verify_script_only": round(ms_check), "regions": len(polys), "checked": checked, "skipped_near_edge": skipped, "mismatches": bad,
          "pixels_set": int(covered.sum()), "class_png_bytes": (OUT / "class_test.png").stat().st_size}
(OUT / "rasterize_report.json").write_text(json.dumps(report))
print(json.dumps(report))
sys.exit(1 if bad else 0)
