"""Pydantic models for every type in the course maker: the course.json schema and the server's API types."""
from __future__ import annotations

from pathlib import Path
from typing import Annotated, Literal

from pydantic import (
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    StrictInt,
    StringConstraints,
    computed_field,
    field_validator,
    model_validator,
)

from . import spec


def _number(v):
    if isinstance(v, (bool, str)):  # pydantic would coerce these to a float
        raise ValueError("expected a number")
    return v


Number = Annotated[float, BeforeValidator(_number), Field(allow_inf_nan=False)]
Name = Annotated[str, StringConstraints(strict=True, pattern=r"\S")]  # non-blank
Int = StrictInt  # no floats, no booleans


class Model(BaseModel):
    # Responses always include defaulted fields, so the generated TypeScript types mark them as present.
    model_config = ConfigDict(extra="forbid", populate_by_name=True, json_schema_serialization_defaults_required=True)


# --- course.json -------------------------------------------------------------


class Grid(Model):
    file: Name
    cols: Annotated[Int, Field(ge=1)]
    rows: Annotated[Int, Field(ge=1)]
    res: Annotated[Number, Field(gt=0)]


class Patch(Model):
    file: Name
    x0: Int
    z0: Int
    cellsX: Annotated[Int, Field(ge=1)]
    cellsZ: Annotated[Int, Field(ge=1)]

    @property
    def cols(self) -> int:
        return self.cellsX * spec.PATCH_REFINE + 1

    @property
    def rows(self) -> int:
        return self.cellsZ * spec.PATCH_REFINE + 1

    @model_validator(mode="after")
    def _within_limits(self) -> "Patch":
        if self.cols > spec.PATCH_MAX_SAMPLES or self.rows > spec.PATCH_MAX_SAMPLES:
            raise ValueError(f"more than {spec.PATCH_MAX_SAMPLES} samples on a side")
        return self


class TreesRef(Model):
    file: Name
    count: Annotated[Int, Field(ge=0)]


class Landmark(Model):
    name: Name
    kind: Name
    x: Number
    z: Number
    rotation: Number = 0.0
    scale: Annotated[Number, Field(gt=0)] = 1.0
    y: Number | None = None
    # metres around it where the editor's build plants no forest trees. The game ignores it. Unset is a few metres times the scale
    clearance: Annotated[Number, Field(gt=0, le=200)] | None = None


class Hole(Model):
    number: Annotated[Int, Field(ge=1)]
    par: Annotated[Int, Field(ge=1)]
    route: Annotated[list[tuple[Number, Number]], Field(min_length=2)]


# --- the look: how the course is drawn --------------------------------------------
# Everything an artist would change about how the course looks lives here, in course.json, so the editor's view and the
# game draw the same thing and no colour or size is a literal in a shader. Defaults are in look_defaults.py.

Unit = Annotated[Number, Field(ge=0, le=1)]
Color = tuple[Unit, Unit, Unit]  # red, green, blue, each 0 to 1


class Sun(Model):
    """Where the sun is: a place, a time of year and a time of day."""

    latitude: Annotated[Number, Field(ge=-90, le=90)]
    declination: Annotated[Number, Field(ge=-23.5, le=23.5)]  # the sun's latitude: 23.44 at the June solstice
    hourAngle: Annotated[Number, Field(ge=-180, le=180)]  # 15 degrees an hour from solar noon, negative in the morning


class Surface(Model):
    """How one surface class is coloured, and what grows on it. The look has one for each class, in class order."""

    color: Color
    color2: Color | None = None  # the other mowing stripe's colour; with no stripes, unused
    stripe: Annotated[Number, Field(ge=0, le=100)] = 0.0  # metres across one mowing stripe; 0 for none
    grain: Unit  # how much of the grass texture shows through the colour
    shade: Annotated[Number, Field(ge=0, le=2)] = 1.0  # how much the relief shading applies; 1 as for grass
    speckleDark: Unit = 0.0  # salt and pepper: how much a dark grain darkens
    specklePale: Unit = 0.0  # and how much a pale one lightens
    earth: Color | None = None  # a second colour the surface is flecked with (the forest floor's soil)
    mottle: Annotated[Number, Field(ge=0, le=10)] = 0.0  # how much of the surface is earth, in crisp specks, not a blend: 1 - exp(-0.4 * mottle), about half at 1.6; 0 for none
    tuft: Annotated[Number, Field(ge=0, le=4)] = 0.0  # height of standing grass as a multiple of tufts.height; 0 for none
    # how many of the clumps the renderer would grow here do grow (0 to 1; the viewer's or the game's own grass level sets how many that is
    # to start with), and how much they gather into patches with bare ground between (0 for an even spread, 1 for tussocks). A look written
    # before these gets the default of its surface
    tuftDensity: Annotated[Number, Field(ge=0, le=1)] = 1.0
    tuftClump: Annotated[Number, Field(ge=0, le=1)] = 0.0
    # normal-map detail on the surface: how steep it is (a root-mean-square slope, 0.3 about 17 degrees; 0 for none), and where it
    # comes from: the grass tile's own light and dark (blades and clumps) or noise (grains, for sand and paths)
    bump: Annotated[Number, Field(ge=0, le=3)] = 0.0
    bumpMap: Literal["grass", "grain"] = "grass"
    # how tall the grass is, in metres (a green 3 mm, a fairway 15 mm, rough 6 cm): where two surfaces meet, the ground steps from one
    # height to the other, and the sun lights the step. A look written before this gets the default height of its surface
    height: Annotated[Number, Field(ge=0, le=0.5)] = 0.0


class Grass(Model):
    tile: Name  # the seamless grass texture the ground is tiled with, by file name
    tileMetres: Annotated[Number, Field(gt=0, le=100)]  # ground one tile covers
    wobble: Annotated[Number, Field(ge=0, le=4)]  # how far surface edges are wobbled by the texture, in class cells
    speckleGrain: Annotated[Number, Field(gt=0, le=1)]  # metres across one grain of speckle
    # metres either side of a surface edge that are averaged to draw it as a smooth curve: more gives bigger, rounder curves and
    # loses thin features; 1 is the least the renderer can do. A look written before this gets the default
    smoothing: Annotated[Number, Field(ge=1, le=3)] = Field(default_factory=lambda: _default_look().grass.smoothing)
    # where two surfaces of different heights meet: the metres across the wall of the step, on the taller surface's side of the line, how far in metres the grass texture pushes
    # the line about so it is not a perfect curve, and how much the shorter grass at the foot of the taller is darkened (0 to 1)
    edgeWidth: Annotated[Number, Field(gt=0, le=0.5)] = Field(default_factory=lambda: _default_look().grass.edgeWidth)
    edgeRagged: Annotated[Number, Field(ge=0, le=0.3)] = Field(default_factory=lambda: _default_look().grass.edgeRagged)
    edgeShadow: Annotated[Number, Field(ge=0, le=1)] = Field(default_factory=lambda: _default_look().grass.edgeShadow)
    # how much taller the grass looks at a step than it is (1 is true), so small differences show: it scales the difference between two
    # surfaces' heights when the step is lit and shaded, and the surfaces' own heights are not changed. The foot's shade falls on the
    # side away from the sun
    edgeGain: Annotated[Number, Field(ge=1, le=10)] = Field(default_factory=lambda: _default_look().grass.edgeGain)


class ReliefLook(Model):
    """How the ground's slope is worked out for lighting."""

    # metres either side of a point over which the heights are averaged by a cubic B-spline before the slope is taken: more
    # gives smoother, broader shading and ignores smaller bumps. The height grid is 1 m, so 2 is the least that makes sense
    smoothing: Annotated[Number, Field(ge=1, le=6)]
    # how much steeper the slope looks in the shading than it is (1 is true), so gentle ground shows; the ground itself keeps its shape
    exaggeration: Annotated[Number, Field(ge=1, le=20)] = Field(default_factory=lambda: _default_look().relief.exaggeration)
    # how strongly the slope shades the sun's light: 0 is flat light, 1 as lit, more is harsher (the sky's light is not shaded)
    shading: Annotated[Number, Field(ge=0, le=3)] = Field(default_factory=lambda: _default_look().relief.shading)


class Tufts(Model):
    """The standing grass in the rough: clumps of blades, each blade a thin tapered strip that leans out from the middle of its clump."""

    height: Annotated[Number, Field(gt=0, le=5)]  # metres, the tallest blade of a clump on a surface with tuft = 1
    # how wide a clump is across, in metres, and how thick the blades are at their base. A clump is its own size whatever its height, so a
    # tall clump is not a fat one. A look written before these gets the default
    spread: Annotated[Number, Field(gt=0, le=2)] = Field(default_factory=lambda: _default_look().tufts.spread)
    bladeWidth: Annotated[Number, Field(gt=0, le=0.1)] = Field(default_factory=lambda: _default_look().tufts.bladeWidth)
    # blades in a clump seen close up; further off a clump is drawn with fewer, wider blades, so the number is what the best view costs
    blades: Annotated[Int, Field(ge=3, le=64)] = Field(default_factory=lambda: _default_look().tufts.blades)
    root: Color
    tip: Color

    @model_validator(mode="before")
    @classmethod
    def _drop_the_old_width(cls, data):
        # tufts used to be flat cards with a width that was a multiple of their height; a look that still has it is read and the width let go
        if isinstance(data, dict) and "width" in data:
            data = {k: v for k, v in data.items() if k != "width"}
        return data


class Frustum(Model):
    """A cone or a frustum, for a tree: `sides` faces from a ring at y0 to a ring at y1. Heights are fractions of the tree's."""

    shape: Literal["frustum"] = "frustum"
    y0: Number
    r0: Annotated[Number, Field(ge=0)]
    y1: Number
    r1: Annotated[Number, Field(ge=0)]
    sides: Annotated[Int, Field(ge=3, le=16)]
    color: Color
    shade: Unit = 0.12  # how much alternate faces are darkened


class Blob(Model):
    """A faceted ball, for a tree's crown, squashed to radii (rx, ry, rz) about (cx, cy, cz)."""

    shape: Literal["blob"] = "blob"
    cx: Number
    cy: Number
    cz: Number
    rx: Annotated[Number, Field(gt=0)]
    ry: Annotated[Number, Field(gt=0)]
    rz: Annotated[Number, Field(gt=0)]
    color: Color
    sides: Annotated[Int, Field(ge=3, le=16)] = 7
    rings: Annotated[Int, Field(ge=2, le=8)] = 3


class TreeKind(Model):
    """One tree model, 1 unit tall standing on the ground; trees.bin's kind picks which, wrapping past the last."""

    name: Name
    height: tuple[Annotated[Number, Field(gt=0)], Annotated[Number, Field(gt=0)]]  # a typical tree's height range in metres, for scattering trees where there is no data
    parts: Annotated[list[Annotated[Frustum | Blob, Field(discriminator="shape")]], Field(min_length=1, max_length=16)]


class Trees(Model):
    kinds: Annotated[list[TreeKind], Field(min_length=1, max_length=8)]
    ambient: Unit  # light a tree takes from every side
    direct: Annotated[Number, Field(ge=0, le=2)]  # and from the sun, on faces turned towards it
    base: Unit  # brightness at the foot of a tree, rising to full at the top

    @field_validator("kinds")
    @classmethod
    def _unique_names(cls, kinds: list[TreeKind]) -> list[TreeKind]:
        # forest settings weight a kind by its name, so two kinds with one name would be one weight for both
        names = [k.name for k in kinds]
        dupes = sorted({n for n in names if names.count(n) > 1})
        if dupes:
            raise ValueError(f"tree kinds must have different names; repeated: {', '.join(dupes)}")
        return kinds


class Shadows(Model):
    """How the sun's shadows look. How crisp they are (map size, slices) is a quality setting of the viewer, not the course's."""

    strength: Unit  # how much a shadow darkens lit ground: 0 for none, 1 for the full tint
    tint: Color  # what shadowed ground is multiplied by, cooler than lit ground
    softness: Annotated[Number, Field(ge=0, le=5)]  # metres across the soft edge of a shadow
    distance: Annotated[Number, Field(gt=0, le=2000)]  # metres from the camera where shadows have faded out


class LakeSettings(Model):
    anchor: tuple[Number, Number]
    level: Number | None = None
    offset: Annotated[Number, Field(ge=-50, le=50)] = 0
    curvature: Unit = 0
    excess: Annotated[Number, Field(ge=0, le=30)] = 0  # metres past the painted outline that the water may spread, where the ground is lower than it


class WaterLook(Model):
    bedColor: Color = (0.30, 0.21, 0.12)
    tint: Color = (0.025, 0.10, 0.12)  # the water where it is deep
    shallow: Color = (0.10, 0.36, 0.36)  # and where it is shallow, which is also where it is clearer
    clarity: Annotated[Number, Field(gt=0, le=20)] = 1.0  # metres of depth in which the water goes from the shallow colour and clear to the tint and dark
    ripples: Annotated[Number, Field(ge=0, le=0.05)] = 0.008
    lakes: dict[str, LakeSettings] = Field(default_factory=dict)


class Look(Model):
    water: WaterLook = Field(default_factory=WaterLook)
    sky: Color
    sun: Sun
    # one for each surface class, by its name: rough, fairway, green, collar, tee, bunker, water, path, woods
    surfaces: dict[str, Surface]
    grass: Grass
    tufts: Tufts
    trees: Trees
    shadows: Shadows = Field(default_factory=lambda: _default_look().shadows)  # a look written before shadows existed gets the default
    relief: ReliefLook = Field(default_factory=lambda: _default_look().relief)  # likewise for the relief

    @field_validator("surfaces")
    @classmethod
    def _one_for_each_class(cls, surfaces: dict[str, Surface]) -> dict[str, Surface]:
        missing = [n for n in spec.CLASSES if n not in surfaces]
        unknown = [n for n in surfaces if n not in spec.CLASSES]
        if missing or unknown:
            raise ValueError(f"surfaces must be one for each class ({', '.join(spec.CLASSES)}); missing: {missing or 'none'}, not a class: {unknown or 'none'}")
        # a surface written before it had these has its class's default, so older courses get edges and forest floors like new ones
        out = {}
        for name in spec.CLASSES:
            s = surfaces[name]
            # the defaults themselves give every surface all of them, so this never asks for them while they are being made
            missing_fields = [f for f in ("height", "tuftDensity", "tuftClump") if f not in s.model_fields_set]
            if missing_fields:
                fallback = _default_look().surfaces[name]
                s = s.model_copy(update={f: getattr(fallback, f) for f in missing_fields})
            out[name] = s
        return out  # in class order, however it was written


def _default_look() -> "Look":
    from .look_defaults import default_look  # it builds Looks, so it cannot be imported until this module is done

    return default_look()


class Course(Model):
    name: Name
    attribution: Name
    crs: Name
    originEasting: Number
    originNorthing: Number
    hMin: Number
    hMax: Number
    height: Grid
    class_: Grid = Field(alias="class")
    bounds: Grid
    patches: list[Patch] = []
    trees: TreesRef
    landmarks: list[Landmark] = []
    holes: list[Hole]
    # course: numbered holes, each with its own tee and one green. range: one tee, any number of separate greens and fairways, no holes.
    kind: Literal["course", "range"] = "course"
    look: Look = Field(default_factory=_default_look)
    waterMesh: str | None = None

    @property
    def extent(self) -> tuple[float, float]:
        """Course size in metres: (x east-west, z north-south)."""
        return ((self.height.cols - 1) * self.height.res, (self.height.rows - 1) * self.height.res)

    @model_validator(mode="after")
    def _consistent(self) -> "Course":
        """Everything checkable without reading the image files."""
        bad: list[str] = []
        if not self.hMax > self.hMin:
            bad.append("hMax must be greater than hMin")
        for name, grid, res in (("height", self.height, spec.HEIGHT_RES), ("class", self.class_, spec.CLASS_RES),
                                ("bounds", self.bounds, spec.BOUNDS_RES)):
            if grid.res != res:
                bad.append(f"{name}.res must be {res}")
        if self.height.cols < 2 or self.height.rows < 2:
            bad.append("height grid needs at least 2x2 samples")
        else:
            # class and bounds cells cover exactly the macro extent
            w, h = self.height.cols - 1, self.height.rows - 1
            for name, grid, res in (("class", self.class_, spec.CLASS_RES), ("bounds", self.bounds, spec.BOUNDS_RES)):
                want = (round(w / res), round(h / res))
                if (grid.cols, grid.rows) != want:
                    bad.append(f"{name} grid must be {want[0]}x{want[1]} to cover the macro extent")

        ex, ez = self.extent
        inside = lambda x, z: 0 <= x <= ex and 0 <= z <= ez  # noqa: E731
        if [h.number for h in self.holes] != list(range(1, len(self.holes) + 1)):
            bad.append("hole numbers must be 1-based and contiguous, in order")
        if self.kind == "range" and self.holes:
            bad.append("a range has no holes")
        if len(self.holes) > spec.MAX_HOLES:
            bad.append(f"at most {spec.MAX_HOLES} holes are supported")
        for h in self.holes:
            if not all(inside(x, z) for x, z in h.route):
                bad.append(f"hole {h.number}: route leaves the course")
        for m in self.landmarks:
            if not inside(m.x, m.z):
                bad.append(f"landmark {m.name!r}: outside the course")

        if len(self.patches) > spec.MAX_PATCHES:
            bad.append(f"at most {spec.MAX_PATCHES} patches are supported")
        for i, p in enumerate(self.patches):
            if p.x0 < 0 or p.z0 < 0 or p.x0 + p.cellsX > ex or p.z0 + p.cellsZ > ez:
                bad.append(f"patch {i} ({p.file}): outside the macro grid")
            for j in range(i + 1, len(self.patches)):
                q = self.patches[j]
                if p.x0 < q.x0 + q.cellsX and q.x0 < p.x0 + p.cellsX and p.z0 < q.z0 + q.cellsZ and q.z0 < p.z0 + p.cellsZ:
                    bad.append(f"patches {i} and {j} overlap")
        if bad:
            raise ValueError("\n".join(bad))
        return self

    @classmethod
    def read(cls, path) -> "Course":
        return cls.model_validate_json(Path(path).read_text(encoding="utf-8"))

    def write(self, path) -> None:
        text = self.model_dump_json(by_alias=True, exclude_none=True, indent=2)
        Path(path).write_text(text + "\n", encoding="utf-8")


# --- .course_maker/ project files (never part of the game bundle) ---------------


class BakeSettings(Model):
    """What the last bake used, so a re-bake reproduces it."""

    name: Name
    attribution: Name
    edgeMargin: Annotated[Number, Field(ge=0)]


class ProjectFile(Model):
    """`.course_maker/project.json`: durable settings that reproduce the bundle. Worth versioning."""

    stack: Name  # the source course_stack.tif, relative to the bundle folder, with forward slashes
    bake: BakeSettings


class Viewport(Model):
    """The map view: centre in course metres, and pixels per metre. Independent of the window size."""

    x: Number
    z: Number
    scale: Annotated[Number, Field(gt=0, le=10_000)]


class LayerPref(Model):
    visible: bool
    opacity: Annotated[Number, Field(ge=0, le=1)]


class Viewer(Model):
    """The 3D view's own settings: what it draws and how far. The viewer's, not the course's look (that is in course.json)."""

    aerial: bool = True  # the aerial photo under the ground, when the game's look is off
    game: bool = True  # the ground in the game's look
    tufts: bool = True  # standing grass ("Rough grass")
    grassRange: Annotated[Number, Field(ge=1, le=1000)] = 200.0  # metres from where it looks that grass grows
    grassDensity: Annotated[Number, Field(ge=0.01, le=100)] = 1.0  # clumps to the square metre, as a multiple of the default
    trees: bool = True
    water: bool = True  # the lakes' water surfaces (off shows the lake bed)
    surfaces: Annotated[Number, Field(ge=0, le=1)] = 0.0  # how strongly the design's surfaces are painted on the ground
    outlines: bool = True  # the design's outlines on the ground
    scale: Annotated[Number, Field(ge=1, le=20)] = 1.0  # vertical exaggeration of the shape of the ground
    shading: Annotated[Number, Field(ge=0, le=3)] = 1.0  # slope shading, for a course with no look to take it from
    shadows: Literal["off", "low", "high"] = "low"
    leanStrokes: bool = True  # while a brush stroke goes, draw only the ground


class EditorState(Model):
    """`.course_maker/editor.json`: UI state, per user. Safe to delete; never needed to rebuild a bundle."""

    version: Literal[1] = 1
    viewport: Viewport | None = None  # None means "fit the course"
    layers: Annotated[dict[Annotated[str, Field(max_length=64)], LayerPref], Field(max_length=64)] = {}
    exaggeration: Annotated[Number, Field(ge=1, le=20)] = 3.0
    contourInterval: Annotated[Number, Field(ge=0, le=100)] = 0.0  # metres between contour lines on the terrain; 0 for none
    slopeMap: bool = False  # colour the terrain by slope
    hole: Annotated[Int, Field(ge=1, le=spec.MAX_HOLES)] = 1  # the active hole: shown on the out-of-bounds layer, given to new regions
    editor: Annotated[str, Field(max_length=32)] = "view"  # which editor is open
    tool: Annotated[str, Field(max_length=32)] = "select"
    activeClass: Annotated[Int, Field(ge=0, le=max(spec.CLASSES.values()))] = spec.FAIRWAY  # the surface new regions get
    snap: bool = True
    overlayOpacity: Annotated[Number, Field(ge=0, le=1)] = 1.0  # how strongly the editors' polygons are drawn over the map
    hideOthers: bool = False  # Course editor: show only the active hole's outlines and route
    boundsFeatures: Literal["off", "hole", "course"] = "hole"  # Out-of-bounds editor: which course features to show under the bounds
    boundsAllHoles: bool = False  # Out-of-bounds editor: also show the other holes' routes
    boundsAllBounds: bool = False  # Out-of-bounds editor: also show the other holes' bounds
    brushRadius: Annotated[Number, Field(ge=1, le=120)] = 10.0  # Heightmap editor: brush radius in metres
    brushStrength: Annotated[Number, Field(ge=0.02, le=1)] = 0.3
    brushHardness: Annotated[Number, Field(ge=0, le=1)] = 0.5
    cloneRelative: bool = True  # Heightmap editor, clone brush: copy the source's shape onto the ground where the stroke starts, not its exact heights
    smoothing: Annotated[Number, Field(ge=0, le=10)] = 0.1  # freehand simplify tolerance in screen pixels; 0 keeps every point
    pathWidth: Annotated[Number, Field(ge=0.5, le=16)] = 2.5  # Course editor, Path tool: how wide the path is made, in metres
    collarThickness: Annotated[Number, Field(ge=0.3, le=5)] = 1.5  # Course editor: how thick a collar made round a green is, in metres
    leftCollapsed: bool = False
    rightTab: Literal["view", "data"] = "view"
    view3d: bool = False  # the 3D view was open
    viewer: Viewer | None = None  # the 3D view's settings; None until they are first saved, so the view starts as its terrain suits
    lookTab: Annotated[str, Field(max_length=32)] = "sky"  # the Look editor's open tab


class HeightBase(Model):
    """The pristine baked heights (`GET /api/bundle/design/height/base.png`) are encoded against this range."""

    hMin: Number
    hMax: Number


class EditorResponse(Model):
    state: EditorState
    status: Literal["default", "loaded", "reset"]  # no file yet / read from disk / unreadable, replaced by defaults


# --- API types ---------------------------------------------------------------


class TifEntry(Model):
    path: str  # relative to the data folder, with forward slashes
    size: int
    modified: float


class BundleEntry(Model):
    path: str
    name: str


class Index(Model):
    root: str
    tifs: list[TifEntry]
    bundles: list[BundleEntry]


class RasterLayer(Model):
    width: int
    height: int


class ElevationLayer(RasterLayer):
    """16-bit heights in R/G of a PNG, as in the bundle format; A = 0 marks no data."""

    hMin: float
    hMax: float


class TifView(Model):
    """A GeoTIFF rendered for the viewer. Rendered pixels may be decimated from the source."""

    path: str = ""
    width: int  # source pixels
    height: int
    count: int
    dtypes: list[str]
    descriptions: list[str | None]
    crs: str | None
    geographic: bool
    decimation: int
    transform: list[float]  # affine a, b, c, d, e, f of the rendered grid, in CRS units
    resX: float  # metres per rendered pixel
    resZ: float
    rgb: RasterLayer | None
    elevation: ElevationLayer | None
    bakeable: bool  # projected (metres or feet), has elevation


class AerialMeta(Model):
    """Where a bundle's aerial image sits in course metres (x east, z south) and its pixel size."""

    stack: str  # data-relative path of the stack; its image is /api/tif/rgb.jpg?path=<stack>
    x0: float
    z0: float
    res: float
    width: int
    height: int


class BakeRequest(Model):
    stack: str  # data-relative
    out: str  # data-relative bundle folder
    name: Name
    attribution: Name = "Elevation: USGS 3DEP. Imagery: NAIP."
    replace: bool = False  # build a new bundle beside the old one, carry over .course_maker/, then swap


class BakeResult(Model):
    bundle: str
    report: "Report"


class Report(Model):
    """The result of validating a bundle."""

    errors: list[str] = []
    warnings: list[str] = []
    sizes: dict[str, int] = {}

    @computed_field
    @property
    def ok(self) -> bool:
        return not self.errors

    @computed_field
    @property
    def total_bytes(self) -> int:
        return sum(self.sizes.values())

    def error(self, msg: str) -> None:
        self.errors.append(msg)

    def warn(self, msg: str) -> None:
        self.warnings.append(msg)


BakeResult.model_rebuild()
