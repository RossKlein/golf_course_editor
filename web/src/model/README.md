# `src/model`

## Purpose

What the editor works on, as data and the operations on it. A sibling of `terrain/`: neither imports the other. Nothing here draws, and nothing here uses OpenLayers.

## Belongs here

- `design/`: the design document (regions, bounds, holes, layout), its store with undo and redo (zustand and immer), hole logic, and region layering. `useDesign` is the store's React hook and stays with it.
- `theme/`: the editor's palette (surface class and hole colours). These are editor aids, not the course's look, and are never in a bundle.

## Does not belong here

- The course's look: that is in `course.json` and loaded by `terrain/`
- Anything that builds OpenLayers layers from the design (`views/map2d/design/`) or talks to the server (`scene/`)
- Components

## Rules

- Operations on the document go through the store so that every change is one undo step.
- Pure functions (`holes.ts`, `layering.ts`) have tests next to them.
