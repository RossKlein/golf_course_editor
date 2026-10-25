"""course.json schema and format constants (docs/golf-course-format.md)."""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any

# --- Constants from the spec -------------------------------------------------

HEIGHT_RES = 1.0
CLASS_RES = 0.5
BOUNDS_RES = 1.0
PATCH_RES = 0.25
PATCH_REFINE = 4  # patch samples per macro cell, per axis
PATCH_MAX_SAMPLES = 1024
MAX_PATCHES = 64
PATCH_BORDER_TOL_M = 0.002
TREE_RECORD_BYTES = 12
MAX_HOLES = 24
BUNDLE_BUDGET_BYTES = 8_000_000

CLASSES = {
    "rough": 0,
    "fairway": 1,
    "green": 2,
    "collar": 3,
    "tee": 4,
    "bunker": 5,
    "water": 6,
    "path": 7,
    "woods": 8,
}
ROUGH, FAIRWAY, GREEN, COLLAR, TEE = 0, 1, 2, 3, 4
OWNED_CLASSES = (FAIRWAY, GREEN, TEE)

DEFAULT_FILES = {
    "height": "height.png",
    "class": "class.png",
    "bounds": "bounds.png",
    "trees": "trees.bin",
}


class SchemaError(ValueError):
    """course.json does not match the schema."""


# --- Field helpers -----------------------------------------------------------


def _num(v: Any, where: str) -> float:
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
        raise SchemaError(f"{where}: expected a finite number, got {v!r}")
    return float(v)


def _int(v: Any, where: str) -> int:
    if isinstance(v, bool) or not isinstance(v, int):
        raise SchemaError(f"{where}: expected an integer, got {v!r}")
    return v


def _str(v: Any, where: str) -> str:
    if not isinstance(v, str) or not v.strip():
        raise SchemaError(f"{where}: expected a non-empty string, got {v!r}")
    return v


def _obj(v: Any, where: str, required: tuple[str, ...], optional: tuple[str, ...] = ()) -> dict:
    if not isinstance(v, dict):
        raise SchemaError(f"{where}: expected an object")
    missing = [k for k in required if k not in v]
    extra = [k for k in v if k not in required and k not in optional]
    if missing:
        raise SchemaError(f"{where}: missing {', '.join(missing)}")
    if extra:
        raise SchemaError(f"{where}: unknown {', '.join(extra)}")
    return v


def _list(v: Any, where: str) -> list:
    if not isinstance(v, list):
        raise SchemaError(f"{where}: expected a list")
    return v


# --- Records -----------------------------------------------------------------


@dataclass
class Grid:
    file: str
    cols: int
    rows: int
    res: float

    @classmethod
    def parse(cls, v: Any, where: str) -> "Grid":
        v = _obj(v, where, ("file", "cols", "rows", "res"))
        return cls(_str(v["file"], f"{where}.file"), _int(v["cols"], f"{where}.cols"),
                   _int(v["rows"], f"{where}.rows"), _num(v["res"], f"{where}.res"))


@dataclass
class Patch:
    file: str
    x0: int
    z0: int
    cellsX: int
    cellsZ: int

    @classmethod
    def parse(cls, v: Any, where: str) -> "Patch":
        v = _obj(v, where, ("file", "x0", "z0", "cellsX", "cellsZ"))
        return cls(_str(v["file"], f"{where}.file"), _int(v["x0"], f"{where}.x0"),
                   _int(v["z0"], f"{where}.z0"), _int(v["cellsX"], f"{where}.cellsX"),
                   _int(v["cellsZ"], f"{where}.cellsZ"))

    @property
    def cols(self) -> int:
        return self.cellsX * PATCH_REFINE + 1

    @property
    def rows(self) -> int:
        return self.cellsZ * PATCH_REFINE + 1


@dataclass
class TreesRef:
    file: str
    count: int

    @classmethod
    def parse(cls, v: Any, where: str) -> "TreesRef":
        v = _obj(v, where, ("file", "count"))
        return cls(_str(v["file"], f"{where}.file"), _int(v["count"], f"{where}.count"))


@dataclass
class Landmark:
    name: str
    kind: str
    x: float
    z: float
    rotation: float = 0.0
    scale: float = 1.0
    y: float | None = None

    @classmethod
    def parse(cls, v: Any, where: str) -> "Landmark":
        v = _obj(v, where, ("name", "kind", "x", "z"), ("rotation", "scale", "y"))
        return cls(_str(v["name"], f"{where}.name"), _str(v["kind"], f"{where}.kind"),
                   _num(v["x"], f"{where}.x"), _num(v["z"], f"{where}.z"),
                   _num(v.get("rotation", 0), f"{where}.rotation"),
                   _num(v.get("scale", 1), f"{where}.scale"),
                   _num(v["y"], f"{where}.y") if "y" in v else None)

    def to_dict(self) -> dict:
        d: dict[str, Any] = {"name": self.name, "kind": self.kind, "x": self.x, "z": self.z}
        if self.rotation != 0.0:
            d["rotation"] = self.rotation
        if self.scale != 1.0:
            d["scale"] = self.scale
        if self.y is not None:
            d["y"] = self.y
        return d


@dataclass
class Hole:
    number: int
    par: int
    route: list[tuple[float, float]]

    @classmethod
    def parse(cls, v: Any, where: str) -> "Hole":
        v = _obj(v, where, ("number", "par", "route"))
        route = []
        for i, p in enumerate(_list(v["route"], f"{where}.route")):
            p = _list(p, f"{where}.route[{i}]")
            if len(p) != 2:
                raise SchemaError(f"{where}.route[{i}]: expected [x, z]")
            route.append((_num(p[0], f"{where}.route[{i}][0]"), _num(p[1], f"{where}.route[{i}][1]")))
        return cls(_int(v["number"], f"{where}.number"), _int(v["par"], f"{where}.par"), route)

    def to_dict(self) -> dict:
        return {"number": self.number, "par": self.par, "route": [list(p) for p in self.route]}


@dataclass
class Course:
    name: str
    attribution: str
    crs: str
    originEasting: float
    originNorthing: float
    hMin: float
    hMax: float
    height: Grid
    class_: Grid
    bounds: Grid
    trees: TreesRef
    patches: list[Patch] = field(default_factory=list)
    landmarks: list[Landmark] = field(default_factory=list)
    holes: list[Hole] = field(default_factory=list)

    @classmethod
    def parse(cls, v: Any) -> "Course":
        v = _obj(v, "course.json",
                 ("name", "attribution", "crs", "originEasting", "originNorthing", "hMin", "hMax",
                  "height", "class", "bounds", "trees", "holes"),
                 ("patches", "landmarks"))
        return cls(
            name=_str(v["name"], "name"),
            attribution=_str(v["attribution"], "attribution"),
            crs=_str(v["crs"], "crs"),
            originEasting=_num(v["originEasting"], "originEasting"),
            originNorthing=_num(v["originNorthing"], "originNorthing"),
            hMin=_num(v["hMin"], "hMin"),
            hMax=_num(v["hMax"], "hMax"),
            height=Grid.parse(v["height"], "height"),
            class_=Grid.parse(v["class"], "class"),
            bounds=Grid.parse(v["bounds"], "bounds"),
            trees=TreesRef.parse(v["trees"], "trees"),
            patches=[Patch.parse(p, f"patches[{i}]") for i, p in enumerate(_list(v.get("patches", []), "patches"))],
            landmarks=[Landmark.parse(p, f"landmarks[{i}]") for i, p in enumerate(_list(v.get("landmarks", []), "landmarks"))],
            holes=[Hole.parse(p, f"holes[{i}]") for i, p in enumerate(_list(v["holes"], "holes"))],
        )

    def to_dict(self) -> dict:
        grid = lambda g: {"file": g.file, "cols": g.cols, "rows": g.rows, "res": g.res}  # noqa: E731
        return {
            "name": self.name,
            "attribution": self.attribution,
            "crs": self.crs,
            "originEasting": self.originEasting,
            "originNorthing": self.originNorthing,
            "hMin": self.hMin,
            "hMax": self.hMax,
            "height": grid(self.height),
            "class": grid(self.class_),
            "bounds": grid(self.bounds),
            "patches": [{"file": p.file, "x0": p.x0, "z0": p.z0, "cellsX": p.cellsX, "cellsZ": p.cellsZ}
                        for p in self.patches],
            "trees": {"file": self.trees.file, "count": self.trees.count},
            "landmarks": [m.to_dict() for m in self.landmarks],
            "holes": [h.to_dict() for h in self.holes],
        }

    @property
    def extent(self) -> tuple[float, float]:
        """Course size in metres: (x east-west, z north-south)."""
        return ((self.height.cols - 1) * self.height.res, (self.height.rows - 1) * self.height.res)
