# `src/editors`

## Purpose

The editors: Course, Out of bounds, Heightmap, Look and Trees today, and Hi-res patches, Greens, Landmarks and Trees to come. Each is a hook that attaches tools to the map, with its own commands. The Heightmap editor's brush (raise, lower, smooth, flatten, restore, and **clone**: Ctrl+click picks a spot, painting stamps its shape, set on the ground where the stroke starts, onto other ground; `terrain/sculpt/brush.frag.glsl` kind 5, `Stroke` keeps the source) also works in the 3D view, through a `GroundTool` it hands to the view. Its other tool, the Lake basin (`heightmap/BasinPanel.tsx`), takes no strokes: it works on a whole lake from a card, showing the cut on the ground as its settings change and keeping it as one undo step on Apply.

## Shape

- `registry.ts`: the list of editors in editor-bar order (id, label, `g x` shortcut, whether it is enabled)
- `course/`, `bounds/`, `heightmap/`: one folder each, with its hook and tools
  - `heightmap/` also has the **Sand trap** tool (`useTrapEditor`, `TrapPanel`, `terrain/sculpt/trap.ts`): click a bunker to pick it (as the Trees editor's Select picks a patch), then tune how the ground inside is shaped. It reuses the lake basin's outline distance and live preview (`shoreField` for any surface class, `HeightSession.carveEdit`). Depth comes from the distance in from the outline over a `wall` width, so one setting against the bunker's size gives a bowl, a flat floor or a trough; tilt, a facing lip, roughness and a seeded wobbly edge make each different.
  - `heightmap/` has two bars of tools. The first is the brushes and the lake basin (they change the height of the ground). The second, the **Map shape** bar (`shell/MeshBar.tsx`), changes the shape of the map:
    **Crop** (`useCropTool`, `CropPanel`, `cropRect`, `cropImpact`) keeps a rectangle of the map and moves the whole design with it, on the server (`course_maker/build/crop.py`), then reloads the page; **Cut** and **Island**
    (`useVoidTools`, `model/design/void.ts`) draw a *void* (class 255, no ground), which the 3D view shows as a hole in the terrain mesh (`scene/voidGround.ts` marks the height samples as having no data); **Restore original**
    (`HeightSession.restoreAll`) takes all sculpting away as one undo step; **Undo crop** brings back the map as it was before the last crop.
- `look/`: the Look editor, which has no map tools: a floating card of controls for every field of the course's look (see its README)
- `trees/`: the Trees editor: four tools (select, add tree, clear, erase) that work on the map and in 3D, a floating card for how each woods patch is planted, and the overlays that show the patches and clearings (see its README)
  - `course/` also has the **Path** tool (`pathTool.ts`: the freehand interaction with a live preview of the finished width and curve; the outline maths is `core/geometry/pathShape.ts`) and the **Collar** button (`model/design/collar.ts`), which ring a green with a collar region tucked under it. A selected path's width can be changed afterwards with the Select tool's **Path width** slider (`model/design/pathWidth.ts`: it offsets the whole outline in or out, from the outline as the drag began).
- `_shared/`: what more than one editor uses (polygon tools, freehand drawing, hole navigation)

## Rules

- An editor imports from `_shared/`, never from another editor.
- An editor builds its own commands and passes them up; `commands/` does not know about editors.
- Adding an editor touches its own folder and `registry.ts`.
