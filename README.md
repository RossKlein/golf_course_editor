# Golf course compiler

Turns real golf courses (USGS 3DEP elevation + NAIP imagery) into baked bundles for the Rally Club golf game.
The bundle format is specified in the game repo: `docs/golf-course-format.md`. This repo is the producer; the
game's loader is the consumer.

## Setup

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install pystac-client planetary-computer rasterio pillow numpy shapely
```

## Pipeline

1. `fetch_3dep.py`, `course_stack.py`, `run_all.py`: acquire a course's DEM and imagery as `course_stack.tif`
   (see `HANDOFF.md` and `plan.md`).
2. `python -m compiler.bake --stack augusta/course_stack.tif --name "Augusta National" --out bundles/augusta`
   writes a bundle (macro heightmap, empty class/bounds maps, no trees or holes yet) and validates it.
3. `python -m compiler.validate bundles/augusta` checks any bundle against the spec and prints a size report.

## Tests

```powershell
python -m unittest discover -s compiler/tests -t .
```

`compiler/`: `schema.py` (course.json + constants), `codec.py` (height encoding, PNG IO, bilinear sampling),
`validate.py`, `bake.py`.
