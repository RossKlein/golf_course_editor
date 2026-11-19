"""Terrain sculpting: the pristine baked heights, the sparse file of edits to them, and the heights a build makes of the two.

heights = base + delta. The base is whatever the last bake wrote to height.png, kept under .course_maker/base/ so that
"restore the original" is exact and so that a re-bake (which replaces height.png) leaves the edits in place on top of the
new base. The delta is `design/height/macro.delta`: millimetre offsets in 64 x 64 tiles, only for tiles that were touched.
"""
from __future__ import annotations

import hashlib
import io
import json
import os
import struct
import tempfile
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from ..compiler.codec import decode_height, encode_height, read_png, write_png
from .cache import read_cache, sha1_bytes, write_cache
from ..design.store import DesignError, design_dir
from ..models import Course
from ..project.store import project_dir, replace_file

TILE = 64
MAGIC = b"HDLT"
VERSION = 1
HEADER = struct.Struct("<4sHHIII")  # magic, version, tile size, columns, rows, tile count
TILE_HEAD = struct.Struct("<HH")  # tile column, tile row
MM = 1000.0
MAX_DELTA_M = 32.0  # an int16 of millimetres


def delta_path(bundle: Path) -> Path:
    return design_dir(bundle) / "height" / "macro.delta"


def base_dir(bundle: Path) -> Path:
    return project_dir(bundle) / "base"


def sha1(path: Path) -> str:
    return hashlib.sha1(path.read_bytes()).hexdigest()


# --- the delta file --------------------------------------------------------------------------------------------------


def encode_delta(delta: np.ndarray) -> bytes:
    """Metres (rows x cols) -> the sparse tile file. Tiles that are all zero are left out."""
    rows, cols = delta.shape
    mm = np.clip(np.rint(delta.astype(np.float64) * MM), -32767, 32767).astype(np.int16)
    tiles = []
    for ty in range((rows + TILE - 1) // TILE):
        for tx in range((cols + TILE - 1) // TILE):
            block = mm[ty * TILE:(ty + 1) * TILE, tx * TILE:(tx + 1) * TILE]
            if not block.any():
                continue
            full = np.zeros((TILE, TILE), np.int16)
            full[:block.shape[0], :block.shape[1]] = block
            tiles.append(TILE_HEAD.pack(tx, ty) + full.astype("<i2").tobytes())
    return HEADER.pack(MAGIC, VERSION, TILE, cols, rows, len(tiles)) + b"".join(tiles)


def decode_delta(data: bytes, rows: int, cols: int) -> np.ndarray:
    """The tile file -> metres (rows x cols) as float32. Raises DesignError if it is not a valid file for this grid."""
    if len(data) < HEADER.size:
        raise DesignError("macro.delta: file is too short")
    magic, version, tile, c, r, count = HEADER.unpack_from(data)
    if magic != MAGIC or version != VERSION or tile != TILE:
        raise DesignError("macro.delta: not a height delta file this version can read")
    if (c, r) != (cols, rows):
        raise DesignError(f"macro.delta: made for a {c} x {r} grid, but this course's is {cols} x {rows}")
    each = TILE_HEAD.size + TILE * TILE * 2
    if len(data) != HEADER.size + count * each:
        raise DesignError("macro.delta: the size does not match the tile count")
    out = np.zeros((rows, cols), np.float32)
    seen = set()
    for i in range(count):
        at = HEADER.size + i * each
        tx, ty = TILE_HEAD.unpack_from(data, at)
        if tx * TILE >= cols or ty * TILE >= rows or (tx, ty) in seen:
            raise DesignError(f"macro.delta: tile {tx},{ty} is outside the grid or repeated")
        seen.add((tx, ty))
        block = np.frombuffer(data, "<i2", TILE * TILE, at + TILE_HEAD.size).reshape(TILE, TILE)
        h, w = min(TILE, rows - ty * TILE), min(TILE, cols - tx * TILE)
        out[ty * TILE:ty * TILE + h, tx * TILE:tx * TILE + w] = block[:h, :w] / MM
    return out


def read_delta(bundle: Path, rows: int, cols: int) -> np.ndarray | None:
    path = delta_path(bundle)
    return decode_delta(path.read_bytes(), rows, cols) if path.is_file() else None


def write_delta_bytes(bundle: Path, data: bytes, rows: int, cols: int) -> None:
    """Store an uploaded delta file after checking it reads. Atomic, like every design file."""
    decode_delta(data, rows, cols)
    path = delta_path(bundle)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
        replace_file(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)


# --- the base --------------------------------------------------------------------------------------------------------


@dataclass
class Base:
    h_min: float
    h_max: float
    built_sha: str  # the height.png this project last wrote; anything else in its place came from a bake


def _info_path(bundle: Path) -> Path:
    return base_dir(bundle) / "height.json"


def _read_info(bundle: Path) -> Base | None:
    p = _info_path(bundle)
    if not (p.is_file() and (base_dir(bundle) / "height.png").is_file()):
        return None
    try:
        d = json.loads(p.read_text(encoding="utf-8"))
        return Base(float(d["hMin"]), float(d["hMax"]), str(d["builtSha"]))
    except (ValueError, KeyError, TypeError):
        return None


def _write_info(bundle: Path, base: Base) -> None:
    _info_path(bundle).write_text(json.dumps({"hMin": base.h_min, "hMax": base.h_max, "builtSha": base.built_sha}, indent=1) + "\n", encoding="utf-8")


def refresh_base(bundle: Path, course: Course) -> Base:
    """The pristine heights for this bundle. If height.png is not the one this project last wrote it came from a bake
    (the first one, or a re-bake), so it becomes the new base."""
    current = bundle / course.height.file
    sha = sha1(current)
    base = _read_info(bundle)
    if base is None or base.built_sha != sha:
        base_dir(bundle).mkdir(parents=True, exist_ok=True)
        (base_dir(bundle) / "height.png").write_bytes(current.read_bytes())
        base = Base(course.hMin, course.hMax, sha)
        _write_info(bundle, base)
    return base


def record_built(bundle: Path, sha: str) -> None:
    base = _read_info(bundle)
    if base:
        base.built_sha = sha
        _write_info(bundle, base)


# --- the build -------------------------------------------------------------------------------------------------------


@dataclass
class HeightResult:
    png: bytes | None  # the new height.png, or None when it is unchanged
    h_min: float
    h_max: float
    sha: str  # of the height.png that will be in place
    key: str = ""  # what went into it (see apply_delta), for the build to remember


def apply_delta(bundle: Path, course: Course, notes: list[str]) -> HeightResult:
    """The heights this design makes: base + delta, encoded as height.png."""
    base = refresh_base(bundle, course)
    base_png = (base_dir(bundle) / "height.png").read_bytes()
    rows, cols = course.height.rows, course.height.cols
    delta_file = delta_path(bundle)
    # What goes into the heights: the base, the sculpting, and the range. If they are what the last build used, and height.png is still the
    # file it wrote (refresh_base found its sha unchanged), the result is that file and the decode, add and encode below are skipped.
    key = sha1_bytes(base_png, delta_file.read_bytes() if delta_file.is_file() else b"", f"{base.h_min},{base.h_max},{bool(course.patches)},{rows},{cols}".encode())
    cache = read_cache(bundle)
    kept = cache.get("heights")
    if kept and kept.get("key") == key and kept.get("sha") == base.built_sha:
        return HeightResult(None, float(kept["hMin"]), float(kept["hMax"]), str(kept["sha"]), key)
    current = (bundle / course.height.file).read_bytes()
    delta = read_delta(bundle, rows, cols)

    if delta is None or not delta.any():
        png, h_min, h_max = base_png, base.h_min, base.h_max  # the exact baked bytes
    else:
        rgba, _ = read_png(base_dir(bundle) / "height.png")
        heights = decode_height(rgba, base.h_min, base.h_max) + delta
        lo, hi = float(heights.min()), float(heights.max())
        h_min, h_max = base.h_min, base.h_max
        if lo < h_min or hi > h_max:
            if course.patches:  # patches are encoded against this range, so it cannot move under them
                notes.append("sculpted heights outside the course's height range were flattened, because patches depend on that range")
                heights = np.clip(heights, h_min, h_max)
            else:
                h_min, h_max = min(h_min, np.floor(lo - 0.5)), max(h_max, np.ceil(hi + 0.5))
        buf = io.BytesIO()
        write_png(buf, encode_height(heights, h_min, h_max))
        png = buf.getvalue()
    return HeightResult(None if png == current else png, float(h_min), float(h_max), hashlib.sha1(png).hexdigest(), key)
