"""The course's look lives in course.json and nowhere else, and two things write that file: a build (which rewrites the rasters and
the holes) and the look editor (which changes only the look). Both take the bundle's lock to write, and a build re-reads the look
under it just before it replaces course.json, so whichever finishes last, neither edit is lost."""
from __future__ import annotations

import threading
from pathlib import Path

from ..models import Course, Look
from ..project.store import atomic_write

_guard = threading.Lock()
_locks: dict[str, threading.RLock] = {}


def bundle_lock(bundle) -> threading.RLock:
    """The lock for writing a bundle's course.json: one for each bundle, shared by everything in this process."""
    key = str(Path(bundle).resolve())
    with _guard:
        return _locks.setdefault(key, threading.RLock())


def read_look(bundle) -> Look:
    return Course.read(Path(bundle) / "course.json").look


def write_look(bundle, look: Look) -> None:
    """Replace the look in a bundle's course.json, and nothing else in it."""
    path = Path(bundle) / "course.json"
    with bundle_lock(bundle):
        course = Course.read(path).model_copy(update={"look": look})
        from .water import prune_water, publish_water
        if course.waterMesh is None or read_look(bundle).water != look.water or read_look(bundle).grass != look.grass:
            course = publish_water(bundle, course)
        atomic_write(path, course.model_dump_json(by_alias=True, exclude_none=True, indent=2) + "\n")
        prune_water(bundle, course)  # after course.json names the new mesh, so no reader is left pointing at a deleted one
