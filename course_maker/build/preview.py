"""Plant the trees as they would be built, from settings that have not been saved, and write nothing. A forest slider can then show its
effect as it is dragged, in a tenth of a second, and the build that follows the release makes exactly what was shown (it is the same
planting, over the same remembered rasters: see trees.Forest)."""
from __future__ import annotations

from pathlib import Path
from typing import Mapping

from ..design.models import ForestSettings, RegionsFile, TreeEdits
from ..design.store import read_regions
from ..models import Course
from . import trees
from .build import rasterize_classes, rasterize_region_index

# course.json and regions.json parsed, until either changes on disk: parsing the regions (thousands of vertices, all validated) costs more than planting
_parsed: dict[str, tuple[tuple, Course, RegionsFile]] = {}


def _stamp(bundle: Path) -> tuple:
    out = []
    for p in (bundle / "course.json", bundle / ".course_maker" / "design" / "regions.json"):
        try:
            s = p.stat()
            out.append((s.st_mtime_ns, s.st_size))
        except OSError:
            out.append(None)
    return tuple(out)


def _design(bundle: Path) -> tuple[Course, RegionsFile]:
    name, stamp = str(bundle.resolve()), _stamp(bundle)
    kept = _parsed.get(name)
    if kept and kept[0] == stamp:
        return kept[1], kept[2]
    course, regions = Course.read(bundle / "course.json"), read_regions(bundle)
    _parsed[name] = (stamp, course, regions)
    while len(_parsed) > trees.MAX_REMEMBERED:
        _parsed.pop(next(iter(_parsed)))
    return course, regions


def preview_trees(bundle, edits: TreeEdits, settings: Mapping[str, ForestSettings | None]) -> trees.Planting:
    """The trees the build would write for the saved design with `edits` and these forest `settings` (by region id; None is the woods defaults)
    in place of what is saved. The geometry (outlines, surfaces, their order), the look and the landmarks are the saved ones."""
    bundle = Path(bundle)
    course, saved = _design(bundle)
    woods = trees.WOODS
    regions = [r.model_copy(update={"trees": settings[r.id]}) if r.class_ == woods and r.id in settings else r for r in saved.regions]
    key = trees.geometry_key(saved.regions, course.extent, course.class_.res, (course.class_.rows, course.class_.cols))
    forest = trees.forest_for(
        bundle, key, lambda: (rasterize_classes(saved.regions, course, [])[..., 0].copy(), rasterize_region_index(saved.regions, course)),
    )
    return trees.plant(
        extent=course.extent, res=course.class_.res, klass=forest.klass, region_index=forest.region_index, regions=regions, edits=edits,
        kinds=course.look.trees.kinds, landmarks=course.landmarks, forest=forest,
    )
