"""The hidden `.course_maker/` folder inside a bundle: editor state and project settings.

The game bundle is complete without this folder; nothing in it is needed to rebuild the game files from the
bundle alone, and it is never exported. See docs/editor-project-file.md.
"""
from __future__ import annotations

import json
import os
import tempfile
import time
from pathlib import Path

from pydantic import ValidationError

from ..models import EditorResponse, EditorState, ProjectFile

DIR_NAME = ".course_maker"
EDITOR_FILE = "editor.json"
PROJECT_FILE = "project.json"
# editor.json is per user and never committed; stray temp and .bad files are noise
INNER_GITIGNORE = f"{EDITOR_FILE}\n{EDITOR_FILE}.bad\n*.tmp\n"


def project_dir(bundle: Path) -> Path:
    return Path(bundle) / DIR_NAME


REPLACE_ATTEMPTS = 40
REPLACE_DELAY = 0.025  # seconds between tries: about a second in all


def replace_file(src, dst) -> None:
    """`os.replace`, retried briefly on Windows. There a rename onto a file that another thread has open for reading (a build reading the
    sculpting, a backup copying the design, the server sending a bundle file) is refused with "Access is denied", though the reader is done
    in a moment. Anywhere else, and for any other error, it is just `os.replace`."""
    for attempt in range(REPLACE_ATTEMPTS):
        try:
            os.replace(src, dst)
            return
        except PermissionError:
            if os.name != "nt" or attempt == REPLACE_ATTEMPTS - 1:
                raise
            time.sleep(REPLACE_DELAY)


def atomic_write(path: Path, text: str) -> None:
    """Write via a temporary file in the same folder, so a crash never leaves half a file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    gitignore = path.parent / ".gitignore"
    if path.parent.name == DIR_NAME and not gitignore.exists():  # only the project folder itself, not design/ below it
        gitignore.write_text(INNER_GITIGNORE, encoding="utf-8")
    fd, tmp = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as f:
            f.write(text)
        replace_file(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)


# --- editor.json ---------------------------------------------------------------


def write_editor(bundle: Path, state: EditorState) -> None:
    atomic_write(project_dir(bundle) / EDITOR_FILE, state.model_dump_json(indent=2) + "\n")


def _tolerant(data: object) -> EditorState | None:
    """Parse what can be parsed: unknown keys are ignored and any field that does not validate falls back to its
    default. None when the file is not an object of the current version at all."""
    if not isinstance(data, dict) or data.get("version") != 1:
        return None
    data = {k: v for k, v in data.items() if k in EditorState.model_fields}
    for _ in range(len(data) + 1):
        try:
            return EditorState.model_validate(data)
        except ValidationError as exc:
            bad = {e["loc"][0] for e in exc.errors() if e["loc"]}
            if not bad & data.keys():
                return None
            data = {k: v for k, v in data.items() if k not in bad}
    return None


def read_editor(bundle: Path) -> EditorResponse:
    """The saved editor state. A missing file gives defaults; an unreadable one is renamed to `editor.json.bad`
    (never destroyed) and defaults are used. A broken file never blocks opening a bundle."""
    path = project_dir(bundle) / EDITOR_FILE
    if not path.is_file():
        return EditorResponse(state=EditorState(), status="default")
    try:
        state = _tolerant(json.loads(path.read_text(encoding="utf-8")))
    except (json.JSONDecodeError, UnicodeDecodeError, OSError):
        state = None
    if state is None:
        try:
            os.replace(path, path.with_name(EDITOR_FILE + ".bad"))
        except OSError:
            pass
        return EditorResponse(state=EditorState(), status="reset")
    return EditorResponse(state=state, status="loaded")


# --- project.json --------------------------------------------------------------


def write_project(bundle: Path, project: ProjectFile) -> None:
    atomic_write(project_dir(bundle) / PROJECT_FILE, project.model_dump_json(indent=2) + "\n")


def read_project(bundle: Path) -> ProjectFile | None:
    path = project_dir(bundle) / PROJECT_FILE
    if not path.is_file():
        return None
    try:
        return ProjectFile.model_validate_json(path.read_text(encoding="utf-8"))
    except (ValidationError, OSError):
        return None


def stack_for(bundle: Path) -> Path | None:
    """The source stack a bundle was baked from, if recorded and still present."""
    project = read_project(bundle)
    if project is None:
        return None
    stack = (Path(bundle) / project.stack).resolve()
    return stack if stack.is_file() else None
