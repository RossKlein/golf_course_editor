"""Render any GeoTIFF for the viewer: an RGB JPEG and/or a 16-bit elevation PNG, cached by file identity.

Large rasters are decimated so the longest side is at most MAX_RENDER pixels.
"""
from __future__ import annotations

import hashlib
import math
import threading
from pathlib import Path

import numpy as np
import rasterio
from affine import Affine
from PIL import Image
from rasterio.enums import Resampling

from ..compiler.codec import encode_height, write_png
from ..models import ElevationLayer, RasterLayer, TifView

MAX_RENDER = 4096
ELEVATION_WORDS = ("elev", "height", "dem", "dtm", "dsm")
RGB_FILE, ELEVATION_FILE, VIEW_FILE = "rgb.jpg", "elevation.png", "view.json"

_lock = threading.Lock()  # one render at a time; renders are memory-heavy and the cache is shared


def elevation_band(ds) -> int | None:
    for i, d in enumerate(ds.descriptions, 1):
        if d and any(w in d.lower() for w in ELEVATION_WORDS):
            return i
    return 1 if ds.count == 1 else None


def rgb_bands(ds, elevation: int | None) -> list[int] | None:
    return [1, 2, 3] if ds.count >= 3 and elevation not in (1, 2, 3) else None


def metres_per_unit(ds) -> tuple[float, float]:
    """Metres per CRS unit along x and y (approximate for geographic CRSs, at the raster's centre)."""
    if ds.crs is None:
        return 1.0, 1.0
    if ds.crs.is_geographic:
        lat = math.radians((ds.bounds.bottom + ds.bounds.top) / 2)
        return 111_320 * math.cos(lat), 110_574.0
    factor = ds.crs.linear_units_factor[1]
    return factor, factor


def cache_dir(path: Path, cache_root: Path) -> Path:
    st = path.stat()
    key = hashlib.sha1(f"{path.resolve()}|{st.st_mtime_ns}|{st.st_size}".encode()).hexdigest()[:16]
    return cache_root / "tifs" / key


def _to_rgb8(data: np.ma.MaskedArray, dtype: str) -> np.ndarray:
    rgb = data.astype(np.float64).filled(np.nan)
    finite = rgb[np.isfinite(rgb)]
    if dtype == "uint8" or (finite.size and finite.min() >= 0 and finite.max() <= 255):
        out = rgb
    else:  # stretch other ranges (e.g. 16-bit imagery) between the 2nd and 98th percentiles
        valid = finite[finite > 0] if (finite > 0).any() else finite
        lo, hi = (np.percentile(valid, [2, 98]) if valid.size else (0.0, 1.0))
        out = (rgb - lo) / max(hi - lo, 1e-9) * 255
    return np.nan_to_num(np.clip(out, 0, 255), nan=0).astype(np.uint8).transpose(1, 2, 0)


def render(path: Path, cache_root: Path) -> tuple[TifView, Path]:
    """Render (or reuse) the viewer layers for a GeoTIFF. Returns the view and the folder holding its files."""
    folder = cache_dir(path, cache_root)
    with _lock:
        if (folder / VIEW_FILE).is_file():
            return TifView.model_validate_json((folder / VIEW_FILE).read_text(encoding="utf-8")), folder
        folder.mkdir(parents=True, exist_ok=True)
        with rasterio.open(path) as ds:
            decimation = max(1, math.ceil(max(ds.width, ds.height) / MAX_RENDER))
            w, h = math.ceil(ds.width / decimation), math.ceil(ds.height / decimation)
            t = ds.transform @ Affine.scale(ds.width / w, ds.height / h)
            ux, uy = metres_per_unit(ds)
            elev_band = elevation_band(ds)
            bands = rgb_bands(ds, elev_band)

            rgb = None
            if bands:
                data = ds.read(bands, out_shape=(3, h, w), resampling=Resampling.average, masked=True)
                Image.fromarray(_to_rgb8(data, ds.dtypes[0])).save(folder / RGB_FILE, quality=85)
                rgb = RasterLayer(width=w, height=h)

            elevation = None
            if elev_band:
                z = ds.read(elev_band, out_shape=(h, w), resampling=Resampling.bilinear, masked=True)
                z = z.astype(np.float64).filled(np.nan)
                valid = np.isfinite(z)
                if valid.any():
                    lo = math.floor(float(z[valid].min()) * 1000) / 1000
                    hi = math.ceil(float(z[valid].max()) * 1000) / 1000
                    hi = hi if hi > lo else lo + 0.001
                    png = encode_height(np.where(valid, z, lo), lo, hi)
                    png[..., 3][~valid] = 0
                    write_png(folder / ELEVATION_FILE, png)
                    elevation = ElevationLayer(width=w, height=h, hMin=lo, hMax=hi)

            projected_m = ds.crs is not None and not ds.crs.is_geographic and abs(ux - 1) < 1e-9
            view = TifView(
                width=ds.width, height=ds.height, count=ds.count, dtypes=list(ds.dtypes),
                descriptions=list(ds.descriptions), crs=ds.crs.to_string() if ds.crs else None,
                geographic=bool(ds.crs and ds.crs.is_geographic), decimation=decimation,
                transform=[t.a, t.b, t.c, t.d, t.e, t.f], resX=abs(t.a) * ux, resZ=abs(t.e) * uy,
                rgb=rgb, elevation=elevation, bakeable=projected_m and elevation is not None,
            )
        (folder / VIEW_FILE).write_text(view.model_dump_json(), encoding="utf-8")
        return view, folder
