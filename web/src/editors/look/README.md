# `src/editors/look`

## Purpose

The Look editor: a card floating over the 3D view with a control for every field of the course's look (`course.json` → `look`), so a colour, a light or a tree can be changed and seen on the course. It has no map tools, so unlike the other editors it is a panel, not a hook. The plan, and the sequence a change goes through, are in `docs/look-editor-plan.md`.

## Belongs here

- `LookPanel.tsx`: the card and its tabs (Sky & sun, Surfaces, Grass, Light, Trees, Viewer). The Viewer tab holds the 3D view's own sliders, which `Terrain3D` puts there while this editor is open
- `lookSchema.ts`: one entry per field of the look, with the control it gets. Ranges are read from the API schema (`web/openapi.json`, generated from the pydantic models), not written here; `lookSchema.test.ts` fails when the model has a field with no control
- `FieldView.tsx`: draws any field from its entry and writes it back through `useLookEditing`
- one file for each tab

## Does not belong here

- Rendering, or what a change costs the renderer (`terrain/look/diff.ts`)
- When a change is applied and saved (`scene/lookApplier.ts`)
- Generic controls (`ui/`)

## Rules

- A control never touches the renderer or the server. It changes the look in the design store through `useLookEditing`, and the course follows.
- A drag is one undo step: `onStart` begins it and `onFinish` ends it. A single event (a pick, a switch, a button) changes the look and finishes at once.
- A new field in `models.py` needs a control here: regenerate the types (`python -m course_maker openapi`, `npm run types`) and the completeness test says which.
