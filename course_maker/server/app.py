"""The course maker server: indexes a data folder, renders GeoTIFFs, serves bundles, uploads TIFs and bakes.

Every path in the API is relative to the data folder (forward slashes). Nothing outside it is read or written.
"""
from __future__ import annotations

import os
import shutil
import tempfile
from pathlib import Path

import rasterio
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import ValidationError
from rasterio.errors import RasterioError

from ..compiler.bake import bake, read_source
from ..compiler.validate import validate_bundle
from ..models import AerialMeta, BakeRequest, BakeResult, BundleEntry, Course, Index, Report, TifEntry, TifView
from . import rasters
from .aerial import aerial_meta, relative_to

WEB_DIST = Path(__file__).resolve().parents[2] / "web" / "dist"
TIF_SUFFIXES = (".tif", ".tiff")
BUNDLE_FILE_SUFFIXES = (".json", ".png", ".bin")
SKIP_DIRS = {".venv", "venv", "__pycache__", "node_modules"}
UPLOAD_DIR = "uploads"


def scan(root: Path) -> Index:
    tifs, bundles = [], []
    for folder, dirs, files in os.walk(root):
        dirs[:] = sorted(d for d in dirs if not d.startswith(".") and d not in SKIP_DIRS)
        here = Path(folder)
        for name in sorted(files):
            path = here / name
            if name.lower().endswith(TIF_SUFFIXES):
                st = path.stat()
                tifs.append(TifEntry(path=path.relative_to(root).as_posix(), size=st.st_size, modified=st.st_mtime))
            elif name == "course.json":
                try:
                    title = Course.read(path).name
                except (ValidationError, OSError):
                    title = f"{here.name} (invalid course.json)"
                bundles.append(BundleEntry(path=here.relative_to(root).as_posix(), name=title))
    return Index(root=str(root), tifs=tifs, bundles=bundles)


def create_app(data_dir, cache_dir=None) -> FastAPI:
    root = Path(data_dir).resolve()
    cache = Path(cache_dir).resolve() if cache_dir else root / ".course_maker_cache"
    app = FastAPI(title="Course Maker")

    @app.middleware("http")
    async def no_store(request: Request, call_next):
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"  # a dev tool: always show the latest files
        return response

    def inside(rel: str) -> Path:
        path = (root / rel).resolve()
        if path != root and root not in path.parents:
            raise HTTPException(404, "not found")
        return path

    def tif(rel: str) -> Path:
        path = inside(rel)
        if not path.is_file() or not path.name.lower().endswith(TIF_SUFFIXES):
            raise HTTPException(404, f"no GeoTIFF at {rel}")
        return path

    def bundle(rel: str) -> Path:
        path = inside(rel)
        if not (path / "course.json").is_file():
            raise HTTPException(404, f"no bundle at {rel}")
        return path

    def rendered(path: Path) -> tuple[TifView, Path]:
        try:
            return rasters.render(path, cache)
        except (RasterioError, ValueError) as exc:
            raise HTTPException(422, f"cannot read {path.name}: {exc}") from exc

    # --- index and GeoTIFFs ---

    @app.get("/api/index")
    def index() -> Index:
        return scan(root)

    @app.get("/api/tif")
    def tif_view(path: str = Query()) -> TifView:
        view, _ = rendered(tif(path))
        return view.model_copy(update={"path": path})

    @app.get("/api/tif/rgb.jpg")
    def tif_rgb(path: str = Query()):
        view, folder = rendered(tif(path))
        if view.rgb is None:
            raise HTTPException(404, "this GeoTIFF has no RGB bands")
        return FileResponse(folder / rasters.RGB_FILE, media_type="image/jpeg")

    @app.get("/api/tif/elevation.png")
    def tif_elevation(path: str = Query()):
        view, folder = rendered(tif(path))
        if view.elevation is None:
            raise HTTPException(404, "this GeoTIFF has no elevation band")
        return FileResponse(folder / rasters.ELEVATION_FILE, media_type="image/png")

    @app.put("/api/tifs/upload")
    async def upload(request: Request, name: str = Query()) -> TifEntry:
        """Store the raw request body as uploads/<name>. The name must be a plain .tif/.tiff file name."""
        if Path(name).name != name or not name.lower().endswith(TIF_SUFFIXES) or name.startswith("."):
            raise HTTPException(400, "name must be a plain file name ending in .tif or .tiff")
        target = root / UPLOAD_DIR / name
        if target.exists():
            raise HTTPException(409, f"{UPLOAD_DIR}/{name} already exists")
        target.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=target.parent, suffix=".part")
        try:
            with os.fdopen(fd, "wb") as out:
                async for chunk in request.stream():
                    out.write(chunk)
            try:
                with rasterio.open(tmp):
                    pass
            except RasterioError as exc:
                raise HTTPException(400, f"not a readable GeoTIFF: {exc}") from exc
            os.replace(tmp, target)
        finally:
            if os.path.exists(tmp):
                os.remove(tmp)
        st = target.stat()
        return TifEntry(path=target.relative_to(root).as_posix(), size=st.st_size, modified=st.st_mtime)

    # --- bundles ---

    @app.get("/api/bundle", response_model=Course, response_model_by_alias=True, response_model_exclude_none=True)
    def bundle_course(path: str = Query()):
        try:
            return Course.read(bundle(path) / "course.json")
        except ValidationError as exc:
            raise HTTPException(422, "course.json is invalid; see /api/bundle/validate") from exc

    @app.get("/api/bundle/validate")
    def bundle_validate(path: str = Query()) -> Report:
        return validate_bundle(bundle(path))

    @app.get("/api/bundle/aerial")
    def bundle_aerial(path: str = Query()) -> AerialMeta:
        folder = bundle(path)
        stack = read_source(folder)
        stack_rel = relative_to(root, stack) if stack else None
        if stack_rel is None:
            raise HTTPException(404, "the bundle's source stack is not recorded or not in the data folder")
        view, _ = rendered(stack)
        try:
            return aerial_meta(stack_rel, view, Course.read(folder / "course.json"))
        except (ValueError, ValidationError) as exc:
            raise HTTPException(422, str(exc)) from exc

    @app.get("/files/{rel:path}")
    def bundle_file(rel: str):
        """A file of a bundle (course.json, PNGs, trees.bin), exactly as the game will download it."""
        path = inside(rel)
        if not path.is_file() or path.suffix.lower() not in BUNDLE_FILE_SUFFIXES:
            raise HTTPException(404, "not found")
        if not any((p / "course.json").is_file() for p in path.parents if p == root or root in p.parents):
            raise HTTPException(404, "not a bundle file")
        return FileResponse(path)

    @app.post("/api/bake")
    def bake_bundle(req: BakeRequest) -> BakeResult:
        stack = tif(req.stack)
        out = inside(req.out)
        if out == root:
            raise HTTPException(400, "choose a folder for the bundle, not the data folder itself")
        if out.exists() and any(out.iterdir()) and not req.overwrite:
            raise HTTPException(409, f"{req.out} already exists; set overwrite to replace it")
        if out.exists() and req.overwrite:
            if not (out / "course.json").is_file():
                raise HTTPException(409, f"{req.out} is not a bundle; refusing to replace it")
            shutil.rmtree(out)
        try:
            bake(stack, out, req.name, req.attribution)
        except (ValueError, RasterioError) as exc:
            raise HTTPException(422, str(exc)) from exc
        return BakeResult(bundle=out.relative_to(root).as_posix(), report=validate_bundle(out))

    # --- the React app (web/dist, built with `npm run build`; during development Vite serves it instead) ---

    @app.get("/", include_in_schema=False)
    def page():
        if not (WEB_DIST / "index.html").is_file():
            return HTMLResponse(NOT_BUILT, status_code=503)
        return FileResponse(WEB_DIST / "index.html")

    if (WEB_DIST / "assets").is_dir():
        app.mount("/assets", StaticFiles(directory=WEB_DIST / "assets"), name="assets")
    return app


NOT_BUILT = """<!doctype html><title>Course Maker</title><body style="font:16px system-ui;padding:2em">
<h1>The web app is not built</h1><p>Run <code>npm install</code> and <code>npm run build</code> in <code>web/</code>,
or develop with <code>npm run dev</code> there and open <a href="http://127.0.0.1:5173">http://127.0.0.1:5173</a>.</p>"""
