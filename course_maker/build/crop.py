"""Crop a bundle to a smaller rectangle of itself, in place, and take the crop back.

A course cut from a big lidar tile is often much bigger than the course. Cropping keeps the part of the 1 m grid inside a rectangle
(whole metres, so nothing is resampled) and moves everything else with it: the sculpting, the base heights, every design coordinate
(surfaces, bounds, routes, tree edits, landmarks, lake anchors), and the course's place on the earth, so the aerial still lines up. The
rasters that are built from the design (class, bounds, trees, water) are made again by the build that follows.

Before anything is written the bundle is copied to `.course_maker/crops/<time>/`, and `undo_crop` puts that copy back. It also puts back
the design as it was then, so edits made since the crop are lost, which is why the editor says so before it asks.
"""
from __future__ import annotations

import json
import shutil
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import shapely
from rasterio.crs import CRS
from shapely.geometry import Polygon, box

from .. import spec as S
from ..compiler.codec import read_png, write_png
from ..design.models import BoundsFile, Layout, RegionsFile, TreeEdits
from ..design.store import DESIGN_DIR, read_bounds, read_layout, read_regions, read_trees, write_design_file
from ..models import Course, Grid, TreesRef
from ..project.store import project_dir, read_editor, write_editor
from .cache import sha1_file
from .height import base_dir, decode_delta, delta_path, encode_delta, refresh_base, write_delta_bytes, _info_path
from .look import bundle_lock

CROPS_DIR = "crops"
KEEP_CROPS = 5
MIN_SIDE_M = 8  # a crop smaller than this on a side is almost certainly a slip
SLIVER_M2 = 0.05  # a piece of a clipped surface smaller than this is dropped, as the Cut tool does


class CropError(ValueError):
    """The crop cannot be made; nothing was changed."""


@dataclass
class CropResult:
    cols: int
    rows: int
    notes: list[str] = field(default_factory=list)


def crops_dir(bundle) -> Path:
    return project_dir(Path(bundle)) / CROPS_DIR


def list_crops(bundle) -> list[str]:
    """The crops that can be taken back, newest first."""
    root = crops_dir(bundle)
    return sorted((p.name for p in root.iterdir() if p.is_dir() and not p.name.endswith("-undone")), reverse=True) if root.is_dir() else []


# --- the copy a crop can be taken back from ----------------------------------------------------------------------------------


def _copy_state(bundle: Path, to: Path) -> None:
    """The bundle's files, the base heights and the design: everything a crop changes."""
    (to / "files").mkdir(parents=True)
    for entry in bundle.iterdir():
        if entry.name.startswith("."):
            continue
        shutil.copytree(entry, to / "files" / entry.name) if entry.is_dir() else shutil.copy2(entry, to / "files" / entry.name)
    for name in ("base", DESIGN_DIR):
        if (project_dir(bundle) / name).is_dir():
            shutil.copytree(project_dir(bundle) / name, to / name)


def _keep_newest(bundle: Path) -> None:
    root = crops_dir(bundle)
    if not root.is_dir():
        return
    names = [p.name for p in root.iterdir() if p.is_dir()]
    for undone, keep in ((False, KEEP_CROPS), (True, 2)):
        for old in sorted((n for n in names if n.endswith("-undone") == undone), reverse=True)[keep:]:
            shutil.rmtree(root / old, ignore_errors=True)


def _stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")


def _forget_built(bundle: Path) -> None:
    """The build's cache (and its forest) describe a grid that is gone."""
    shutil.rmtree(project_dir(bundle) / "build", ignore_errors=True)


def _reset_view(bundle: Path) -> None:
    """The saved map view is in the old coordinates."""
    state = read_editor(bundle).state
    write_editor(bundle, state.model_copy(update={"viewport": None}))


# --- moving the design -------------------------------------------------------------------------------------------------------


def _shift(ring, dx: float, dz: float):
    return [(round(x - dx, 3), round(z - dz, 3)) for x, z in ring]


def _clipped(items, dx: float, dz: float, width: float, height: float, notes: list[str], what: str):
    """Regions or bounds areas moved by (-dx, -dz) and cut to the new map. One cut across the map can leave several pieces: the first keeps
    the id, the others take `<id>-2`, `<id>-3`, right after it, so the painter's order holds."""
    frame = box(0, 0, width, height)
    taken = {i.id for i in items}
    out, dropped, split = [], 0, 0
    for item in items:
        outer, inner = _shift(item.outer, dx, dz), [_shift(r, dx, dz) for r in item.inner]
        if all(0 <= x <= width and 0 <= z <= height for x, z in outer):
            out.append(item.model_copy(update={"outer": outer, "inner": inner}))
            continue
        geom = Polygon(outer, inner)
        if not geom.is_valid:
            geom = shapely.make_valid(geom)
        hit = geom.intersection(frame)
        pieces = [g for g in getattr(hit, "geoms", [hit]) if isinstance(g, Polygon) and g.area >= SLIVER_M2]
        if not pieces:
            dropped += 1
            continue
        for n, piece in enumerate(pieces, start=1):
            name = item.id
            if n > 1:
                name = f"{item.id}-{n}"
                while name in taken:
                    name += "x"
                taken.add(name)
            rings = [_shift_ring_closed(piece.exterior.coords), *[_shift_ring_closed(r.coords) for r in piece.interiors]]
            out.append(item.model_copy(update={"id": name, "outer": rings[0], "inner": rings[1:]}))
        split += len(pieces) > 1
    if dropped:
        notes.append(f"{dropped} {what}{'s' if dropped != 1 else ''} lay wholly outside the new map and {'were' if dropped != 1 else 'was'} removed")
    if split:
        notes.append(f"{split} {what}{'s' if split != 1 else ''} crossed the edge and {'were' if split != 1 else 'was'} cut to the map")
    return out


def _shift_ring_closed(coords):
    ring = [(round(x, 3), round(z, 3)) for x, z in coords]
    if ring[0] != ring[-1]:
        ring.append(ring[0])
    return ring


def _inside(x: float, z: float, width: float, height: float, margin: float = 0.0) -> bool:
    return -margin <= x <= width + margin and -margin <= z <= height + margin


# --- the crop ----------------------------------------------------------------------------------------------------------------


def check_box(course: Course, x0: int, z0: int, x1: int, z1: int) -> None:
    cols, rows = course.height.cols, course.height.rows
    if not all(isinstance(v, int) and not isinstance(v, bool) for v in (x0, z0, x1, z1)):
        raise CropError("the crop's edges must be whole metres")
    if x0 < 0 or z0 < 0 or x1 > cols - 1 or z1 > rows - 1:
        raise CropError(f"the crop reaches outside the map ({cols - 1} x {rows - 1} m)")
    if x1 - x0 < MIN_SIDE_M or z1 - z0 < MIN_SIDE_M:
        raise CropError(f"a crop must be at least {MIN_SIDE_M} m across both ways")
    if (x1 - x0, z1 - z0) == (cols - 1, rows - 1):
        raise CropError("that is the whole map already")


def crop_bundle(bundle, x0: int, z0: int, x1: int, z1: int) -> CropResult:
    """Keep the map from x0..x1 east and z0..z1 south (course metres, whole numbers). The caller holds the builds (BuildManager.exclusive)
    and has saved what the editor had not, and schedules a build afterwards."""
    bundle = Path(bundle)
    with bundle_lock(bundle):
        course = Course.read(bundle / "course.json")
        check_box(course, x0, z0, x1, z1)
        width, height = x1 - x0, z1 - z0
        notes: list[str] = []

        patches = []
        for p in course.patches:
            if p.x0 < x0 or p.z0 < z0 or p.x0 + p.cellsX > x1 or p.z0 + p.cellsZ > z1:
                raise CropError(f"{p.file} would be cut by the crop; remove the patch or crop around it")
            patches.append(p.model_copy(update={"x0": p.x0 - x0, "z0": p.z0 - z0}))

        base = refresh_base(bundle, course)  # makes sure there is a base to crop, and that it is this project's
        layout, regions, bounds, trees = read_layout(bundle), read_regions(bundle), read_bounds(bundle), read_trees(bundle)
        delta = decode_delta(delta_path(bundle).read_bytes(), course.height.rows, course.height.cols) if delta_path(bundle).is_file() else None
        height_png, _ = read_png(bundle / course.height.file)
        base_png, _ = read_png(base_dir(bundle) / "height.png")
        window = (slice(z0, z1 + 1), slice(x0, x1 + 1))

        # everything is worked out before anything is written
        new_regions = RegionsFile(regions=_clipped(regions.regions, x0, z0, width, height, notes, "surface"))
        new_bounds = BoundsFile(areas=_clipped(bounds.areas, x0, z0, width, height, notes, "bounds area"))
        holes = []
        for h in layout.holes:
            route = _shift(h.route, x0, z0)
            if route and not all(_inside(x, z, width, height) for x, z in route):
                notes.append(f"the route of hole {h.number} now reaches outside the map")
            holes.append(h.model_copy(update={"route": route}))
        new_layout = Layout(name=layout.name, attribution=layout.attribution, holes=holes)
        added = [t.model_copy(update={"x": round(t.x - x0, 3), "z": round(t.z - z0, 3)}) for t in trees.added]
        removed = [c.model_copy(update={"x": round(c.x - x0, 3), "z": round(c.z - z0, 3)}) for c in trees.removed]
        new_trees = TreeEdits(
            defaults=trees.defaults,
            added=[t for t in added if _inside(t.x, t.z, width, height)],
            removed=[c for c in removed if _inside(c.x, c.z, width, height, c.r)],
        )
        if len(new_trees.added) != len(added):
            notes.append(f"{len(added) - len(new_trees.added)} placed trees lay outside the new map and were removed")
        landmarks = [m.model_copy(update={"x": round(m.x - x0, 3), "z": round(m.z - z0, 3)}) for m in course.landmarks]
        kept = [m for m in landmarks if _inside(m.x, m.z, width, height)]
        if len(kept) != len(landmarks):
            notes.append(f"{len(landmarks) - len(kept)} landmarks lay outside the new map and were removed")
        lakes = {}
        for key, lake in course.look.water.lakes.items():
            ax, az = round(lake.anchor[0] - x0, 3), round(lake.anchor[1] - z0, 3)
            if _inside(ax, az, width, height):
                lakes[key] = lake.model_copy(update={"anchor": (ax, az)})
        if len(lakes) != len(course.look.water.lakes):
            notes.append(f"{len(course.look.water.lakes) - len(lakes)} saved lake settings were for lakes outside the new map and were removed")
        look = course.look.model_copy(update={"water": course.look.water.model_copy(update={"lakes": lakes})})

        unit = float(CRS.from_string(course.crs).linear_units_factor[1])  # metres per CRS unit
        cols, rows = width + 1, height + 1
        grid = lambda g, res: Grid(file=g.file, cols=round(width / res), rows=round(height / res), res=res)
        new_course = course.model_copy(update={
            "originEasting": course.originEasting + x0 / unit, "originNorthing": course.originNorthing - z0 / unit,
            "height": Grid(file=course.height.file, cols=cols, rows=rows, res=course.height.res),
            "class_": grid(course.class_, S.CLASS_RES), "bounds": grid(course.bounds, S.BOUNDS_RES),
            "trees": TreesRef(file=course.trees.file, count=0), "patches": patches, "landmarks": kept, "look": look,
            "holes": [h.model_copy(update={"route": _shift(h.route, x0, z0)}) for h in course.holes],
        })

        # the way back, then the writes
        stamp = _stamp()
        _copy_state(bundle, crops_dir(bundle) / stamp)
        try:
            write_png(bundle / course.height.file, height_png[window].copy())
            write_png(base_dir(bundle) / "height.png", base_png[window].copy())
            _info_path(bundle).write_text(
                '{"hMin": %r, "hMax": %r, "builtSha": "%s"}\n' % (base.h_min, base.h_max, sha1_file(bundle / course.height.file)), encoding="utf-8")
            if delta is not None:
                write_delta_bytes(bundle, encode_delta(delta[window]), rows, cols)
            klass = np.zeros((new_course.class_.rows, new_course.class_.cols, 4), np.uint8)
            klass[..., 3] = 255
            write_png(bundle / new_course.class_.file, klass)
            write_png(bundle / new_course.bounds.file, np.zeros((new_course.bounds.rows, new_course.bounds.cols, 3), np.uint8))
            (bundle / new_course.trees.file).write_bytes(b"")
            write_design_file(bundle, "regions", new_regions)
            write_design_file(bundle, "bounds", new_bounds)
            write_design_file(bundle, "layout", new_layout)
            write_design_file(bundle, "trees", new_trees)
            _forget_built(bundle)
            new_course.write(bundle / "course.json")  # last: readers see the new rasters before they see the new numbers
            _reset_view(bundle)
        except BaseException:
            # half a crop is worse than none: put the copy back
            _restore_state(bundle, crops_dir(bundle) / stamp)
            shutil.rmtree(crops_dir(bundle) / stamp, ignore_errors=True)
            raise
        _keep_newest(bundle)
    return CropResult(cols=cols, rows=rows, notes=notes)


# --- taking it back ----------------------------------------------------------------------------------------------------------


def _restore_state(bundle: Path, src: Path) -> None:
    for entry in (src / "files").iterdir():
        target = bundle / entry.name
        if entry.is_dir():
            shutil.rmtree(target, ignore_errors=True)
            shutil.copytree(entry, target)
        else:
            shutil.copy2(entry, target)
    kept = {e.name for e in (src / "files").iterdir()}
    for stray in bundle.glob("water-*.json"):
        if stray.name not in kept:
            stray.unlink(missing_ok=True)
    for name in ("base", DESIGN_DIR):
        target = project_dir(bundle) / name
        shutil.rmtree(target, ignore_errors=True)
        if (src / name).is_dir():
            shutil.copytree(src / name, target)
    _forget_built(bundle)


def undo_crop(bundle) -> str:
    """Put back the bundle and the design as they were before the newest crop. Returns the crop's name. The state it replaces is kept as
    `<time>-undone`, which is not offered again but is there if it turns out to be wanted."""
    bundle = Path(bundle)
    with bundle_lock(bundle):
        crops = list_crops(bundle)
        if not crops:
            raise CropError("there is no crop to take back")
        name = crops[0]
        _copy_state(bundle, crops_dir(bundle) / f"{_stamp()}-undone")
        _restore_state(bundle, crops_dir(bundle) / name)
        shutil.rmtree(crops_dir(bundle) / name, ignore_errors=True)
        _reset_view(bundle)
        _keep_newest(bundle)
    return name
