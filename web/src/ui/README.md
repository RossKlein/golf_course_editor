# `src/ui`

## Purpose

Small pieces of interface with no knowledge of the course or the editors, used across the app.

## Belongs here

- `Hint.tsx`: key caps (`Kbd`) and tooltips that show a command's shortcut
- `SliderField.tsx`, `ColorField.tsx`, `SelectField.tsx`, `ToggleField.tsx`: labelled form controls. Each reports three moments of an edit, `onStart` (the hand went down), `onChange` (the value moved) and `onFinish` (the hand let go, Enter, or the box was left), so a caller can make a drag one undo step and apply it when it is done. A dot beside the label shows a value that is not the default
- `Section.tsx`, `FloatingCard.tsx`: a heading that folds, and a panel that floats over the view it sits in
- `useUnits.ts`: the US or metric preference, kept in this browser

## Does not belong here

- Anything that reads a scene, the design or an editor's state (`views/`, `shell/`)
- Panels with course content
