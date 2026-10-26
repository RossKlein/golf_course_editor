"""Pixel encodings (docs/golf-course-format.md): 16-bit heights in RGBA8, PNG IO, bilinear sampling."""
from __future__ import annotations

import numpy as np
from PIL import Image


def encode_height(h: np.ndarray, h_min: float, h_max: float) -> np.ndarray:
    """Metres -> RGBA8: R = high byte, G = low byte, B = 0, A = 255."""
    if not h_max > h_min:
        raise ValueError("hMax must be greater than hMin")
    v = np.rint((h.astype(np.float64) - h_min) / (h_max - h_min) * 65535)
    if np.isnan(v).any() or v.min() < 0 or v.max() > 65535:
        raise ValueError("heights contain NaN or fall outside [hMin, hMax]")
    v = v.astype(np.uint16)
    out = np.zeros(h.shape + (4,), np.uint8)
    out[..., 0] = v >> 8
    out[..., 1] = v & 255
    out[..., 3] = 255
    return out


def decode_height(rgba: np.ndarray, h_min: float, h_max: float) -> np.ndarray:
    v = rgba[..., 0].astype(np.uint32) * 256 + rgba[..., 1]
    return h_min + v / 65535.0 * (h_max - h_min)


def write_png(path, arr: np.ndarray) -> None:
    """Write an 8-bit grayscale, RGB or RGBA array as an optimized PNG, to a path or a file object."""
    if arr.dtype != np.uint8:
        raise ValueError("PNG data must be uint8")
    Image.fromarray(arr).save(path, format="PNG", optimize=True)


def read_png(path) -> tuple[np.ndarray, str]:
    """Return (array, PIL mode). The mode lets callers reject unexpected formats instead of converting."""
    with Image.open(path) as im:
        im.load()
        return np.asarray(im), im.mode


def sample_bilinear(grid: np.ndarray, res: float, x, z, x0: float = 0.0, z0: float = 0.0) -> np.ndarray:
    """Bilinear height at world (x, z) for samples on grid points; clamps to the edge samples."""
    rows, cols = grid.shape
    fx = np.clip((np.asarray(x, np.float64) - x0) / res, 0, cols - 1)
    fz = np.clip((np.asarray(z, np.float64) - z0) / res, 0, rows - 1)
    c0 = np.minimum(np.floor(fx).astype(int), cols - 2)
    r0 = np.minimum(np.floor(fz).astype(int), rows - 2)
    tx, tz = fx - c0, fz - r0
    top = grid[r0, c0] * (1 - tx) + grid[r0, c0 + 1] * tx
    bot = grid[r0 + 1, c0] * (1 - tx) + grid[r0 + 1, c0 + 1] * tx
    return top * (1 - tz) + bot * tz
