import { useState } from "react";
import { Trash2 } from "lucide-react";
import type { BuildStatus, Landmark, TreeKind } from "../../core/api/api";
import { hasOwnForest, isWoods, removePlacedTree, resetForest, updatePlacedTree } from "../../model/design/forest";
import { designStore, useDesign } from "../../model/design/store";
import FloatingCard from "../../ui/FloatingCard";
import SelectField from "../../ui/SelectField";
import Section from "../../ui/Section";
import SliderField from "../../ui/SliderField";
import ToggleField from "../../ui/ToggleField";
import { about, estimateTotal, MAX_TREES } from "./estimate";
import PatchFields from "./PatchFields";
import { useTreesUi, treesUi } from "./treesUi";

type Props = {
  build: BuildStatus | null;
  kinds: readonly TreeKind[];
  landmarks: readonly Landmark[];
  /** Save the design and build now. */
  requestBuild: () => void;
};

const MIX = "mix";

/** The Trees editor's card: how the selected woods patches are planted, the woods defaults, the next placed tree, and the clearings. */
export default function TreesPanel({ build, kinds, landmarks, requestBuild }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const doc = useDesign((s) => s.doc);
  const selected = useDesign((s) => s.selected);
  const ui = useTreesUi((s) => s);

  const patches = selected.filter((id) => doc.regions[id] && isWoods(doc.regions[id]));
  const own = patches.some((id) => hasOwnForest(doc, id));
  const tree = ui.selectedTree !== null ? doc.trees.added[ui.selectedTree] : undefined;
  const total = estimateTotal(doc);

  const status = build?.state === "building" ? "Building…" : build?.state === "failed" ? `Build failed: ${build.error}` : build?.trees !== undefined && build.id ? `${build.trees.toLocaleString()} trees` : "";
  const kindOptions = [{ value: MIX, label: "From the patch's mix" }, ...kinds.map((k, i) => ({ value: String(i), label: k.name }))];
  const indexOptions = kinds.map((k, i) => ({ value: String(i), label: k.name }));

  return (
    <FloatingCard title="Trees" collapsed={collapsed} onCollapsedChange={setCollapsed} status={<span className={build?.state === "failed" ? "bad" : undefined}>{status}</span>}>
      <Section
        title={patches.length > 1 ? `${patches.length} woods patches` : "Woods patch"}
        actions={own && <button type="button" title="Plant these patches with the woods defaults again" onClick={() => { for (const id of patches) resetForest("Use the woods defaults", id); requestBuild(); }}>Use defaults</button>}
      >
        {patches.length ? (
          <>
            {!own && <p className="muted">These use the woods defaults. Changing a setting here gives them settings of their own.</p>}
            <PatchFields ids={patches} kinds={kinds} onFinish={requestBuild} />
          </>
        ) : (
          <p className="muted">Pick a woods patch with the Select tool (<kbd>S</kbd>) to set how it is planted. Surfaces other than woods grow no forest.</p>
        )}
      </Section>

      <Section title="Woods defaults" defaultOpen={patches.length === 0}>
        <p className="muted">For every woods patch that has no settings of its own.</p>
        <PatchFields ids={null} kinds={kinds} onFinish={requestBuild} />
      </Section>

      <Section title="Placed trees">
        <p className="muted">Trees you plant by hand are ordinary trees. The forest keeps clear of their crowns.</p>
        <SelectField
          label="The next tree"
          value={ui.addKind === "mix" ? MIX : String(ui.addKind)}
          options={kindOptions}
          onChange={(v) => treesUi.getState().set({ addKind: v === MIX ? "mix" : Number(v) })}
        />
        <ToggleField label="Its model's typical height" checked={ui.addHeight === null} onChange={(c) => treesUi.getState().set({ addHeight: c ? null : 15 })} />
        {ui.addHeight !== null && <SliderField label="Height (m)" value={ui.addHeight} min={1} max={40} step={0.5} onChange={(v) => treesUi.getState().set({ addHeight: v })} />}

        {tree && ui.selectedTree !== null && (
          <div className="subcard">
            <div className="subcard-head">
              <strong>Selected tree</strong>
              <button
                type="button"
                className="icon"
                title="Delete this tree"
                aria-label="Delete the selected tree"
                onClick={() => {
                  removePlacedTree("Delete tree", ui.selectedTree!);
                  treesUi.getState().set({ selectedTree: null });
                  requestBuild();
                }}
              >
                <Trash2 size={14} />
              </button>
            </div>
            <SelectField
              label="Model"
              value={String(Math.min(tree.kind, Math.max(0, kinds.length - 1)))}
              options={indexOptions}
              onChange={(v) => updatePlacedTree("Change tree model", ui.selectedTree!, { kind: Number(v) })}
              onFinish={requestBuild}
            />
            <SliderField
              label="Height (m)"
              value={tree.height}
              min={1}
              max={60}
              step={0.5}
              onStart={() => designStore.getState().begin("Change tree height")}
              onChange={(v) => updatePlacedTree("Change tree height", ui.selectedTree!, { height: v })}
              onFinish={() => {
                designStore.getState().end();
                requestBuild();
              }}
            />
          </div>
        )}
      </Section>

      <Section title="Clearings">
        <ToggleField label="Show clearings on the map" checked={ui.showClearings} onChange={(c) => treesUi.getState().set({ showClearings: c })} title="Dashed circles are worked out from placed trees and landmarks; red ones were drawn by hand" />
        <p className="muted">
          {doc.trees.added.length} around placed trees, {landmarks.length} around landmarks (worked out, never stored), {doc.trees.removed.length} drawn by hand. A hole's line of play is never cleared for you.
        </p>
        <button
          type="button"
          disabled={!doc.trees.removed.length}
          onClick={() => {
            designStore.getState().commit("Remove hand-drawn clearings", (d) => void (d.trees.removed = []));
            requestBuild();
          }}
        >
          Remove the {doc.trees.removed.length} drawn by hand
        </button>
      </Section>

      <p className={total > MAX_TREES * 0.8 ? "muted warn" : "muted"}>
        {about(total)} in all{total > MAX_TREES ? `: over the limit of ${MAX_TREES.toLocaleString()}, so every patch will be thinned` : total > MAX_TREES * 0.8 ? `, near the limit of ${MAX_TREES.toLocaleString()}` : ""}.
      </p>
    </FloatingCard>
  );
}
