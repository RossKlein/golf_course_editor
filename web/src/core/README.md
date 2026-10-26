# `src/core`

## Purpose

The bottom of the dependency graph: plain helpers and contracts that everything else uses. It imports nothing from the rest of `src`, and no UI package (no React, no OpenLayers). The game will reuse it as it is.

## Belongs here

- `api/`: the typed client for the server, and the types generated from the pydantic models (`schema.d.ts`: regenerate with `python -m course_maker openapi`, then `npm run types`)
- `decode/`: reading PNGs and images into pixels and height grids, sampling a grid, small helpers such as `memoLast`
- `geometry/`: course coordinates (x east, z south, metres) and polygon maths on points
- `units/`: US and metric display formatting (the files and the API are always metres)

## Does not belong here

- Anything that draws: that is `gfx/` or `terrain/`
- React hooks and components (`useUnits` lives in `ui/`)
- OpenLayers types and the map projection (`scene/projection.ts`)
- Editor and design state (`model/`)

## Rules

- A folder's main module is named after the folder where it has one (`units/units.ts`). No `index.ts` barrels.
- Tests sit next to the code (`units.test.ts`).
