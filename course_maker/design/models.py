"""Design types: the editable source of a course (`.course_maker/design/`), plus the build status the API reports.

The bundle is compiled from these. Coordinates are course metres, x east and z south, like the bundle's.
"""
from __future__ import annotations

from typing import Annotated, Literal

from pydantic import Field, model_validator

from .. import spec
from ..models import Int, Look, Model, Name, Number, Report

Point = tuple[Number, Number]
Ring = Annotated[list[Point], Field(min_length=4, max_length=20_000)]  # closed: first point equals last

MAX_REGIONS = 5000


def _closed(ring: list[Point], where: str) -> None:
    if ring[0] != ring[-1]:
        raise ValueError(f"{where}: a ring must be closed (first point equals last)")


class ForestSettings(Model):
    """How a forest patch (a woods region) is planted. docs/tree-editor-plan.md, section 3."""

    spacing: Annotated[Number, Field(ge=2, le=20)] = 5.0  # metres between trees on average
    kinds: Annotated[dict[Name, Annotated[Number, Field(ge=0, le=1)]], Field(max_length=8)] = {}  # weight of each tree kind by its name; missing is 1
    heightScale: Annotated[Number, Field(ge=0.5, le=2)] = 1.0  # a scale on each kind's height range
    edgeThinning: Annotated[Number, Field(ge=0, le=30)] = 8.0  # metres over which the forest thins towards open ground; 0 for none
    edgeDensity: Annotated[Number, Field(ge=0, le=1)] = 0.3  # how full it is right at the border, as a share of full density
    seed: Annotated[Int, Field(ge=0, le=2**31 - 1)] = 0  # which random arrangement


class Region(Model):
    """A surface polygon. Order in the file is painter's order: later regions are drawn over earlier ones."""

    id: Annotated[str, Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_.-]+$")]
    class_: Annotated[Int, Field(ge=0, le=spec.VOID)] = Field(alias="class")  # a surface class, or spec.VOID (no ground)
    hole: Annotated[Int, Field(ge=1, le=99)] | None = None  # only for fairway, green and tee
    outer: Ring
    inner: list[Ring] = []
    note: Annotated[str, Field(max_length=500)] | None = None
    trees: ForestSettings | None = None  # woods only; None uses the woods defaults (TreeEdits.defaults)

    @model_validator(mode="after")
    def _valid(self) -> "Region":
        _closed(self.outer, f"region {self.id} outer")
        for i, ring in enumerate(self.inner):
            _closed(ring, f"region {self.id} inner[{i}]")
        if self.class_ != spec.VOID and self.class_ not in spec.CLASSES.values():
            raise ValueError(f"region {self.id}: {self.class_} is not a surface class")
        if self.hole is not None and self.class_ not in spec.OWNED_CLASSES:
            raise ValueError(f"region {self.id}: only fairway, green and tee regions can have a hole number")
        if self.trees is not None and self.class_ != spec.CLASSES["woods"]:
            raise ValueError(f"region {self.id}: only woods regions have tree settings")
        return self


class RegionsFile(Model):
    regions: Annotated[list[Region], Field(max_length=MAX_REGIONS)] = []

    @model_validator(mode="after")
    def _unique(self) -> "RegionsFile":
        ids = [r.id for r in self.regions]
        if len(set(ids)) != len(ids):
            raise ValueError("region ids must be unique")
        return self


class BoundsArea(Model):
    """Part of the ground that is in bounds for one hole. A hole's in-bounds ground is the union of its areas; a hole
    with none yet is in bounds everywhere (so unfinished holes are not flagged as out of bounds)."""

    id: Annotated[str, Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_.-]+$")]
    hole: Annotated[Int, Field(ge=1, le=spec.MAX_HOLES)]
    outer: Ring
    inner: list[Ring] = []

    @model_validator(mode="after")
    def _closed_rings(self) -> "BoundsArea":
        _closed(self.outer, f"bounds area {self.id} outer")
        for i, ring in enumerate(self.inner):
            _closed(ring, f"bounds area {self.id} inner[{i}]")
        return self


class BoundsFile(Model):
    areas: Annotated[list[BoundsArea], Field(max_length=MAX_REGIONS)] = []

    @model_validator(mode="after")
    def _unique(self) -> "BoundsFile":
        ids = [a.id for a in self.areas]
        if len(set(ids)) != len(ids):
            raise ValueError("bounds area ids must be unique")
        return self


class DesignHole(Model):
    """A hole as designed. The route may still be unfinished (fewer than 2 points); the build skips such holes."""

    number: Annotated[Int, Field(ge=1, le=spec.MAX_HOLES)]
    par: Annotated[Int, Field(ge=1, le=9)] = 4
    name: Annotated[str, Field(max_length=80)] | None = None
    route: Annotated[list[Point], Field(max_length=500)] = []


class Layout(Model):
    """Course metadata and holes. `name` and `attribution`, when set, override what the bake wrote."""

    name: Name | None = None
    attribution: Name | None = None
    holes: Annotated[list[DesignHole], Field(max_length=spec.MAX_HOLES)] = []

    @model_validator(mode="after")
    def _numbering(self) -> "Layout":
        if [h.number for h in self.holes] != list(range(1, len(self.holes) + 1)):
            raise ValueError("hole numbers must be 1-based and contiguous, in order")
        return self


class PlacedTree(Model):
    """A tree put down by hand. It is a plain tree in trees.bin, and the forest does not grow within its crown."""

    x: Number
    z: Number
    height: Annotated[Number, Field(gt=0, le=60)]  # metres
    kind: Annotated[Int, Field(ge=0, le=7)]  # index into the look's tree kinds


class Clearing(Model):
    """A circle drawn by hand where the forest is not planted."""

    x: Number
    z: Number
    r: Annotated[Number, Field(gt=0, le=100)]  # metres


MAX_TREE_EDITS = 5000


class TreeEdits(Model):
    """`.course_maker/design/trees.json`: the woods defaults and the hand edits. Clearings around placed trees and landmarks are derived at build time, not stored."""

    defaults: ForestSettings = ForestSettings()  # for woods patches with none of their own
    added: Annotated[list[PlacedTree], Field(max_length=MAX_TREE_EDITS)] = []
    removed: Annotated[list[Clearing], Field(max_length=MAX_TREE_EDITS)] = []


class TreesPreview(Model):
    """What the editor sends to see trees before saving them: the tree edits, and the forest settings of the woods patches that have their own
    (by region id; null for a patch on the woods defaults). The outlines are the saved ones."""

    edits: TreeEdits
    settings: dict[str, ForestSettings | None] = {}


class DesignDoc(Model):
    """Everything the editor edits."""

    layout: Layout
    regions: RegionsFile
    bounds: BoundsFile = BoundsFile()
    trees: TreeEdits = TreeEdits()


class DesignResponse(DesignDoc):
    """What the editor loads: the design, and the course's look, which is kept in course.json and edited with the rest."""

    look: Look


class BackupList(Model):
    backups: list[str]  # newest first


class CropRequest(Model):
    """The part of the map to keep, in whole course metres: the samples from x0 to x1 east and z0 to z1 south, edges included."""

    x0: Annotated[Int, Field(ge=0)]
    z0: Annotated[Int, Field(ge=0)]
    x1: Annotated[Int, Field(ge=1)]
    z1: Annotated[Int, Field(ge=1)]


class CropResponse(Model):
    cols: int
    rows: int
    notes: list[str] = []  # what the crop moved, cut or removed that is worth knowing
    crops: list[str]  # the crops that can now be taken back, newest first


class CropList(Model):
    crops: list[str]


class BuildStatus(Model):
    """Where the build for a bundle stands. `id` increases with every finished build; the viewer reloads on change."""

    id: int = 0
    state: Literal["idle", "building", "done", "failed"] = "idle"
    started: float | None = None
    finished: float | None = None
    report: Report | None = None  # validation of the built bundle: the editor's Problems list
    notes: list[str] = []  # things the build skipped or repaired (unfinished holes, invalid polygons)
    error: str | None = None  # set when the build itself failed; the previous bundle is untouched
    ms: dict[str, int] = {}  # timing of each step
    regions: int = 0
    holes: int = 0
    trees: int = 0  # trees in trees.bin after the last build
    files: dict[str, str] = {}  # sha1 of each file the build wrote (class.png, bounds.png, trees.bin, course.json, height.png), so the viewer reloads only what changed
