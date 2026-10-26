# `src/editors`

## Purpose

The editors: Course, Out of bounds and Heightmap today, and Hi-res patches, Greens, Landmarks and Trees to come. Each is a hook that attaches tools to the map, with its own commands. The Heightmap editor's brush also works in the 3D view, through a `GroundTool` it hands to the view.

## Shape

- `registry.ts`: the list of editors in editor-bar order (id, label, `g x` shortcut, whether it is enabled)
- `course/`, `bounds/`, `heightmap/`: one folder each, with its hook and tools
- `_shared/`: what more than one editor uses (polygon tools, freehand drawing, hole navigation)

## Rules

- An editor imports from `_shared/`, never from another editor.
- An editor builds its own commands and passes them up; `commands/` does not know about editors.
- Adding an editor touches its own folder and `registry.ts`.
