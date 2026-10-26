"""Build a bundle from its design: regions -> class.png, layout -> course.json holes, default bounds.

Everything is built in a staging copy first and validated; only then are the generated files moved into the live
bundle (course.json last). A crash or a design that cannot be built leaves the previous bundle untouched.
Findings from the validator are *problems to show*, not reasons to refuse: while someone is mid-drawing a hole
nearly always has something missing.
"""
from __future__ import annotations

import os
import shutil
import time
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import rasterio.features
import shapely
from affine import Affine
from shapely.geometry import MultiPolygon, Polygon

from .. import spec as S
from ..compiler.codec import write_png
from ..compiler.validate import validate_bundle
from ..design.store import read_layout, read_regions
from ..models import Course, Hole, Report
from ..project.store import DIR_NAME

GENERATED = ("class.png", "bounds.png")  # replaced before course.json


@dataclass
class BuildOutcome:
    report: Report
    notes: list[str] = field(default_factory=list)
    regions: int = 0
    holes: int = 0
    ms: dict[str, int] = field(default_factory=dict)


def _polygons(region, notes: list[str]):
    """The region as valid shapely geometry, or None when nothing drawable is left."""
    geom = Polygon(region.outer, region.inner)
    if not geom.is_valid:
        fixed = shapely.make_valid(geom)
        parts = [g for g in getattr(fixed, "geoms", [fixed]) if isinstance(g, (Polygon, MultiPolygon)) and not g.is_empty]
        geom = MultiPolygon([p for g in parts for p in (g.geoms if isinstance(g, MultiPolygon) else [g])]) if parts else None
        notes.append(f"region {region.id} was self-intersecting and was repaired" if geom else f"region {region.id} is degenerate and was skipped")
    return None if geom is None or geom.is_empty else geom


def rasterize_classes(regions, course: Course, notes: list[str]) -> np.ndarray:
    """RGBA class map: R = class, G = owning hole (owned classes only). One rasterize call per channel: within a call
    later shapes overwrite earlier ones, which is painter's order, and a call per region is ~50x slower."""
    cg = course.class_
    shape, transform = (cg.rows, cg.cols), Affine(cg.res, 0, 0, 0, cg.res, 0)  # row r covers z in [r*res, (r+1)*res)
    class_shapes, owner_shapes = [], []
    for r in regions:
        geom = _polygons(r, notes)
        if geom is None:
            continue
        class_shapes.append((geom, r.class_))
        if r.hole is not None:
            owner_shapes.append((geom, r.hole))
    klass = rasterio.features.rasterize(class_shapes, out_shape=shape, transform=transform, dtype="uint8") if class_shapes else np.zeros(shape, np.uint8)
    owner = rasterio.features.rasterize(owner_shapes, out_shape=shape, transform=transform, dtype="uint8") if owner_shapes else np.zeros(shape, np.uint8)
    owner[~np.isin(klass, S.OWNED_CLASSES)] = 0  # a later region painted over it, or it is not an owned class
    out = np.zeros(shape + (4,), np.uint8)
    out[..., 0], out[..., 1], out[..., 3] = klass, owner, 255
    return out


def default_bounds(course: Course, holes: int) -> np.ndarray:
    """Until bounds are designed, every cell is in bounds for every hole."""
    bg = course.bounds
    mask = (1 << holes) - 1
    out = np.zeros((bg.rows, bg.cols, 3), np.uint8)
    out[..., 0], out[..., 1], out[..., 2] = mask & 255, (mask >> 8) & 255, (mask >> 16) & 255
    return out


def usable_holes(layout, notes: list[str]) -> list[Hole]:
    """The leading run of holes that have a route. The bundle's hole numbers must be contiguous, so a hole without a
    route also hides the ones after it."""
    holes: list[Hole] = []
    for h in layout.holes:
        if len(h.route) < 2:
            notes.append(f"hole {h.number} has no route yet, so it and any holes after it are not in course.json")
            break
        holes.append(Hole(number=h.number, par=h.par, route=[tuple(p) for p in h.route]))
    return holes


def build_bundle(bundle) -> BuildOutcome:
    bundle = Path(bundle)
    t0 = time.perf_counter()
    course = Course.read(bundle / "course.json")
    layout, regions = read_layout(bundle), read_regions(bundle)  # DesignError if a design file is invalid
    notes: list[str] = []
    ms: dict[str, int] = {}

    staging = bundle / DIR_NAME / "build" / "staging"
    shutil.rmtree(staging, ignore_errors=True)
    staging.mkdir(parents=True)
    try:
        for entry in bundle.iterdir():  # unchanged files (height, trees, patches) are copied so the staging bundle is complete
            if entry.name.startswith(".") or entry.name in GENERATED or entry.name == "course.json":
                continue
            shutil.copytree(entry, staging / entry.name) if entry.is_dir() else shutil.copy2(entry, staging / entry.name)
        ms["stage"] = round((time.perf_counter() - t0) * 1000)

        t = time.perf_counter()
        holes = usable_holes(layout, notes)
        klass = rasterize_classes(regions.regions, course, notes)
        ms["rasterize"] = round((time.perf_counter() - t) * 1000)

        t = time.perf_counter()
        write_png(staging / "class.png", klass)
        write_png(staging / "bounds.png", default_bounds(course, len(holes)))
        ms["encode"] = round((time.perf_counter() - t) * 1000)

        data = course.model_dump(by_alias=True, exclude_none=True)
        data["holes"] = [h.model_dump() for h in holes]
        if layout.name:
            data["name"] = layout.name
        if layout.attribution:
            data["attribution"] = layout.attribution
        Course.model_validate(data).write(staging / "course.json")

        t = time.perf_counter()
        report = validate_bundle(staging)
        ms["validate"] = round((time.perf_counter() - t) * 1000)

        for name in (*GENERATED, "course.json"):  # course.json last: readers see new rasters before they see new numbers
            os.replace(staging / name, bundle / name)
    finally:
        shutil.rmtree(staging, ignore_errors=True)
    ms["total"] = round((time.perf_counter() - t0) * 1000)
    return BuildOutcome(report=report, notes=notes, regions=len(regions.regions), holes=len(holes), ms=ms)
