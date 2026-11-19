"""Reading and writing the design files, and rolling backups of them.

Unlike editor.json, design files are irreplaceable work: an invalid file is reported, never reset or renamed, and
every build snapshots the design first (keeping the last `KEEP_BACKUPS`).
"""
from __future__ import annotations

import hashlib
import shutil
from datetime import datetime, timezone
from pathlib import Path

from pydantic import ValidationError

from ..project.store import atomic_write, project_dir
from .models import BoundsFile, DesignDoc, Layout, RegionsFile, TreeEdits

DESIGN_DIR = "design"
BACKUP_DIR = "backups"
KEEP_BACKUPS = 20
HEIGHT_DIR = "height"  # design/height/macro.delta: terrain sculpting (see build/height.py)
FILES = {"layout": ("layout.json", Layout), "regions": ("regions.json", RegionsFile), "bounds": ("bounds.json", BoundsFile), "trees": ("trees.json", TreeEdits)}


class DesignError(ValueError):
    """A design file exists but is not valid. The file is left exactly as it is."""


def design_dir(bundle: Path) -> Path:
    return project_dir(bundle) / DESIGN_DIR


def _read(bundle: Path, name: str):
    filename, model = FILES[name]
    path = design_dir(bundle) / filename
    if not path.is_file():
        return model()
    try:
        return model.model_validate_json(path.read_text(encoding="utf-8"))
    except ValidationError as exc:
        first = exc.errors()[0]
        where = ".".join(str(p) for p in first["loc"])
        raise DesignError(f"{filename}: {where + ': ' if where else ''}{first['msg'].removeprefix('Value error, ')}") from exc


def read_layout(bundle: Path) -> Layout:
    return _read(bundle, "layout")


def read_regions(bundle: Path) -> RegionsFile:
    return _read(bundle, "regions")


def read_bounds(bundle: Path) -> BoundsFile:
    return _read(bundle, "bounds")


def read_trees(bundle: Path) -> TreeEdits:
    return _read(bundle, "trees")


def read_design(bundle: Path) -> DesignDoc:
    return DesignDoc(layout=read_layout(bundle), regions=read_regions(bundle), bounds=read_bounds(bundle), trees=read_trees(bundle))


def write_design_file(bundle: Path, name: str, value: Layout | RegionsFile | BoundsFile | TreeEdits) -> None:
    # stable key order and compact-but-readable output so a versioned diff stays small
    atomic_write(design_dir(bundle) / FILES[name][0], value.model_dump_json(by_alias=True, indent=1) + "\n")


# --- backups -------------------------------------------------------------------------------------------------------


def _fingerprint(folder: Path) -> str:
    h = hashlib.sha1()
    for p in sorted([*folder.glob("*.json"), *folder.glob(f"{HEIGHT_DIR}/*.delta")]):
        h.update(p.name.encode())
        h.update(p.read_bytes())
    return h.hexdigest()


def list_backups(bundle: Path) -> list[str]:
    root = project_dir(bundle) / BACKUP_DIR
    return sorted((p.name for p in root.iterdir() if p.is_dir()), reverse=True) if root.is_dir() else []


def snapshot(bundle: Path, keep: int = KEEP_BACKUPS) -> str | None:
    """Copy design/ into backups/<utc timestamp>/ unless it matches the newest backup. Returns the new name."""
    src = design_dir(bundle)
    if not src.is_dir() or not any([*src.glob("*.json"), *src.glob(f"{HEIGHT_DIR}/*.delta")]):
        return None
    root = project_dir(bundle) / BACKUP_DIR
    existing = list_backups(bundle)
    if existing and _fingerprint(root / existing[0]) == _fingerprint(src):
        return None
    name = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    shutil.copytree(src, root / name, ignore=shutil.ignore_patterns("*.tmp"))
    for old in list_backups(bundle)[keep:]:
        shutil.rmtree(root / old, ignore_errors=True)
    return name


def restore(bundle: Path, name: str) -> None:
    """Replace design/ with a backup. The current design is snapshotted first, so a restore can itself be undone."""
    root = project_dir(bundle) / BACKUP_DIR
    src = (root / name).resolve()
    if root.resolve() not in src.parents or not src.is_dir():
        raise DesignError(f"no backup named {name}")
    snapshot(bundle)
    for filename, _ in FILES.values():
        target = design_dir(bundle) / filename
        if (src / filename).is_file():
            atomic_write(target, (src / filename).read_text(encoding="utf-8"))
        elif target.exists():
            target.unlink()
    delta, kept = design_dir(bundle) / HEIGHT_DIR / "macro.delta", src / HEIGHT_DIR / "macro.delta"
    if kept.is_file():
        delta.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(kept, delta)
    elif delta.exists():
        delta.unlink()
