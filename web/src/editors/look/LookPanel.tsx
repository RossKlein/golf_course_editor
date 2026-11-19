import WaterTab from "./WaterTab";
import type { TerrainSource } from "../../scene/scene";
import { useState } from "react";
import { Tabs } from "radix-ui";
import FloatingCard from "../../ui/FloatingCard";
import { useLookEditing } from "../../scene/useLookEditing";
import { useLookSession } from "../../scene/lookSession";
import GrassTab from "./GrassTab";
import LightTab from "./LightTab";
import SkySunTab from "./SkySunTab";
import SurfacesTab from "./SurfacesTab";
import TreesTab from "./TreesTab";

const TABS = [
  { id: "sky", label: "Sky & sun" },
  { id: "surfaces", label: "Surfaces" },
  { id: "grass", label: "Grass" },
  { id: "light", label: "Light" },
  { id: "trees", label: "Trees" },
  { id: "water", label: "Water" },
  { id: "viewer", label: "Viewer" },
] as const;
type TabId = (typeof TABS)[number]["id"];

type Props = {
  terrain?: TerrainSource;
  /** Where the Terrain3D view puts its own sliders (grass range, shadow quality) while this panel is open: the Viewer tab. */
  onViewerHost: (host: HTMLElement | null) => void;
  /** The 3D view is showing; the look is only seen there. */
  view3d: boolean;
  /** The open tab, kept in the editor's saved state so the panel opens where it was left (one that is not a tab here is the first). */
  tab: string;
  onTab: (tab: TabId) => void;
};

/** The look editor: a floating card over the 3D view with a tab for each part of the course's look. */
export default function LookPanel({ onViewerHost, view3d, tab: savedTab, onTab, terrain }: Props) {
  const editing = useLookEditing();
  const { status } = useLookSession();
  const [collapsed, setCollapsed] = useState(false);
  const tab: TabId = TABS.find((t) => t.id === savedTab)?.id ?? "sky";
  const [surface, setSurface] = useState("fairway");
  const [kind, setKind] = useState(0);

  const state = status.error ? { text: `Couldn't save: ${status.error}`, bad: true } : status.phase === "updating" ? { text: "Updating…" } : status.phase === "pending" ? { text: "Edited…" } : { text: "Saved" };

  return (
    <FloatingCard
      title="Look"
      collapsed={collapsed}
      onCollapsedChange={setCollapsed}
      status={<span className={state.bad ? "bad" : undefined} title={state.text}>{state.text}</span>}
      header={
        <Tabs.Root value={tab} onValueChange={(v) => onTab(v as TabId)}>
          <Tabs.List className="float-tabs" aria-label="Look">
            {TABS.map((t) => (
              <Tabs.Trigger key={t.id} value={t.id}>
                {t.label}
              </Tabs.Trigger>
            ))}
          </Tabs.List>
        </Tabs.Root>
      }
    >
      {!view3d && <p className="muted">The look shows on the 3D view. Press <kbd>3</kbd> to open it.</p>}
      {!editing.look ? (
        <p className="muted">Open a bundle to edit its look.</p>
      ) : (
        <>
          {tab === "sky" && <SkySunTab editing={editing} />}
          {tab === "surfaces" && <SurfacesTab editing={editing} selected={surface} onSelect={setSurface} />}
          {tab === "grass" && <GrassTab editing={editing} />}
          {tab === "light" && <LightTab editing={editing} />}
          {tab === "water" && terrain && <WaterTab editing={editing} terrain={terrain} />}
          {tab === "trees" && <TreesTab editing={editing} kind={kind} onKind={setKind} />}
        </>
      )}
      {tab === "viewer" && (
        <>
          <p className="muted">How this window draws the course. These are yours, not the course's, so they are not saved with it.</p>
          <div className="v3-fields" ref={onViewerHost} />
        </>
      )}
    </FloatingCard>
  );
}
