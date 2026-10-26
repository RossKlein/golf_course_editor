import type { ReactNode } from "react";
import { Tooltip } from "radix-ui";
import { formatKey } from "../commands/keymap";

export function Kbd({ keys }: { keys: string[] }) {
  return (
    <>
      {keys.map((k) => (
        <kbd key={k}>{formatKey(k)}</kbd>
      ))}
    </>
  );
}

/** A tooltip with the command's name and its shortcut. */
export function Hint({ label, keys, children }: { label: string; keys?: string[]; children: ReactNode }) {
  return (
    <Tooltip.Root delayDuration={350}>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className="tip" sideOffset={6}>
          {label}
          {keys?.length ? <Kbd keys={keys.slice(0, 2)} /> : null}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
