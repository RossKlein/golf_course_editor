# `course_maker`

The Python side: the compiler that turns a course stack into a bundle, and the FastAPI server the editor talks to. All
types are pydantic models in `models.py`; the web app's types are generated from them (`python -m course_maker openapi`,
then `npm run types` in `web/`).

## Packages

| Package | Role |
| --- | --- |
| `spec.py` | The bundle format's constants: classes, limits, file names. The one place a number like "24 holes" lives. |
| `models.py` | Every pydantic model the API and the files use. |
| `compiler/` | Bake a stack into a bundle (`bake.py`), read and write the PNG and binary formats (`codec.py`), check a bundle (`validate.py`). No server code; `bake.py` records the project file through `project/`. |
| `build/` | Rebuild a bundle from the editor's design (`build.py`), the height base and sculpt delta (`height.py`), and the background build queue (`manager.py`). Uses `compiler/`. |
| `design/` | The editable design document (regions, routes, bounds) and its store with backups. |
| `project/` | The per-bundle `.course_maker/` folder: the project file and editor state. |
| `server/` | HTTP: the API (`app.py`), raster and aerial rendering. Thin: it calls the packages above. |
| `tests/` | Unit and server tests, `python -m unittest discover -s course_maker/tests -t .` |

## Rules

- Dependencies point down the table: `server` may use anything; `build` uses `compiler`, `design` and `project`;
  `compiler` uses `models`, `spec` and `project`, and never `build`, `design` or `server`.
- Nothing outside `compiler/` knows a file layout inside a bundle.
- The game reads only what is in the bundle (`course.json`, the PNGs, `trees.bin`). Editor files (`.course_maker/`) are
  never part of it.
