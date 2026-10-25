"""Bake a course bundle from a course_stack.tif (NAIP + elevation) as produced by course_stack.py.

    python -m compiler.bake --stack augusta/course_stack.tif --name "Augusta National" --out bundles/augusta

Slice 1: writes the macro heightmap from the stack's elevation band, plus an empty class map, empty bounds
map, no trees and no holes. Annotations, patches and trees come from later stages.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import numpy as np
import rasterio
from affine import Affine
from rasterio.enums import Resampling
from rasterio.warp import reproject

from . import schema as S
from .codec import encode_height, write_png
from .schema import Course, Grid, TreesRef
from .validate import format_report, validate_bundle

DEFAULT_ATTRIBUTION = "Elevation: USGS 3DEP. Imagery: NAIP."
EDGE_MARGIN_M = 1.0  # keep grid points inside the stack so bilinear resampling never reads past its edge


def macro_grid_from_stack(stack_path) -> tuple[np.ndarray, float, float, str]:
    """Resample the stack's elevation band onto the 1 m macro grid.

    The grid's sample (col, row) is at UTM easting = E0 + col, northing = N0 - row, so +x is east and
    +z is south, with the course origin at the north-west sample.
    Returns (heights float64 [rows, cols], E0, N0, crs).
    """
    with rasterio.open(stack_path) as ds:
        if ds.transform.b or ds.transform.d or ds.transform.a <= 0 or ds.transform.e >= 0:
            raise SystemExit("stack must be north-up (no rotation)")
        band = (list(ds.descriptions).index("elevation_m") + 1) if "elevation_m" in ds.descriptions else ds.count
        width_m, height_m = ds.width * ds.transform.a, ds.height * -ds.transform.e
        cols = math.floor(width_m - 2 * EDGE_MARGIN_M + 1e-9) + 1
        rows = math.floor(height_m - 2 * EDGE_MARGIN_M + 1e-9) + 1
        if cols < 2 or rows < 2:
            raise SystemExit("stack is too small")
        e0, n0 = ds.transform.c + EDGE_MARGIN_M, ds.transform.f - EDGE_MARGIN_M
        elev = np.full((rows, cols), np.nan, np.float32)
        # dst pixel centres land exactly on the grid points
        reproject(rasterio.band(ds, band), elev, dst_transform=Affine(1, 0, e0 - 0.5, 0, -1, n0 + 0.5),
                  dst_crs=ds.crs, src_nodata=np.nan, dst_nodata=np.nan, resampling=Resampling.bilinear)
        crs = ds.crs.to_string()
    if np.isnan(elev).any():
        raise SystemExit(f"elevation has {int(np.isnan(elev).sum())} empty cells inside the course grid")
    return elev.astype(np.float64), e0, n0, crs


def bake(stack_path, out_dir, name: str, attribution: str = DEFAULT_ATTRIBUTION) -> Course:
    heights, e0, n0, crs = macro_grid_from_stack(stack_path)
    rows, cols = heights.shape
    h_min = math.floor(float(heights.min()) * 1000) / 1000
    h_max = math.ceil(float(heights.max()) * 1000) / 1000
    w, h = cols - 1, rows - 1  # metres
    cw, ch = round(w / S.CLASS_RES), round(h / S.CLASS_RES)
    bw, bh = round(w / S.BOUNDS_RES), round(h / S.BOUNDS_RES)

    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    f = S.DEFAULT_FILES
    write_png(out / f["height"], encode_height(heights, h_min, h_max))
    klass = np.zeros((ch, cw, 4), np.uint8)  # R = rough everywhere, G = no owner
    klass[..., 3] = 255
    write_png(out / f["class"], klass)
    write_png(out / f["bounds"], np.zeros((bh, bw, 3), np.uint8))  # nothing is in bounds until holes exist
    (out / f["trees"]).write_bytes(b"")

    course = Course(
        name=name, attribution=attribution, crs=crs, originEasting=e0, originNorthing=n0, hMin=h_min, hMax=h_max,
        height=Grid(f["height"], cols, rows, S.HEIGHT_RES), class_=Grid(f["class"], cw, ch, S.CLASS_RES),
        bounds=Grid(f["bounds"], bw, bh, S.BOUNDS_RES), trees=TreesRef(f["trees"], 0),
    )
    (out / "course.json").write_text(json.dumps(course.to_dict(), indent=2) + "\n", encoding="utf-8")
    return course


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--stack", required=True, help="course_stack.tif from course_stack.py")
    ap.add_argument("--out", required=True, help="bundle output directory")
    ap.add_argument("--name", required=True, help="course display name")
    ap.add_argument("--attribution", default=DEFAULT_ATTRIBUTION)
    a = ap.parse_args(argv)
    course = bake(a.stack, a.out, a.name, a.attribution)
    print(f"{course.name}: {course.height.cols}x{course.height.rows} m macro grid, "
          f"height {course.hMin:.3f}..{course.hMax:.3f} m")
    report = validate_bundle(a.out)
    print(format_report(report))
    return 0 if report.ok else 1


if __name__ == "__main__":
    sys.exit(main())
