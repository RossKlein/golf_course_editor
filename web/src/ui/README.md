# `src/ui`

## Purpose

Small pieces of interface with no knowledge of the course or the editors, used across the app.

## Belongs here

- `Hint.tsx`: key caps (`Kbd`) and tooltips that show a command's shortcut
- `useUnits.ts`: the US or metric preference, kept in this browser

## Does not belong here

- Anything that reads a scene, the design or an editor's state (`views/`, `shell/`)
- Panels with course content
