import type { ReactNode } from "react";
import { Collapsible } from "radix-ui";
import { ChevronDown, ChevronRight } from "lucide-react";

type Props = {
  title: string;
  /** Open to start with (default). */
  defaultOpen?: boolean;
  /** Buttons at the right of the heading, such as "Reset". */
  actions?: ReactNode;
  children: ReactNode;
};

/** A heading that folds its contents away. */
export default function Section({ title, defaultOpen = true, actions, children }: Props) {
  return (
    <Collapsible.Root className="section" defaultOpen={defaultOpen}>
      <div className="section-head">
        <Collapsible.Trigger className="section-title">
          <ChevronRight size={14} className="closed-icon" />
          <ChevronDown size={14} className="open-icon" />
          {title}
        </Collapsible.Trigger>
        {actions && <div className="section-actions">{actions}</div>}
      </div>
      <Collapsible.Content className="section-body">{children}</Collapsible.Content>
    </Collapsible.Root>
  );
}
