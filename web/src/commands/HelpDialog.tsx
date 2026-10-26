import { Dialog } from "radix-ui";
import { formatKey, type Command, type Scope } from "./keymap";

const scopeTitle = (s: Scope) =>
  s === "global" ? "Everywhere" : s.startsWith("editor:") ? `${s.slice(7)} editor` : `${s.slice(5).replace("/", " editor, ")} tool`;

/** Every shortcut, generated from the command registry, so it cannot go out of date. */
export default function HelpDialog({ commands, open, onOpenChange }: { commands: Command[]; open: boolean; onOpenChange: (open: boolean) => void }) {
  const visible = commands.filter((c) => !c.hidden);
  const scopes = [...new Set(visible.map((c) => c.scope))].sort((a, b) => (a === "global" ? -1 : b === "global" ? 1 : a.localeCompare(b)));
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className="dialog" aria-describedby={undefined}>
          <Dialog.Title>Keyboard shortcuts</Dialog.Title>
          <div className="help-grid">
            {scopes.map((scope) => {
              const inScope = visible.filter((c) => c.scope === scope);
              const groups = [...new Set(inScope.map((c) => c.group ?? ""))];
              return (
                <section key={scope}>
                  <h3>{scopeTitle(scope)}</h3>
                  {groups.map((g) => (
                    <div key={g}>
                      {g && <h4>{g}</h4>}
                      <dl>
                        {inScope.filter((c) => (c.group ?? "") === g).map((c) => (
                          <div key={c.id}>
                            <dt>{c.label}</dt>
                            <dd>{c.keys.slice(0, 3).map((k) => <kbd key={k}>{formatKey(k)}</kbd>)}</dd>
                          </div>
                        ))}
                      </dl>
                    </div>
                  ))}
                </section>
              );
            })}
          </div>
          <Dialog.Close className="dialog-close" aria-label="Close">Close (Esc)</Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
