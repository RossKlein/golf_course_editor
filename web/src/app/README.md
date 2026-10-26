# `src/app`

## Purpose

The top of the graph: `App.tsx` puts the shell, the views and the active editor together, owns what is open, and builds the command list. `main.tsx` (in `src/`) mounts it and offers `checkShaders()` in the console.

## Does not belong here

- Logic another layer could own: a new feature starts in its own layer, and `App` only wires it in
- Anything another folder imports. Nothing imports from `app/`.

## Rule of the layers

A folder may import only from folders earlier in this list; `src/architecture.test.ts` fails the build otherwise:
`core`, `gfx`, `terrain` and `model` (siblings: neither imports the other), `commands`, `scene`, `ui`, `views`, `editors`, `shell`, `app`. `core`, `gfx` and `terrain` also import no UI package, so the game can reuse them. See `docs/frontend-architecture.md`.
