"""Plant the trees: forest patches, hand-placed trees and the clearings between them. docs/tree-editor-plan.md, part 2.

A forest patch is a woods region. Its trees are the first K points of a progressive low-discrepancy sequence (R2) laid over the whole
course, so they depend only on the patch's seed and id, never on its outline or its spacing:
 - raising the density adds points and moves none, because point i is where it is whatever K is;
 - reshaping a patch only changes which points fall inside it;
 - editing one patch changes none of another's.
Spacing is an average. There is no minimum distance: where trees crowd, the course designer raises the spacing or brushes a clearing.

Everything here is a function of numpy arrays and models, with no file access, so it is tested without a bundle.
"""
from __future__ import annotations

import hashlib
import json
import threading
import zlib
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Sequence

import numpy as np
from scipy.ndimage import distance_transform_edt

from .. import spec as S
from ..design.models import ForestSettings, PlacedTree, Region, TreeEdits
from ..models import Landmark, TreeKind

WOODS = S.CLASSES["woods"]
JITTER = 0.6  # metres a point is nudged, fixed (not a share of the spacing) so a change of density does not move a tree; 0 would be a lattice, 1 crowds a 3 m spacing
PLACED_MARGIN = 0.5  # metres of clear ground beyond a placed tree's crown
LANDMARK_CLEARANCE = 4.0  # metres around a landmark, times its scale, when it does not say
EDGE_GRID = 2  # the distance to open ground is worked out every this many class cells
CAP_PASSES = 4

_PLASTIC = 1.32471795724474602596  # the real root of x^3 = x + 1; the R2 sequence's steps are 1/p and 1/p^2
_STEP = (1.0 / _PLASTIC, 1.0 / _PLASTIC**2)
_MASK32 = 0xFFFFFFFF

# the streams of random numbers a point draws from
_JITTER_X, _JITTER_Z, _THIN, _KIND, _HEIGHT = 1, 2, 3, 4, 5


def hash32(a: np.ndarray, salt: int, seed: int) -> np.ndarray:
    """A deterministic 32-bit hash of an integer array, a salt (which stream) and a seed. The same on every machine."""
    x = (np.asarray(a, np.uint64) * 0x9E3779B1 + (salt * 0x85EBCA77 + seed * 0xC2B2AE3D) & _MASK32) & _MASK32
    x ^= x >> 15
    x = (x * 0x2C1B3C6D) & _MASK32
    x ^= x >> 12
    x = (x * 0x297A2D39) & _MASK32
    x ^= x >> 15
    return x.astype(np.uint32)


def unit(h: np.ndarray) -> np.ndarray:
    """A hash as a number in [0, 1)."""
    return h.astype(np.float64) / 4294967296.0


def crown_fraction(kind: TreeKind) -> float:
    """How far a tree of this kind reaches from its trunk, as a fraction of its height: the widest of its parts. The editor uses the same rule."""
    reach = 0.0
    for part in kind.parts:
        if part.shape == "frustum":
            reach = max(reach, part.r0, part.r1)
        else:
            reach = max(reach, float(np.hypot(part.cx, part.cz)) + max(part.rx, part.rz))
    return reach


def patch_seed(region_id: str, seed: int) -> int:
    """What a patch's points are drawn from: its id and its seed setting."""
    return (zlib.crc32(region_id.encode("utf-8")) + seed * 0x9E3779B1) & _MASK32


def r2_points(count: int, offset: tuple[float, float], width: float, height: float) -> tuple[np.ndarray, np.ndarray]:
    """The first `count` points of the R2 sequence, shifted by `offset`, over a width x height rectangle. Any prefix is evenly spread."""
    i = np.arange(count, dtype=np.float64) + 0.5
    return ((offset[0] + i * _STEP[0]) % 1.0) * width, ((offset[1] + i * _STEP[1]) % 1.0) * height


def smoothstep(a: float, b: float, x: np.ndarray) -> np.ndarray:
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


@dataclass
class Planting:
    """The trees that were planted, and what the build should say about them."""

    trees: np.ndarray  # S.TREE_DTYPE
    notes: list[str] = field(default_factory=list)
    procedural: int = 0
    placed: int = 0
    cleared: dict[str, int] = field(default_factory=dict)  # procedural trees dropped, by what cleared them: landmarks, placed trees, hand
    thinned: float | None = None  # the share of every patch kept when the cap was reached, else None


@dataclass
class Grid:
    """The class map's grid, which the points are looked up in: class numbers and the owning region (its position in the list plus one)."""

    klass: np.ndarray  # (rows, cols) uint8
    region_index: np.ndarray  # (rows, cols) uint16
    res: float

    def cells(self, x: np.ndarray, z: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        rows, cols = self.klass.shape
        return (np.clip((z / self.res).astype(np.int64), 0, rows - 1), np.clip((x / self.res).astype(np.int64), 0, cols - 1))


def distance_to_open_ground(klass: np.ndarray, res: float) -> np.ndarray:
    """Metres from each woods cell (every EDGE_GRID cells) to the nearest cell that is not woods, the course's edge counting as open."""
    woods = np.pad(klass[::EDGE_GRID, ::EDGE_GRID] == WOODS, 1, constant_values=False)
    return distance_transform_edt(woods)[1:-1, 1:-1] * (EDGE_GRID * res)


@dataclass
class Forest:
    """What a design's geometry fixes, kept between builds and previews so a change to one patch's settings replants only that patch:
    the class and region rasters, the distance to open ground, and each patch's trees as last planted. It belongs to one geometry (see
    `geometry_key`); a different one is a different Forest."""

    key: str
    klass: np.ndarray  # (rows, cols) uint8
    region_index: np.ndarray  # (rows, cols) uint16
    patches: dict = field(default_factory=dict)  # (index, id, settings, kinds, scale) -> the patch's x, z, heights and kinds
    _distance: np.ndarray | None = None
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    def distance(self, res: float) -> np.ndarray:
        with self._lock:
            if self._distance is None:
                self._distance = distance_to_open_ground(self.klass, res)
            return self._distance


def geometry_key(regions: Sequence[Region], extent: tuple[float, float], res: float, shape: tuple[int, int]) -> str:
    """What decides which cell belongs to which patch, and which are woods: the regions' outlines and surfaces in painter's order, and the grid."""
    h = hashlib.sha1(json.dumps([extent, res, shape]).encode())
    for r in regions:
        h.update(json.dumps([r.id, r.class_, r.outer, r.inner]).encode())
    return h.hexdigest()


_forests: dict[str, Forest] = {}
_forests_lock = threading.Lock()
MAX_REMEMBERED = 2  # bundles; a forest is some 50 MB


def forest_for(bundle, key: str, make: Callable[[], tuple[np.ndarray, np.ndarray]]) -> Forest:
    """The remembered Forest of this bundle if its geometry is `key`, else a new one made from `make()` (the class and region rasters)."""
    name = str(Path(bundle).resolve())
    with _forests_lock:
        forest = _forests.get(name)
        if forest is not None and forest.key == key:
            return forest
    klass, region_index = make()
    forest = Forest(key, klass, region_index)
    with _forests_lock:
        _forests[name] = forest
        while len(_forests) > MAX_REMEMBERED:
            _forests.pop(next(iter(_forests)))
    return forest


def forget_forests() -> None:
    """Drop everything remembered (for tests)."""
    with _forests_lock:
        _forests.clear()


def plant_patch(
    *, region_id: str, settings: ForestSettings, index: int, grid: Grid, extent: tuple[float, float], kinds: Sequence[TreeKind],
    distance: np.ndarray | None, scale: float = 1.0,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """One patch's trees as x, z (metres), height (metres) and kind (index into `kinds`). `scale` thins the patch evenly (the cap)."""
    width, height = extent
    seed = patch_seed(region_id, settings.seed)
    count = int(np.ceil(width * height / settings.spacing**2 * scale))
    offset = (float(unit(hash32(np.zeros(1), 11, seed))[0]), float(unit(hash32(np.zeros(1), 12, seed))[0]))
    x, z = r2_points(count, offset, width, height)
    i = np.arange(count)
    x = np.clip(x + (unit(hash32(i, _JITTER_X, seed)) * 2 - 1) * JITTER, 0, width)
    z = np.clip(z + (unit(hash32(i, _JITTER_Z, seed)) * 2 - 1) * JITTER, 0, height)

    rows, cols = grid.cells(x, z)
    mine = (grid.region_index[rows, cols] == index + 1) & (grid.klass[rows, cols] == WOODS)
    keep = mine
    if settings.edgeThinning > 0 and distance is not None:
        d = distance[np.minimum(rows // EDGE_GRID, distance.shape[0] - 1), np.minimum(cols // EDGE_GRID, distance.shape[1] - 1)]
        share = settings.edgeDensity + (1 - settings.edgeDensity) * smoothstep(0.0, settings.edgeThinning, d)
        keep = mine & (unit(hash32(i, _THIN, seed)) < share)
    i, x, z = i[keep], x[keep], z[keep]

    # the kind is picked by weight, walking the kinds in name order so reordering them in the look changes nothing
    order = sorted(range(len(kinds)), key=lambda k: kinds[k].name)
    weights = np.array([settings.kinds.get(kinds[k].name, 1.0) for k in order], np.float64)
    if weights.sum() <= 0:
        weights = np.ones(len(order))
    edges = np.cumsum(weights) / weights.sum()
    pick = np.minimum(np.searchsorted(edges, unit(hash32(i, _KIND, seed)), side="right"), len(order) - 1)
    kind = np.array(order, np.int64)[pick] if len(order) else np.zeros(len(i), np.int64)
    low = np.array([kinds[k].height[0] for k in range(len(kinds))])[kind]
    high = np.array([kinds[k].height[1] for k in range(len(kinds))])[kind]
    tall = (low + (high - low) * unit(hash32(i, _HEIGHT, seed))) * settings.heightScale
    return x, z, tall, kind


def paint_discs(shape: tuple[int, int], res: float, discs: Sequence[tuple[float, float, float]]) -> np.ndarray:
    """A mask of the cells inside any of the circles (x, z, radius) in metres."""
    rows, cols = shape
    mask = np.zeros(shape, bool)
    for x, z, r in discs:
        c0, c1 = max(0, int((x - r) / res)), min(cols - 1, int((x + r) / res))
        r0, r1 = max(0, int((z - r) / res)), min(rows - 1, int((z + r) / res))
        if c1 < c0 or r1 < r0:
            continue
        cx = (np.arange(c0, c1 + 1) + 0.5) * res - x
        cz = (np.arange(r0, r1 + 1) + 0.5) * res - z
        mask[r0 : r1 + 1, c0 : c1 + 1] |= (cz[:, None] ** 2 + cx[None, :] ** 2) <= r * r
    return mask


def placed_clearings(added: Sequence[PlacedTree], kinds: Sequence[TreeKind]) -> list[tuple[float, float, float]]:
    """The clearing around each placed tree: its crown and a margin. Move or delete the tree and it goes with it."""
    crown = [crown_fraction(k) for k in kinds]
    return [(t.x, t.z, crown[t.kind % len(kinds)] * t.height + PLACED_MARGIN) for t in added]


def landmark_clearings(landmarks: Sequence[Landmark]) -> list[tuple[float, float, float]]:
    """The clearing around each landmark: its `clearance`, or a few metres times its scale."""
    return [(m.x, m.z, m.clearance if m.clearance is not None else LANDMARK_CLEARANCE * m.scale) for m in landmarks]


def _patch(forest, grid, extent, kinds, distance, names, heights, i, r, s, scale):
    """One patch's trees, from the memo when the same patch was planted the same way before."""
    key = (i, r.id, s.model_dump_json(), tuple(names), tuple(heights), round(scale, 9), distance is not None)
    if forest is not None and key in forest.patches:
        return forest.patches[key]
    planted = plant_patch(region_id=r.id, settings=s, index=i, grid=grid, extent=extent, kinds=kinds, distance=distance, scale=scale)
    if forest is not None:
        if len(forest.patches) > 400:  # settings dragged through many values: keep what is recent
            forest.patches.pop(next(iter(forest.patches)))
        forest.patches[key] = planted
    return planted


def plant(
    *, extent: tuple[float, float], res: float, klass: np.ndarray, region_index: np.ndarray, regions: Sequence[Region],
    edits: TreeEdits, kinds: Sequence[TreeKind], landmarks: Sequence[Landmark] = (), forest: Forest | None = None,
) -> Planting:
    """Every tree of the course: the forest patches, less the clearings, then the placed trees. With a `forest` (which must be for these
    rasters), what was planted for a patch whose settings are unchanged is reused, and the distance to open ground is worked out once."""
    notes: list[str] = []
    grid = Grid(klass, region_index, res)
    width, height = extent

    named = {n for r in regions if r.trees for n in r.trees.kinds} | set(edits.defaults.kinds)
    for name in sorted(named - {k.name for k in kinds}):
        notes.append(f"tree settings weight a kind called {name}, which the look does not have, so it was ignored")

    owned = np.bincount(region_index[klass == WOODS].ravel(), minlength=len(regions) + 1)
    patches = [(i, r, r.trees or edits.defaults) for i, r in enumerate(regions) if r.class_ == WOODS and owned[i + 1] > 0]
    wants_distance = any(s.edgeThinning > 0 for _, _, s in patches)
    distance = (forest.distance(res) if forest else distance_to_open_ground(klass, res)) if wants_distance else None
    names = [k.name for k in kinds]
    heights = [tuple(k.height) for k in kinds]

    placed_room = max(0, S.MAX_TREES - len(edits.added))
    scale, thinned, parts, total = 1.0, None, [], 0
    for _ in range(CAP_PASSES):
        parts = [_patch(forest, grid, extent, kinds, distance, names, heights, i, r, s, scale) for i, r, s in patches] if kinds else []
        total = sum(len(p[0]) for p in parts)
        if total <= placed_room:
            break
        scale *= placed_room / total * 0.995  # thin every patch by the same share: the prefix property makes this a lower density everywhere
        thinned = scale
    else:  # the shares did not get there (the edge thinning is not linear), so cut each patch to its part of the cap
        parts = [tuple(a[: placed_room * len(a) // total] for a in p) for p in parts]
    if thinned is not None:
        notes.append(f"capped at {S.MAX_TREES:,} trees: every patch was thinned to {thinned:.0%}; raise the spacing")

    if parts:
        x, z, tall, kind = (np.concatenate([p[k] for p in parts]) for k in range(4))
    else:
        x = z = tall = np.zeros(0)
        kind = np.zeros(0, np.int64)
    alive = np.ones(len(x), bool)
    cleared: dict[str, int] = {}
    if len(x):
        rows, cols = grid.cells(x, z)
        for source, discs in (
            ("landmarks", landmark_clearings(landmarks)),
            ("placed trees", placed_clearings(edits.added, kinds) if kinds else []),
            ("hand-drawn clearings", [(c.x, c.z, c.r) for c in edits.removed]),
        ):
            if not discs:
                continue
            hit = alive & paint_discs(klass.shape, res, discs)[rows, cols]
            if hit.any():
                cleared[source] = int(hit.sum())
                alive &= ~hit

    procedural = int(alive.sum())
    out = np.zeros(procedural + len(edits.added), S.TREE_DTYPE)
    out["x"][:procedural], out["z"][:procedural] = x[alive], z[alive]
    out["height_cm"][:procedural] = np.clip(np.round(tall[alive] * 100), 1, 65535)
    out["kind"][:procedural] = kind[alive]
    for n, t in enumerate(edits.added, start=procedural):
        out[n] = (min(max(t.x, 0.0), width), min(max(t.z, 0.0), height), int(min(max(round(t.height * 100), 1), 65535)), t.kind % max(1, len(kinds)), 0)
    if any(not (0 <= t.x <= width and 0 <= t.z <= height) for t in edits.added):
        notes.append("a placed tree is outside the course and was moved to its edge")
    return Planting(out, notes, procedural, len(edits.added), cleared, thinned)
