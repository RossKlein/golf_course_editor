"""Pydantic models for every type in the course maker: the course.json schema and the server's API types."""
from __future__ import annotations

from pathlib import Path
from typing import Annotated

from pydantic import (
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    StrictInt,
    StringConstraints,
    computed_field,
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


class Hole(Model):
    number: Annotated[Int, Field(ge=1)]
    par: Annotated[Int, Field(ge=1)]
    route: Annotated[list[tuple[Number, Number]], Field(min_length=2)]


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


# --- API types ---------------------------------------------------------------


class BakeSource(Model):
    """Compiler-only sidecar (`<bundle>.source.json`): which stack a bundle was baked from."""

    stack: str  # relative to the sidecar's folder


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
    bakeable: bool  # projected, metres, has elevation


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
    overwrite: bool = False


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
