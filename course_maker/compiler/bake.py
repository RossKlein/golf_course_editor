"""Bake a course bundle from a course_stack.tif (NAIP + elevation) as produced by tif_generation/course_stack.py.

    python -m course_maker bake augusta --name "Augusta National"

Slice 1: writes the macro heightmap from the stack's elevation band, plus an empty class map, empty bounds
map, no trees and no holes. Annotations, patches and trees come from later stages.
"""
from __future__ import annotations

import math
import os
import shutil
from pathlib import Path

import numpy as np
import rasterio
from affine import Affine
from rasterio.enums import Resampling
from rasterio.warp import reproject

from .. import spec as S
from ..models import BakeSettings, Course, Grid, ProjectFile, Report, TreesRef
from ..project.store import DIR_NAME, write_project
from .codec import encode_height, write_png
from .validate import validate_bundle

DEFAULT_ATTRIBUTION = "Elevation: USGS 3DEP. Imagery: NAIP."
EDGE_MARGIN_M = 1.0  # keep grid points inside the stack so bilinear resampling never reads past its edge


def macro_grid_from_stack(stack_path) -> tuple[np.ndarray, float, float, str]:
    """Resample the stack's elevation band onto the 1 m macro grid.

    The grid's sample (col, row) is at UTM easting = E0 + col, northing = N0 - row, so +x is east and
    +z is south, with the course origin at the north-west sample.
    Returns (heights float64 [rows, cols], E0, N0, crs).
    """
    with rasterio.open(stack_path) as ds:
        if ds.crs is None or ds.crs.is_geographic or abs(ds.crs.linear_units_factor[1] - 1) > 1e-9:
            raise ValueError("baking needs a projected raster in metres, such as course_stack.tif (UTM)")
        if ds.transform.b or ds.transform.d or ds.transform.a <= 0 or ds.transform.e >= 0:
            raise ValueError("stack must be north-up (no rotation)")
        band = (list(ds.descriptions).index("elevation_m") + 1) if "elevation_m" in ds.descriptions else ds.count
        width_m, height_m = ds.width * ds.transform.a, ds.height * -ds.transform.e
        cols = math.floor(width_m - 2 * EDGE_MARGIN_M + 1e-9) + 1
        rows = math.floor(height_m - 2 * EDGE_MARGIN_M + 1e-9) + 1
        if cols < 2 or rows < 2:
            raise ValueError("stack is too small")
        e0, n0 = ds.transform.c + EDGE_MARGIN_M, ds.transform.f - EDGE_MARGIN_M
        elev = np.full((rows, cols), np.nan, np.float32)
        # dst pixel centres land exactly on the grid points
        reproject(rasterio.band(ds, band), elev, dst_transform=Affine(1, 0, e0 - 0.5, 0, -1, n0 + 0.5),
                  dst_crs=ds.crs, src_nodata=np.nan, dst_nodata=np.nan, resampling=Resampling.bilinear)
        crs = ds.crs.to_string()
    if np.isnan(elev).any():
        raise ValueError(f"elevation has {int(np.isnan(elev).sum())} empty cells inside the course grid")
    return elev.astype(np.float64), e0, n0, crs


class BakeError(ValueError):
    """The freshly baked bundle did not validate, so nothing was replaced."""

    def __init__(self, report: Report):
        super().__init__("; ".join(report.errors))
        self.report = report


BUILDING_SUFFIX = ".baking"  # the new bundle is built in a sibling folder with this suffix
REPLACED_SUFFIX = ".replaced"  # the old bundle waits here, briefly, while the new one moves in


def _stack_ref(stack: Path, bundle: Path) -> str:
    """The stack's path relative to the bundle folder, with forward slashes."""
    try:
        return Path(os.path.relpath(stack.resolve(), bundle.resolve())).as_posix()
    except ValueError:  # different drive: no relative path exists
        return stack.resolve().as_posix()


def _write_bundle(stack_path: Path, out: Path, name: str, attribution: str) -> Course:
    heights, e0, n0, crs = macro_grid_from_stack(stack_path)
    rows, cols = heights.shape
    h_min = math.floor(float(heights.min()) * 1000) / 1000
    h_max = math.ceil(float(heights.max()) * 1000) / 1000
    w, h = cols - 1, rows - 1  # metres
    cw, ch = round(w / S.CLASS_RES), round(h / S.CLASS_RES)
    bw, bh = round(w / S.BOUNDS_RES), round(h / S.BOUNDS_RES)

    out.mkdir(parents=True)
    f = S.DEFAULT_FILES
    write_png(out / f["height"], encode_height(heights, h_min, h_max))
    klass = np.zeros((ch, cw, 4), np.uint8)  # R = rough everywhere, G = no owner
    klass[..., 3] = 255
    write_png(out / f["class"], klass)
    write_png(out / f["bounds"], np.zeros((bh, bw, 3), np.uint8))  # nothing is in bounds until holes exist
    (out / f["trees"]).write_bytes(b"")

    course = Course(
        name=name, attribution=attribution, crs=crs, originEasting=e0, originNorthing=n0, hMin=h_min, hMax=h_max,
        height=Grid(file=f["height"], cols=cols, rows=rows, res=S.HEIGHT_RES),
        class_=Grid(file=f["class"], cols=cw, rows=ch, res=S.CLASS_RES),
        bounds=Grid(file=f["bounds"], cols=bw, rows=bh, res=S.BOUNDS_RES), trees=TreesRef(file=f["trees"], count=0), holes=[],
    )
    course.write(out / "course.json")
    return course


def _swap_in(building: Path, out: Path) -> None:
    """Move the new bundle into place. The old one is only deleted after the new one is in; if the move fails the
    old one is put back."""
    if out.exists() and not any(out.iterdir()):
        out.rmdir()
    if not out.exists():
        os.replace(building, out)
        return
    old = out.with_name(out.name + REPLACED_SUFFIX)
    shutil.rmtree(old, ignore_errors=True)
    os.replace(out, old)
    try:
        os.replace(building, out)
    except OSError:
        os.replace(old, out)
        raise
    shutil.rmtree(old, ignore_errors=True)


def bake(stack_path, out_dir, name: str, attribution: str = DEFAULT_ATTRIBUTION, replace: bool = False) -> Course:
    """Bake a bundle at out_dir from a course_stack.tif.

    With replace=True an existing bundle is rebuilt without ever being modified in place: the new bundle is built
    in a sibling folder, the old `.course_maker/` (editor state, project settings, annotations) is carried over,
    the result is validated, and only then does it take the old one's place. Raises FileExistsError if out_dir is
    in use and replace is not set (or is not a bundle), and BakeError if the new bundle does not validate; in both
    cases whatever was at out_dir is untouched.
    """
    out, stack = Path(out_dir), Path(stack_path)
    in_use = out.exists() and any(out.iterdir())
    if in_use and not replace:
        raise FileExistsError(f"{out} already exists; replace it to rebuild")
    if in_use and not (out / "course.json").is_file():
        raise FileExistsError(f"{out} is not a bundle; refusing to replace it")

    building = out.with_name(out.name + BUILDING_SUFFIX)
    shutil.rmtree(building, ignore_errors=True)
    try:
        course = _write_bundle(stack, building, name, attribution)
        if (out / DIR_NAME).is_dir():
            shutil.copytree(out / DIR_NAME, building / DIR_NAME)
        write_project(building, ProjectFile(stack=_stack_ref(stack, out),
                                            bake=BakeSettings(name=name, attribution=attribution, edgeMargin=EDGE_MARGIN_M)))
        report = validate_bundle(building)
        if not report.ok:
            raise BakeError(report)
        _swap_in(building, out)
    finally:
        shutil.rmtree(building, ignore_errors=True)
    return course
