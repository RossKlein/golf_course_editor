"""What the last build made, so the next can skip what its inputs did not change. Kept in `.course_maker/build/cache.json`, which is
never part of the bundle and is safe to delete: a missing or unreadable cache only means everything is worked out again.

The slow steps of a build (decoding and re-encoding the heights, encoding the class and bounds images) each depend on a few inputs.
When those are the same as last time, and the file the last build wrote is still what is in the bundle, the step is skipped. An edit to
the trees, for one, changes none of them."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

from ..project.store import DIR_NAME, atomic_write


def _path(bundle) -> Path:
    return Path(bundle) / DIR_NAME / "build" / "cache.json"


def read_cache(bundle) -> dict:
    try:
        data = json.loads(_path(bundle).read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def write_cache(bundle, cache: dict) -> None:
    atomic_write(_path(bundle), json.dumps(cache, indent=1) + "\n")


def sha1_bytes(*parts: bytes) -> str:
    h = hashlib.sha1()
    for p in parts:
        h.update(p)
    return h.hexdigest()


def sha1_file(path) -> str:
    return hashlib.sha1(Path(path).read_bytes()).hexdigest()
