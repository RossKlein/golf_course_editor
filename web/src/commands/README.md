# `src/commands`

## Purpose

Keyboard shortcuts: the command and scope types, the keymap, the hotkey hook and the help dialog. It knows nothing about any editor; editors hand it their commands.

## Belongs here

- `keymap.ts`: `Command`, `Scope` (`global` < `editor:<id>` < `tool:<editor>/<tool>`), building the keymap
- `useHotkeys.ts`: attaching the active commands to the window (tinykeys)
- `globalCommands.ts`: the commands that work everywhere; it is given the list of editors to offer jumping to
- `HelpDialog.tsx`: the shortcut list, generated from the commands

## Does not belong here

- An editor's own commands: they are built by that editor and passed in
- Anything that imports from `editors/`

## Rules

- A shortcut is declared once, on the command, and the help dialog reads it from there.
- Typed text fields are ignored by the keymap (`ignoreKeydown`).
