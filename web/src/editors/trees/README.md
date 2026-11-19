# `src/editors/trees`

## Purpose

The Trees editor: plant forests, place trees by hand and clear ground. The build does the planting (`course_maker/build/trees.py`) and writes `trees.bin`; this sets what it plants from. The plan and the reasoning are in `docs/tree-editor-plan.md`.

## Belongs here

- `tools.ts`: the four tools, each a `GroundTool`: Select (a woods patch or a placed tree), Add tree, Clear (a brush that draws a clearing where no forest trees are planted) and Erase (a brush that removes placed trees and hand-drawn clearings). One stroke is one undo step
- `useTreesEditor.ts`: the hook. On the map it reads the pointer, draws the brush ring and the overlays; in 3D it hands the view the tool
- `TreesPanel.tsx`, `PatchFields.tsx`: the floating card: the selected patches' settings, the woods defaults, the next placed tree, and the clearings
- `overlays.ts`: what is drawn over the map, as plain data: patches tinted by density, placed trees, derived and hand-drawn clearings
- `clearings.ts`: the clearing around a placed tree or a landmark. The same rule as the build, with the same numbers in both tests
- `forestFields.ts`, `estimate.ts`: the sliders' ranges (checked against the API schema) and the "about N trees" figures
- `treesUi.ts`: what the editor holds that is not the design: the next tree's model and height, whether clearings are shown, the selected placed tree

## Does not belong here

- Placing trees: that is the build's. This only edits the settings, placed trees and clearings in the design
- The operations that keep tree weights and placed trees in step with the look's tree kinds (`model/design/forest.ts`)
- Generic controls (`ui/`)

## Rules

- Everything changes the design through `model/design/forest.ts`, so it is one undo step and is saved with the rest of the design. A change that should show now asks for a build (`requestBuild`); the trees come back from the server after it.
- A hole's line of play is never cleared for you: a tree in the way can be the point of the hole.
- Clearings around placed trees and landmarks are derived, never stored. Only the ones drawn by hand are.
