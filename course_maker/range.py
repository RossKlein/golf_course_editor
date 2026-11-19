"""Write a blank flat bundle the editor can draw a range on.

    python -m course_maker range --out bundles/range

There is no GeoTIFF. The ground is level, the class map is rough, and nothing is in bounds yet.
"""
from __future__ import annotations

import shutil
from pathlib import Path

import numpy as np

from . import spec as S
from .build.water import publish_water
from .compiler.bake import BUILDING_SUFFIX, BakeError, _swap_in
from .compiler.codec import encode_height, write_png
from .compiler.validate import validate_bundle
from .models import Course, Grid, TreesRef
from .project.store import DIR_NAME

EXTENT_M = 500  # east-west and north-south; the height grid is one sample longer on each side
FLAT_M = 50.0
# 16-bit heights need hMax above hMin. Every sample is FLAT_M, so the ground is level; the extra metre is only the encoding span.
HEIGHT_SPAN_M = 1.0
ATTRIBUTION = "Synthetic flat ground."


def _write(out: Path, name: str) -> Course:
    cols = rows = EXTENT_M + 1
    h_min, h_max = FLAT_M, FLAT_M + HEIGHT_SPAN_M
    cw, ch = round(EXTENT_M / S.CLASS_RES), round(EXTENT_M / S.CLASS_RES)
    bw, bh = round(EXTENT_M / S.BOUNDS_RES), round(EXTENT_M / S.BOUNDS_RES)

    out.mkdir(parents=True)
    f = S.DEFAULT_FILES
    write_png(out / f["height"], encode_height(np.full((rows, cols), FLAT_M), h_min, h_max))
    klass = np.zeros((ch, cw, 4), np.uint8)  # R = rough everywhere, G = no owner
    klass[..., 3] = 255
    write_png(out / f["class"], klass)
    write_png(out / f["bounds"], np.zeros((bh, bw, 3), np.uint8))  # nothing is in bounds until holes exist
    (out / f["trees"]).write_bytes(b"")

    course = Course(
        name=name, attribution=ATTRIBUTION, crs="local", originEasting=0, originNorthing=0, hMin=h_min, hMax=h_max,
        height=Grid(file=f["height"], cols=cols, rows=rows, res=S.HEIGHT_RES),
        class_=Grid(file=f["class"], cols=cw, rows=ch, res=S.CLASS_RES),
        bounds=Grid(file=f["bounds"], cols=bw, rows=bh, res=S.BOUNDS_RES), trees=TreesRef(file=f["trees"], count=0), holes=[],
        kind="range",
    )
    course = publish_water(out, course)
    course.write(out / "course.json")
    return course


def write_range(out_dir, name: str = "Practice Range", replace: bool = False) -> Course:
    """Write a flat 500 m bundle at out_dir.

    With replace=True an existing bundle is rebuilt beside itself first, and its `.course_maker/` is carried over.
    Raises FileExistsError if out_dir is in use and replace is not set, and BakeError if the new bundle does not
    validate. Either way, whatever was at out_dir is left as it was.
    """
    out = Path(out_dir)
    in_use = out.exists() and any(out.iterdir())
    if in_use and not replace:
        raise FileExistsError(f"{out} already exists; replace it to rebuild")
    if in_use and not (out / "course.json").is_file():
        raise FileExistsError(f"{out} is not a bundle; refusing to replace it")

    building = out.with_name(out.name + BUILDING_SUFFIX)
    shutil.rmtree(building, ignore_errors=True)
    try:
        course = _write(building, name)
        if (out / DIR_NAME).is_dir():
            shutil.copytree(out / DIR_NAME, building / DIR_NAME)
        report = validate_bundle(building)
        if not report.ok:
            raise BakeError(report)
        _swap_in(building, out)
    finally:
        shutil.rmtree(building, ignore_errors=True)
    return course
