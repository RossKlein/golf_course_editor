#!/usr/bin/env python3
"""Clip the USGS 3DEP 1 m bare-earth DEM to a course's bounds from course_bounds.csv.

  python fetch_3dep.py --name AugustaNational --out augusta_3dep_1m.tif
"""
import argparse, csv, json, sys, urllib.parse, urllib.request
import numpy as np
import rasterio
from rasterio.warp import transform_bounds

ap = argparse.ArgumentParser()
ap.add_argument("--name", required=True, help="course name from course_bounds.csv (with or without .mm)")
ap.add_argument("--out", required=True)
ap.add_argument("--pad", type=float, default=0.0005, help="degrees of padding around the bounds")
a = ap.parse_args()

rows = [r for r in csv.DictReader(open("course_bounds.csv")) if r["name"].split(".")[0] == a.name.split(".")[0]]
if not rows:
    sys.exit(f"{a.name} not in course_bounds.csv")
r = rows[0]
bb = (float(r["minlon"]) - a.pad, float(r["minlat"]) - a.pad, float(r["maxlon"]) + a.pad, float(r["maxlat"]) + a.pad)

q = urllib.parse.urlencode({"datasets": "Digital Elevation Model (DEM) 1 meter",
                            "bbox": ",".join(map(str, bb)), "outputFormat": "JSON", "max": 50})
items = json.load(urllib.request.urlopen("https://tnmaccess.nationalmap.gov/api/v1/products?" + q))["items"]
if not items:
    print("no 1 m 3DEP coverage")
    sys.exit(2)   # permanent: caller should not retry
# newest publication first, so it wins where tiles overlap
items.sort(key=lambda i: i["publicationDate"], reverse=True)
for i in items:
    print(i["title"], i["publicationDate"])

# Target grid in the newest tile's CRS (tiles from different UTM zones get warped onto it)
import math
from rasterio.enums import Resampling
from rasterio.transform import from_origin
from rasterio.vrt import WarpedVRT

dss = [rasterio.open(i["downloadURL"]) for i in items]
crs = dss[0].crs
l, b, rr, t = transform_bounds("EPSG:4326", crs, *bb)
l, t = math.floor(l), math.ceil(t)
w, h = math.ceil(rr - l), math.ceil(t - b)
tr = from_origin(l, t, 1.0, 1.0)
NODATA = -9999.0
out = np.full((h, w), NODATA, np.float32)
for ds in dss:   # newest first; later tiles only fill gaps
    with WarpedVRT(ds, crs=crs, transform=tr, width=w, height=h, resampling=Resampling.bilinear,
                   nodata=NODATA, src_nodata=ds.nodata) as vrt:
        d = vrt.read(1)
    fill = (out == NODATA) & (d != NODATA)
    out[fill] = d[fill]
mosaic = out[None]
prof = dict(driver="GTiff", height=h, width=w, count=1, dtype="float32", crs=crs, transform=tr,
            nodata=NODATA, compress="deflate", predictor=3)
with rasterio.open(a.out, "w", **prof) as d:
    d.write(out, 1)
    d.update_tags(source="USGS 3DEP 1 m DEM; " + "; ".join(i["title"] for i in items), vertical_datum="NAVD88")
v = out[out != NODATA]
print(f"wrote {a.out}: {mosaic.shape[2]}x{mosaic.shape[1]} px, {crs}, elev {v.min():.1f}..{v.max():.1f} m")
