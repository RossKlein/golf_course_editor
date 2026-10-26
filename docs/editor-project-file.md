# The editor project file

Status: built (editor.json, project.json, replace-bake). Decisions made with the plan: folder name `.course_maker/`;
`project.json` included now; replace builds a new bundle beside the old one instead of deleting it; TIF view
persistence and versioning of project files are deferred.

## Goal

Everything about how you are working on a course is saved with the course and restored when you reopen it: which
layers are on and how opaque, the relief setting, the selected hole, exactly where the map was panned and zoomed,
and later the active tool, brush and snapping. Like `.vscode/` next to a project, it lives in a hidden folder
inside the bundle and is written automatically as you work. There is no save button.

## Layout

```
bundles/augusta/
  course.json  height.png  class.png  bounds.png  trees.bin  patches/   <- the game bundle (the format spec)
  .course_maker/
    editor.json      UI state: view, layers, selections, tool settings. Per user, safe to delete.
    project.json     Durable settings that reproduce the bundle: source stack, bake settings. Worth versioning.
    .gitignore       contains "editor.json", so UI state is never committed
    annotations/     (later slice) the editable source of the painted data; reserved, not part of this plan
```

The rule that keeps this safe: **the game bundle is complete without `.course_maker/`**. The game only fetches the
files `course.json` names, so the folder is inert to the game. `editor.json` is never needed to rebuild anything.

`project.json` replaces `bundles/augusta.source.json`, the sidecar added with the bake. That also fixes a latent
bug: the sidecar stores a Windows path (`..\augusta\course_stack.tif`), which would not resolve on other systems.
`project.json` uses forward slashes.

## What is saved

### `editor.json` (UI state)

| Field | Meaning |
| --- | --- |
| `version` | `1`. On any other value the file is treated as unreadable and reset (pre-production, no migrations). |
| `viewport` | `{x, z, scale}`: the map centre in course metres and pixels per metre. Absent means "fit". |
| `layers` | `{layerId: {visible, opacity}}`. Layer ids are the stable ones the scene builders define (`aerial`, `hillshade`, `class`, `owner`, `bounds`, `patches`, `trees`, `routes`, `landmarks`). |
| `exaggeration` | Relief exaggeration, 1 to 10. |
| `hole` | Hole selected for the out-of-bounds layer, and later the hole being edited. |
| later | Active tool, class brush, brush size, smoothing, snapping, grid. They join the same file as fields. |

Not saved: the cursor position and readout, loading status, anything derived from the files. The hover point and
other transient things stay out.

### `project.json` (durable)

| Field | Meaning |
| --- | --- |
| `stack` | Source `course_stack.tif`, relative to the bundle folder, with forward slashes. |
| `bake` | Name, attribution and the settings used by the last bake (edge margin), so a re-bake reproduces it. |

Annotation geometry (surface polygons, hole routes, ownership, bounds, patch regions, landmark placement) will be
saved as separate files under `annotations/` when the editor slice starts. That decision is not part of this plan.

## Behaviour

- **Strict on write, forgiving on read.** Writes are validated by the pydantic model. On read, unknown keys are
  ignored, and a section that does not validate falls back to its defaults. A broken file never blocks opening a
  bundle. If the whole file is unreadable it is renamed to `editor.json.bad` (never silently destroyed) and
  defaults are used.
- **Apply over the scene's own defaults.** The scene decides which layers exist and their defaults. Saved layer
  ids the scene does not have are dropped, and layers missing from the file keep their defaults, so new layers
  appear normally in old projects.
- **Autosave.** A trailing debounce of about 600 ms after the last change, a flush when the tab is hidden or
  closed (`fetch` with `keepalive`), and no request when nothing changed. A small "Saved / Saving… / Couldn't
  save" indicator in the panel. A failed save never interrupts editing, and the next change retries.
- **Atomic writes.** Write to a temporary file in `.course_maker/` and `os.replace`, so a crash cannot leave half a
  file.
- **One user, one machine.** Two tabs on the same bundle: last write wins. Not worth a locking scheme here.
- **Viewport.** Restored on open instead of fitting, and the F key still fits. The view is saved as a centre and
  scale, not pixel offsets, so it survives a different window size.

## API

New endpoints, all keyed by the bundle's data-relative path like the existing ones:

- `GET /api/bundle/editor?path=` returns `{state, status}` where status is `default`, `loaded` or `reset`.
- `PUT /api/bundle/editor?path=` validates the body as `EditorState`, writes it atomically, returns 204. The model
  bounds the body (at most 64 layers, ids up to 64 characters). It writes only the fixed file name, so the path
  cannot be steered anywhere else.

Existing code that must change:

1. **Replace never deletes the bundle first.** (It used to `rmtree` the folder, which would have wiped
   `.course_maker/` and later the annotations.) Now the new bundle is built in a sibling `<name>.baking` folder, the
   old `.course_maker/` is copied into it, `project.json` is refreshed, the result is validated, and only then does
   it replace the old folder (which waits briefly as `<name>.replaced`, and is put back if the move fails). Any
   failure leaves the old bundle untouched. The server API field is `replace`; the CLI flag is `--replace`.
2. **`/files/...` serves any `.json` inside a bundle**, which would expose `.course_maker/editor.json`. It should
   refuse any path with a dot-prefixed segment.
3. **Validator and index** already ignore unknown files. The validator can warn on unexpected non-hidden files.
4. **Export.** Because a bundle folder now also holds authoring files, add `course_maker export <bundle> --out
   <dir>`, which copies only the files `course.json` references (after validating). That is what gets deployed to
   the game. Not needed for editor.json itself, but it should land before anything is shipped from a bundle folder.

## Web

Today the editor's state is scattered: `layerState` and `params` in `App`, and the view inside `MapView`. The
work is to make it one `EditorState` object:

- A store (context plus reducer) holding the state, with a pure `mergeSaved(sceneDefaults, saved)` function that
  does the apply-over-defaults rules above.
- `useEditorPersistence(bundle)`: loads on open, debounces and flushes saves, reports status.
- `MapView` gets an initial viewport and an `onViewChange` callback (throttled so panning does not spam saves).
- Types come from the pydantic models through OpenAPI like the rest.

GeoTIFF views have no bundle to attach to, so they are not persisted in this plan (see question 2).

## Status

Built as planned, in this order: server models and endpoints, replace-bake and `project.json`, the web store and
autosave, then a browser check on the real Augusta bundle (layers, opacity, exaggeration and zoom saved and restored
after a reload; a corrupt file reset and kept as `.bad`; a replace-bake preserving the state).

Tests: `course_maker/tests/test_project.py` (store, tolerant read, atomic write, replace safety including failure
injection), `test_server.py` (endpoints, dot-path refusal, index), `web/src/scene/editorState/editorState.test.ts`
(`mergeSaved`, serialisation, viewport round trip).

## Still open

1. **GeoTIFF views** do not remember their view or layers. A small app-level `.course_maker/workspace.json` at the
   data root, keyed by TIF path and holding the last-opened item, is the intended follow-up.
2. **Versioning.** `bundles/` is gitignored because it is generated. `project.json` and the future annotations are
   source and will need tracking. Deferred.
3. **Export** (`course_maker export`), so deploys copy only the files `course.json` names. Needed before shipping
   from a bundle folder.
