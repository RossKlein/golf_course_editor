"""The aerial layer: the stack's RGB bands as one JPEG, plus where it sits in course coordinates."""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import rasterio
from PIL import Image

from compiler.schema import Course


def aerial_meta(stack_path, course: Course) -> dict:
    """Placement of the stack's top-left corner in course metres (x east, z south), and its pixel size."""
    with rasterio.open(stack_path) as ds:
        if ds.crs.to_string() != course.crs:
            raise ValueError(f"stack CRS {ds.crs.to_string()} does not match the bundle's {course.crs}")
        t = ds.transform
        if t.b or t.d or t.a <= 0 or t.e >= 0:
            raise ValueError("stack must be north-up")
        return {
            "x0": t.c - course.originEasting,
            "z0": course.originNorthing - t.f,
            "res": t.a,
            "width": ds.width,
            "height": ds.height,
        }


def build_aerial(stack_path, course: Course, cache_dir) -> tuple[Path, dict]:
    """Write (or reuse) cache_dir/aerial.jpg and return it with its placement."""
    cache = Path(cache_dir)
    cache.mkdir(parents=True, exist_ok=True)
    meta = aerial_meta(stack_path, course)
    jpg, stamp = cache / "aerial.jpg", cache / "aerial.json"
    source = {"stack": str(Path(stack_path).resolve()), "mtime": Path(stack_path).stat().st_mtime, "meta": meta}
    if jpg.is_file() and stamp.is_file() and json.loads(stamp.read_text()) == source:
        return jpg, meta
    with rasterio.open(stack_path) as ds:
        rgb = ds.read([1, 2, 3])  # float 0-255, 0 = no imagery
    img = Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8).transpose(1, 2, 0))
    img.save(jpg, quality=85)
    stamp.write_text(json.dumps(source))
    return jpg, meta
