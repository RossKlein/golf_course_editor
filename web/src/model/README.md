# `src/model`

## Purpose

What the editor works on, as data and the operations on it. A sibling of `terrain/`: neither imports the other. Nothing here draws, and nothing here uses OpenLayers.

## Belongs here

- `design/`: the design document (regions, bounds, holes, layout), its store with undo and redo (zustand and immer), hole logic, and region layering. `useDesign` is the store's React hook and stays with it.
- `design/forest.ts`: the forest in the design: each woods patch's settings (on its region), the woods defaults, placed trees and hand-drawn clearings, and the operations on the look's tree kinds that must carry the weights (by name) and the placed trees (by index) with them
- `look/`: operations on the course's look, which is held in the design store beside the design (`doc.look`): paths into it, colour and sun maths (a colour as hue, saturation and value; the sun's declination as dates, its hour angle as hours), and the changes to the tree models. `edit.ts` is how a change is committed, as one undo step.
- `theme/`: the editor's palette (surface class and hole colours). These are editor aids, not the course's look, and are never in a bundle.

## Does not belong here

- Drawing the look: that is `terrain/`. Here the look is only data being edited
- Anything that builds OpenLayers layers from the design (`views/map2d/design/`) or talks to the server (`scene/`)
- Components

## Rules

- Operations on the document go through the store so that every change is one undo step.
- Pure functions (`holes.ts`, `layering.ts`) have tests next to them.
