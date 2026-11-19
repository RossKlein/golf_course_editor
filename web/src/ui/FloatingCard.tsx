import type { ReactNode } from "react";
import { PanelRightClose, PanelRightOpen } from "lucide-react";

type Props = {
  title: string;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  /** A line under the title, such as the state of saving. */
  status?: ReactNode;
  /** Tabs, or anything that stays in view above the scrolling body. */
  header?: ReactNode;
  children: ReactNode;
};

/**
 * A panel that floats over the view it sits in, inset from its edges, so the view shows around it. It is as wide as `--card-width`
 * (a share of the view, between limits) and as tall as the view less its margin; the body scrolls. Collapsed, it is just its title.
 * The view must be a positioned element.
 */
export default function FloatingCard({ title, collapsed, onCollapsedChange, status, header, children }: Props) {
  return (
    <aside className={collapsed ? "float-card collapsed" : "float-card"} aria-label={title}>
      <div className="float-head">
        <h2>{title}</h2>
        {status && <div className="float-status">{status}</div>}
        <button type="button" className="icon" aria-label={collapsed ? `Show ${title}` : `Hide ${title}`} title={collapsed ? `Show ${title}` : `Hide ${title}`} onClick={() => onCollapsedChange(!collapsed)}>
          {collapsed ? <PanelRightOpen size={16} /> : <PanelRightClose size={16} />}
        </button>
      </div>
      {!collapsed && header}
      {!collapsed && <div className="float-body">{children}</div>}
    </aside>
  );
}
