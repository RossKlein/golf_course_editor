"""Validate a course bundle against docs/golf-course-format.md.

Everything that can be checked from course.json alone is enforced by the pydantic models (models.py). This
module adds the checks that need the files: image modes and sizes, pixel values, patch borders, trees, holes.
"""
from __future__ import annotations

from collections import deque
from pathlib import Path

import numpy as np
from pydantic import ValidationError

from .. import spec as S
from ..models import Course, Report
from .codec import decode_height, read_png, sample_bilinear


def _inside(root: Path, rel: str) -> Path | None:
    path = (root / rel).resolve()
    return path if root in path.parents else None


def _load_png(root: Path, rel: str, mode: str, shape: tuple[int, ...], r: Report):
    """Load a PNG that must be inside the bundle, with the given mode and array shape. None if unusable."""
    path = _inside(root, rel)
    if path is None:
        r.error(f"{rel}: path escapes the bundle")
        return None
    if not path.is_file():
        r.error(f"{rel}: file is missing")
        return None
    r.sizes[rel] = path.stat().st_size
    try:
        arr, got = read_png(path)
    except Exception as exc:  # PIL raises several error types for corrupt files
        r.error(f"{rel}: cannot read PNG ({exc})")
        return None
    if got != mode:
        r.error(f"{rel}: expected {mode} PNG, got {got}")
        return None
    if arr.shape != shape:
        r.error(f"{rel}: expected {shape[1]}x{shape[0]} pixels, got {arr.shape[1]}x{arr.shape[0]}")
        return None
    return arr


def _check_patches(c: Course, root: Path, macro: np.ndarray | None, r: Report) -> None:
    for p in c.patches:
        arr = _load_png(root, p.file, "RGBA", (p.rows, p.cols, 4), r)
        if arr is None:
            continue
        if arr[..., 2].any() or (arr[..., 3] != 255).any():
            r.error(f"{p.file}: B must be 0 and A must be 255")
        if macro is None:
            continue
        heights = decode_height(arr, c.hMin, c.hMax)
        ring = np.zeros(heights.shape, bool)
        ring[0, :] = ring[-1, :] = ring[:, 0] = ring[:, -1] = True
        rr, cc = np.nonzero(ring)
        x = p.x0 + cc * S.PATCH_RES
        z = p.z0 + rr * S.PATCH_RES
        diff = np.abs(heights[rr, cc] - sample_bilinear(macro, S.HEIGHT_RES, x, z))
        if diff.max() > S.PATCH_BORDER_TOL_M:
            r.error(f"{p.file}: border differs from the macro surface by up to {diff.max() * 1000:.1f} mm "
                    f"(limit {S.PATCH_BORDER_TOL_M * 1000:.0f} mm)")


def _check_trees(c: Course, root: Path, r: Report) -> None:
    path = _inside(root, c.trees.file)
    if path is None or not path.is_file():
        r.error(f"{c.trees.file}: file is missing or outside the bundle")
        return
    size = path.stat().st_size
    r.sizes[c.trees.file] = size
    if size != c.trees.count * S.TREE_RECORD_BYTES:
        r.error(f"{c.trees.file}: size {size} does not match count {c.trees.count} x {S.TREE_RECORD_BYTES} bytes")
        return
    trees = np.frombuffer(path.read_bytes(), S.TREE_DTYPE)
    if trees.size == 0:
        return
    ex, ez = c.extent
    if trees["reserved"].any():
        r.error(f"{c.trees.file}: reserved byte must be 0")
    if not (np.isfinite(trees["x"]).all() and np.isfinite(trees["z"]).all()):
        r.error(f"{c.trees.file}: non-finite position")
    elif ((trees["x"] < 0) | (trees["x"] > ex) | (trees["z"] < 0) | (trees["z"] > ez)).any():
        r.error(f"{c.trees.file}: tree outside the course")
    if (trees["height_cm"] == 0).any():
        r.warn(f"{c.trees.file}: tree with zero height")


def _green_connected(cells: np.ndarray) -> bool:
    """4-connectivity over an (n, 2) array of (row, col) cells."""
    todo = {tuple(x) for x in cells.tolist()}
    start = next(iter(todo))
    seen, queue = {start}, deque([start])
    while queue:
        rr, cc = queue.popleft()
        for n in ((rr + 1, cc), (rr - 1, cc), (rr, cc + 1), (rr, cc - 1)):
            if n in todo and n not in seen:
                seen.add(n)
                queue.append(n)
    return len(seen) == len(todo)


def _check_holes(c: Course, cls: np.ndarray, bounds: np.ndarray, r: Report) -> None:
    klass, owner = cls[..., 0], cls[..., 1]
    if np.isin(klass, list(S.CLASSES.values()), invert=True).any():
        r.error("class.png: contains values (R) that are not a defined class")
    if ((owner != 0) & ~np.isin(klass, S.OWNED_CLASSES)).any():
        r.error("class.png: hole number (G) set on a class that is not fairway, green or tee")
    numbers = {h.number for h in c.holes}
    if not set(np.unique(owner).tolist()) <= numbers | {0}:
        r.error("class.png: hole number (G) that is not listed in holes")
    if cls[..., 2].any() or (cls[..., 3] != 255).any():
        r.error("class.png: B must be 0 and A must be 255")

    mask = bounds[..., 0].astype(np.int32) | (bounds[..., 1].astype(np.int32) << 8) | (bounds[..., 2].astype(np.int32) << 16)
    if len(c.holes) < 24 and (mask >> len(c.holes)).any():
        r.warn("bounds.png: bits set for holes that do not exist")

    owned_rows, owned_cols = np.nonzero(owner)
    owned_class = klass[owned_rows, owned_cols]
    owned_hole = owner[owned_rows, owned_cols]
    for h in c.holes:
        mine = owned_hole == h.number
        for name, cid in (("tee", S.TEE), ("green", S.GREEN)):
            if not (mine & (owned_class == cid)).any():
                r.error(f"hole {h.number}: owns no {name} cells")
        is_green = mine & (owned_class == S.GREEN)
        green = np.stack([owned_rows[is_green], owned_cols[is_green]], axis=1)
        if len(green) and not _green_connected(green):
            r.error(f"hole {h.number}: green cells are not one connected region")
        if mine.any():
            # class cells are 0.5 m, bounds cells 1 m: the class->bounds cell is index // 2
            bits = (mask[owned_rows[mine] // 2, owned_cols[mine] // 2] >> (h.number - 1)) & 1
            if not bits.all():
                r.error(f"hole {h.number}: {int((bits == 0).sum())} owned cells are out of bounds for it")


def _schema_errors(exc: ValidationError) -> list[str]:
    out = []
    for e in exc.errors():
        where = ".".join(str(p) for p in e["loc"])
        for line in e["msg"].removeprefix("Value error, ").split("\n"):
            out.append(f"course.json: {where + ': ' if where else ''}{line}")
    return out


def validate_bundle(path) -> Report:
    root = Path(path).resolve()
    r = Report()
    manifest = root / "course.json"
    if not manifest.is_file():
        r.error("course.json is missing")
        return r
    r.sizes["course.json"] = manifest.stat().st_size
    try:
        course = Course.read(manifest)
    except ValidationError as exc:
        r.errors.extend(_schema_errors(exc))
        return r

    hg, cg, bg = course.height, course.class_, course.bounds
    height_img = _load_png(root, hg.file, "RGBA", (hg.rows, hg.cols, 4), r)
    class_img = _load_png(root, cg.file, "RGBA", (cg.rows, cg.cols, 4), r)
    bounds_img = _load_png(root, bg.file, "RGB", (bg.rows, bg.cols, 3), r)
    macro = None
    if height_img is not None:
        if height_img[..., 2].any() or (height_img[..., 3] != 255).any():
            r.error(f"{hg.file}: B must be 0 and A must be 255")
        macro = decode_height(height_img, course.hMin, course.hMax)
    _check_patches(course, root, macro, r)
    _check_trees(course, root, r)
    if class_img is not None and bounds_img is not None and r.ok:
        _check_holes(course, class_img, bounds_img, r)

    if r.total_bytes > S.BUNDLE_BUDGET_BYTES:
        r.warn(f"bundle is {r.total_bytes / 1e6:.1f} MB, over the {S.BUNDLE_BUDGET_BYTES / 1e6:.0f} MB budget")
    return r


def format_report(r: Report) -> str:
    lines = [f"  {name:<22}{size / 1e6:>8.2f} MB" for name, size in sorted(r.sizes.items())]
    lines.append(f"  {'total':<22}{r.total_bytes / 1e6:>8.2f} MB")
    lines += [f"warning: {w}" for w in r.warnings]
    lines += [f"ERROR: {e}" for e in r.errors]
    lines.append("OK" if r.ok else f"{len(r.errors)} error(s)")
    return "\n".join(lines)
