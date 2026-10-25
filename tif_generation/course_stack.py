#!/usr/bin/env python3
"""
Build ONE co-registered GeoTIFF for a golf course: NAIP imagery (R,G,B) + elevation (metres).

  pip install pystac-client planetary-computer rasterio pillow numpy shapely

  python course_stack.py --dem augusta_national_dem_1m.tif --out augusta

Inputs
  --dem   GeoTIFF of the course elevation (metres). Its extent defines the course bounds.
          (From the site: the decoded <Course>.mm terrain grid. Any DEM GeoTIFF works, e.g. a USGS 3DEP clip.)
  NAIP    searched on Microsoft Planetary Computer for that extent; newest year wins. US only.

Outputs (in --out)
  course_stack.tif   float32, 4 bands [red, green, blue, elevation_m]; NAIP's UTM CRS; pixel size = NAIP native (override --res)
  course_rgb.tif     the same imagery as 8-bit RGB (JPEG-compressed) for normal viewers
  preview.jpg        imagery | hillshade, for a quick sanity check
  sources.txt        NAIP item ids / dates / resolution used
"""
import argparse, math, os, sys
import numpy as np
import rasterio
from affine import Affine   # installed with rasterio
from rasterio.enums import Resampling
from rasterio.transform import from_origin
from rasterio.vrt import WarpedVRT
from rasterio.warp import reproject, transform_bounds
from PIL import Image


class Source:
    """One NAIP raster. Reads RGB warped onto an exact target grid (0 = no data)."""
    def __init__(self, href):
        self.ds = rasterio.open(href)
        self.res_m = min(abs(self.ds.res[0]), abs(self.ds.res[1]))   # NAIP is UTM -> metres

    def read(self, crs, transform, w, h):
        l, t = transform.c, transform.f
        r, b = l + w * transform.a, t + h * transform.e
        sl, sb, sr, st = transform_bounds(self.ds.crs, crs, *self.ds.bounds)
        if r <= sl or l >= sr or t <= sb or b >= st:
            return np.zeros((3, h, w), np.uint8)
        with WarpedVRT(self.ds, crs=crs, transform=transform, width=w, height=h,
                       resampling=Resampling.bilinear, src_nodata=0, nodata=0) as v:
            return v.read([1, 2, 3])


def composite(srcs, crs, transform, w, h):
    """First source wins; later ones only fill pixels still empty (handles NAIP quad seams)."""
    out = np.zeros((3, h, w), np.uint8)
    filled = np.zeros((h, w), bool)
    for s in srcs:
        d = s.read(crs, transform, w, h)
        valid = (d.max(axis=0) > 0) & ~filled
        out[:, valid] = d[:, valid]
        filled |= valid
        if filled.all():
            break
    return out, filled


def find_naip(bbox_lonlat):
    import pystac_client, planetary_computer
    from shapely.geometry import box, shape
    catalog = pystac_client.Client.open("https://planetarycomputer.microsoft.com/api/stac/v1",
                                        modifier=planetary_computer.sign_inplace)
    aoi = box(*bbox_lonlat)
    items = list(catalog.search(collections=["naip"], bbox=bbox_lonlat).items())
    if not items:
        print("No NAIP coverage for this extent (NAIP is contiguous-US only).")
        sys.exit(2)   # permanent: caller should not retry
    for it in sorted(items, key=lambda i: i.datetime, reverse=True):
        cov = shape(it.geometry).intersection(aoi).area / aoi.area
        print(f"  found {it.id}  {it.datetime.date()}  gsd={it.properties.get('gsd')}  covers {cov:.0%}")
    latest = max(i.datetime.year for i in items)
    chosen = sorted((i for i in items if i.datetime.year == latest), key=lambda i: i.id)
    cover = shape(chosen[0].geometry)
    for i in chosen[1:]:
        cover = cover.union(shape(i.geometry))
    frac = cover.intersection(aoi).area / aoi.area
    if frac < 0.999:
        print(f"WARNING: {latest} NAIP covers {frac:.1%} of the course; older years would be needed for the rest")
    return chosen


def inner_crop(mask, max_margin=300):
    """Smallest margin m such that mask[m:-m, m:-m] is fully valid (trims the sliver where a lat/lon grid
    is rotated relative to UTM)."""
    h, w = mask.shape
    for m in range(0, min(max_margin, h // 4, w // 4)):
        if mask[m:h - m, m:w - m].all():
            return m
    raise RuntimeError("elevation does not cover the target grid")


def hillshade(z, res):
    dy, dx = np.gradient(z, res)
    slope = np.pi / 2 - np.arctan(np.hypot(dx, dy))
    aspect = np.arctan2(-dx, dy)
    az, alt = math.radians(315), math.radians(45)
    hs = np.sin(alt) * np.sin(slope) + np.cos(alt) * np.cos(slope) * np.cos(az - aspect)
    return np.clip(hs, 0, 1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dem", required=True)
    ap.add_argument("--out", default="stack_out")
    ap.add_argument("--res", type=float, help="output pixel size in metres (default: NAIP native)")
    ap.add_argument("--local-tif", nargs="+", help="use these rasters instead of searching NAIP (testing)")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)

    dem = rasterio.open(a.dem)
    bbox_ll = transform_bounds(dem.crs, "EPSG:4326", *dem.bounds)

    if a.local_tif:
        hrefs, lines = a.local_tif, [f"local {p}" for p in a.local_tif]
    else:
        items = find_naip(bbox_ll)
        os.environ.setdefault("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")
        os.environ.setdefault("CPL_VSIL_CURL_ALLOWED_EXTENSIONS", ".tif")
        hrefs = [i.assets["image"].href for i in items]   # signed by the client modifier
        lines = [f"{i.id} {i.datetime.date()} gsd={i.properties.get('gsd')}" for i in items]
    open(os.path.join(a.out, "sources.txt"), "w").write("\n".join(lines) + "\n")

    srcs = [Source(h) for h in hrefs]
    crs = srcs[0].ds.crs
    res = a.res or srcs[0].res_m

    # Target grid: DEM extent in the NAIP CRS, snapped to the pixel size
    l, b, r, t = transform_bounds(dem.crs, crs, *dem.bounds)
    l, t = math.floor(l / res) * res, math.ceil(t / res) * res
    w, h = math.ceil((r - l) / res), math.ceil((t - b) / res)
    transform = from_origin(l, t, res, res)

    elev = np.full((h, w), np.nan, np.float32)
    reproject(rasterio.band(dem, 1), elev, dst_transform=transform, dst_crs=crs,
              dst_nodata=np.nan, resampling=Resampling.bilinear)
    m = inner_crop(~np.isnan(elev))
    if m:
        elev = elev[m:h - m, m:w - m]
        transform = transform * Affine.translation(m, m)
        h, w = elev.shape

    rgb, filled = composite(srcs, crs, transform, w, h)
    print(f"grid {w}x{h} px @ {res:.2f} m, CRS {crs.to_string()}, imagery coverage {filled.mean():.1%}, "
          f"elevation {np.nanmin(elev):.1f}..{np.nanmax(elev):.1f} m")

    prof = dict(driver="GTiff", height=h, width=w, crs=crs, transform=transform, tiled=True,
                blockxsize=256, blockysize=256)
    stack = np.concatenate([rgb.astype(np.float32), elev[None]])
    with rasterio.open(os.path.join(a.out, "course_stack.tif"), "w", count=4, dtype="float32",
                       nodata=np.nan, compress="deflate", predictor=3, **prof) as d:
        d.write(stack)
        for i, n in enumerate(["red", "green", "blue", "elevation_m"], 1):
            d.set_band_description(i, n)
        d.update_tags(imagery="NAIP via Microsoft Planetary Computer; RGB stored as float32 0-255, 0 = no imagery",
                      elevation="metres; resampled bilinear from the supplied DEM",
                      sources="; ".join(lines))
    with rasterio.open(os.path.join(a.out, "course_rgb.tif"), "w", count=3, dtype="uint8",
                       compress="jpeg", photometric="ycbcr", **prof) as d:
        d.write(rgb)

    hs = (hillshade(elev, res) * 255).astype(np.uint8)
    left = Image.fromarray(rgb.transpose(1, 2, 0))
    right = Image.fromarray(hs).convert("RGB")
    both = Image.new("RGB", (w * 2 + 10, h), (255, 255, 255))
    both.paste(left, (0, 0)); both.paste(right, (w + 10, 0))
    s = min(1.0, 2400 / both.width)
    both.resize((int(both.width * s), int(both.height * s))).save(os.path.join(a.out, "preview.jpg"), quality=88)
    print("wrote course_stack.tif, course_rgb.tif, preview.jpg, sources.txt in", a.out)


if __name__ == "__main__":
    main()
