"""Validate a course bundle against docs/golf-course-format.md.

    python -m compiler.validate bundles/augusta

Exit status is 1 when any error is found. Warnings do not fail the run.
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from . import schema as S
from .codec import decode_height, read_png, sample_bilinear
from .schema import Course, SchemaError

TREE_DTYPE = np.dtype([("x", "<f4"), ("z", "<f4"), ("height_cm", "<u2"), ("kind", "u1"), ("reserved", "u1")])
assert TREE_DTYPE.itemsize == S.TREE_RECORD_BYTES


@dataclass
class Report:
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    sizes: dict[str, int] = field(default_factory=dict)

    @property
    def ok(self) -> bool:
        return not self.errors

    def error(self, msg: str) -> None:
        self.errors.append(msg)

    def warn(self, msg: str) -> None:
        self.warnings.append(msg)


def _load_png(root: Path, rel: str, mode: str, shape: tuple[int, ...], r: Report):
    """Load a PNG that must be inside the bundle, with the given mode and array shape. None if unusable."""
    path = (root / rel).resolve()
    if root not in path.parents:
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


def _check_basics(c: Course, r: Report) -> None:
    if not c.hMax > c.hMin:
        r.error("hMax must be greater than hMin")
    hg, cg, bg = c.height, c.class_, c.bounds
    if hg.res != S.HEIGHT_RES:
        r.error(f"height.res must be {S.HEIGHT_RES}")
    if cg.res != S.CLASS_RES:
        r.error(f"class.res must be {S.CLASS_RES}")
    if bg.res != S.BOUNDS_RES:
        r.error(f"bounds.res must be {S.BOUNDS_RES}")
    if hg.cols < 2 or hg.rows < 2:
        r.error("height grid needs at least 2x2 samples")
    # class and bounds cells cover exactly the macro extent
    w, h = hg.cols - 1, hg.rows - 1
    want_class = (round(w / cg.res), round(h / cg.res))
    want_bounds = (round(w / bg.res), round(h / bg.res))
    if (cg.cols, cg.rows) != want_class:
        r.error(f"class grid must be {want_class[0]}x{want_class[1]} to cover the macro extent")
    if (bg.cols, bg.rows) != want_bounds:
        r.error(f"bounds grid must be {want_bounds[0]}x{want_bounds[1]} to cover the macro extent")

    numbers = [h.number for h in c.holes]
    if numbers != list(range(1, len(numbers) + 1)):
        r.error("hole numbers must be 1-based and contiguous, in order")
    if len(numbers) > S.MAX_HOLES:
        r.error(f"at most {S.MAX_HOLES} holes are supported")
    ex, ez = c.extent
    inside = lambda x, z: 0 <= x <= ex and 0 <= z <= ez  # noqa: E731
    for h in c.holes:
        if h.par < 1:
            r.error(f"hole {h.number}: par must be positive")
        if len(h.route) < 2:
            r.error(f"hole {h.number}: route needs at least 2 points")
        if not all(inside(x, z) for x, z in h.route):
            r.error(f"hole {h.number}: route leaves the course")
    for m in c.landmarks:
        if not inside(m.x, m.z):
            r.error(f"landmark {m.name!r}: outside the course")
        if m.scale <= 0:
            r.error(f"landmark {m.name!r}: scale must be positive")
    if len(c.patches) > S.MAX_PATCHES:
        r.error(f"at most {S.MAX_PATCHES} patches are supported")


def _check_patches(c: Course, root: Path, macro: np.ndarray | None, r: Report) -> None:
    ex, ez = c.extent
    for i, p in enumerate(c.patches):
        tag = f"patch {i} ({p.file})"
        if p.cellsX < 1 or p.cellsZ < 1:
            r.error(f"{tag}: must cover at least one macro cell")
            continue
        if p.x0 < 0 or p.z0 < 0 or p.x0 + p.cellsX > ex or p.z0 + p.cellsZ > ez:
            r.error(f"{tag}: outside the macro grid")
        if p.cols > S.PATCH_MAX_SAMPLES or p.rows > S.PATCH_MAX_SAMPLES:
            r.error(f"{tag}: more than {S.PATCH_MAX_SAMPLES} samples on a side")
    for i, a in enumerate(c.patches):
        for j in range(i + 1, len(c.patches)):
            b = c.patches[j]
            if a.x0 < b.x0 + b.cellsX and b.x0 < a.x0 + a.cellsX and a.z0 < b.z0 + b.cellsZ and b.z0 < a.z0 + a.cellsZ:
                r.error(f"patches {i} and {j} overlap")
    for i, p in enumerate(c.patches):
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
    path = (root / c.trees.file).resolve()
    if root not in path.parents or not path.is_file():
        r.error(f"{c.trees.file}: file is missing or outside the bundle")
        return
    size = path.stat().st_size
    r.sizes[c.trees.file] = size
    if size != c.trees.count * S.TREE_RECORD_BYTES:
        r.error(f"{c.trees.file}: size {size} does not match count {c.trees.count} x {S.TREE_RECORD_BYTES} bytes")
        return
    trees = np.frombuffer(path.read_bytes(), TREE_DTYPE)
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
        green = np.stack([owned_rows[mine & (owned_class == S.GREEN)], owned_cols[mine & (owned_class == S.GREEN)]], axis=1)
        if len(green) and not _green_connected(green):
            r.error(f"hole {h.number}: green cells are not one connected region")
        if mine.any():
            # class cells are 0.5 m, bounds cells 1 m: the class->bounds cell is index // 2
            bits = (mask[owned_rows[mine] // 2, owned_cols[mine] // 2] >> (h.number - 1)) & 1
            if not bits.all():
                r.error(f"hole {h.number}: {int((bits == 0).sum())} owned cells are out of bounds for it")


def validate_bundle(path) -> Report:
    root = Path(path).resolve()
    r = Report()
    manifest = root / "course.json"
    if not manifest.is_file():
        r.error("course.json is missing")
        return r
    r.sizes["course.json"] = manifest.stat().st_size
    try:
        course = Course.parse(json.loads(manifest.read_text(encoding="utf-8")))
    except (json.JSONDecodeError, SchemaError) as exc:
        r.error(f"course.json: {exc}")
        return r
    _check_basics(course, r)

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

    total = sum(r.sizes.values())
    if total > S.BUNDLE_BUDGET_BYTES:
        r.warn(f"bundle is {total / 1e6:.1f} MB, over the {S.BUNDLE_BUDGET_BYTES / 1e6:.0f} MB budget")
    return r


def format_report(r: Report) -> str:
    lines = [f"  {name:<22}{size / 1e6:>8.2f} MB" for name, size in sorted(r.sizes.items())]
    lines.append(f"  {'total':<22}{sum(r.sizes.values()) / 1e6:>8.2f} MB")
    lines += [f"warning: {w}" for w in r.warnings]
    lines += [f"ERROR: {e}" for e in r.errors]
    lines.append("OK" if r.ok else f"{len(r.errors)} error(s)")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("bundle", help="bundle directory containing course.json")
    report = validate_bundle(ap.parse_args(argv).bundle)
    print(format_report(report))
    return 0 if report.ok else 1


if __name__ == "__main__":
    sys.exit(main())
