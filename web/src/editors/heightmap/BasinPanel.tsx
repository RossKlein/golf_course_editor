import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { designStore, useDesign } from "../../model/design/store";
import { editLook } from "../../model/look/edit";
import type { TerrainSource } from "../../scene/scene";
import type { BasinEdit } from "../../scene/heightSession";
import { BASIN_LIMITS, DEFAULT_BASIN, type BasinParams } from "../../terrain/sculpt/basin";
import FloatingCard from "../../ui/FloatingCard";
import SelectField from "../../ui/SelectField";
import Section from "../../ui/Section";
import SliderField from "../../ui/SliderField";

const LABEL = "Lake basin";
/** A basin this much taller or deeper than the ground is a change worth a second look: the outline is probably on a slope. */
const BIG_CUT = 3;

/** The settings last used, kept while the tool is off so a second lake starts where the first left off. */
let remembered: BasinParams = DEFAULT_BASIN;

type Slider = { key: keyof BasinParams; label: string; step: number; title: string };
const SLIDERS: Slider[] = [
  { key: "depth", label: "Depth (m)", step: 0.05, title: "How far below the water the bed lies, away from the shore" },
  { key: "bedWidth", label: "Shore slope: bed width (m)", step: 0.5, title: "How far from the waterline the bed takes to reach its depth. Wider is a gentler shore" },
  { key: "shift", label: "Waterline shift (m)", step: 0.05, title: "Moves the waterline inside the painted outline (negative: out past it), to meet where the water is drawn. The outline's edge is smoothed when drawn, so it can need a little" },
  { key: "bankRise", label: "Bank lip (m)", step: 0.01, title: "How high the bank stands above the water part way up: a lip along the shore. 0 for none" },
  { key: "bankWidth", label: "Bank width (m)", step: 0.5, title: "How far from the waterline the ground is cut to meet it before it is left as it was. Wider is gentler, and a lake on a slope needs a wide one" },
  { key: "detail", label: "Bank detail", step: 0.05, title: "How much of the natural ground's small bumps the bank keeps: 0 is smooth, 1 is all of them" },
];

const signed = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}`;

/**
 * The Lake basin tool's card: which lake, and how its bed and banks are cut. The ground is shown cut as the settings change; Apply keeps it
 * (one undo step) and fixes the lake's surface at the level it was cut for, so the water cannot drift off the basin when the heights change.
 */
export default function BasinPanel({ terrain }: { terrain: TerrainSource }) {
  const session = terrain.sculpt;
  const mesh = useSyncExternalStore(terrain.watch, () => terrain.renderer.waterData);
  const [collapsed, setCollapsed] = useState(false);
  const [selected, setSelected] = useState("");
  const [params, setParams] = useState<BasinParams>(remembered);
  const [phase, setPhase] = useState<"editing" | "applied">("editing");
  const [stats, setStats] = useState<BasinEdit["stats"]>(null);
  const [moved, setMoved] = useState<{ up: number; down: number } | null>(null);
  const edit = useRef<BasinEdit | null>(null);
  const current = useRef(params);

  const lake = mesh?.lakes.find((l) => l.id === selected) ?? mesh?.lakes[0];
  const settings = useDesign((s) => (lake ? s.doc.look?.water.lakes[lake.id] : undefined));
  const [id, level] = [lake?.id, lake?.level];
  const [ax, az] = lake?.anchor ?? [0, 0];

  // begin a basin on the lake, shown on the ground at once; leaving it, or picking another lake, puts the ground back unless it was applied
  useEffect(() => {
    if (!session || phase !== "editing" || id === undefined || level === undefined) return;
    const e = session.basin([ax, az], level);
    edit.current = e;
    setStats(e?.stats ?? null);
    setMoved(e ? e.preview(current.current) : null);
    return () => {
      e?.cancel();
      if (edit.current === e) edit.current = null;
    };
  }, [session, id, ax, az, level, phase]);

  const change = (next: BasinParams) => {
    current.current = next;
    remembered = next;
    setParams(next);
    if (edit.current) setMoved(edit.current.preview(next));
  };

  const apply = () => {
    if (!lake || !edit.current) return;
    if (settings?.level !== lake.level || settings.offset !== 0) {
      // pinned first, so the basin is the last undo step and "Adjust" can take it back
      editLook("Fix lake level", (look) => {
        const was = look.water.lakes[lake.id];
        look.water.lakes[lake.id] = { ...was, anchor: lake.anchor, level: lake.level, offset: 0, curvature: was?.curvature ?? 0, excess: was?.excess ?? 0 };
      });
    }
    if (edit.current.commit(LABEL)) setPhase("applied");
  };

  const adjust = () => {
    const { past, undo } = designStore.getState();
    if (past[past.length - 1]?.label === LABEL) undo();
    setPhase("editing");
  };

  if (!session) return null;
  const big = moved && Math.max(moved.up, moved.down) > BIG_CUT;
  const spread = stats ? stats.high - stats.low : 0;
  return (
    <FloatingCard title="Lake basin" collapsed={collapsed} onCollapsedChange={setCollapsed} status={phase === "applied" ? "Applied" : undefined}>
      <Section title="Lake">
        {!mesh?.lakes.length || !lake ? (
          <p className="muted">There is no lake in this course. Paint a water surface with the Course editor first.</p>
        ) : (
          <>
            <SelectField
              label="Lake"
              value={lake.id}
              options={mesh.lakes.map((l, i) => ({ value: l.id, label: `Lake ${i + 1} (${l.anchor.map((v) => v.toFixed(0)).join(", ")} m)` }))}
              onChange={(v) => {
                setSelected(v);
                setPhase("editing");
              }}
            />
            <p className="muted">
              Water surface {lake.level.toFixed(2)} m. Change it in Look &rsaquo; Water; applying the basin fixes it there.
              {settings?.curvature ? " This lake follows its shore a little, so its surface is not quite flat: the basin is cut for its level." : ""}
            </p>
            {stats && (
              <p className="muted">
                Natural ground at the outline: {signed(stats.low)} to {signed(stats.high)} m about the water (median {signed(stats.mid)}).
                {spread > 2 ? " That is a lot: the outline is on a slope, and the bank has to cut into it. Widen the bank, or move the outline." : ""}
              </p>
            )}
          </>
        )}
      </Section>

      {lake && (
        <Section title="Basin">
          {SLIDERS.map((s) => (
            <SliderField
              key={s.key}
              label={s.label}
              title={s.title}
              value={params[s.key]}
              min={BASIN_LIMITS[s.key][0]}
              max={BASIN_LIMITS[s.key][1]}
              step={s.step}
              defaultValue={DEFAULT_BASIN[s.key]}
              onReset={() => change({ ...current.current, [s.key]: DEFAULT_BASIN[s.key] })}
              onChange={(v) => change({ ...current.current, [s.key]: v })}
              disabled={phase === "applied"}
            />
          ))}
          {moved && phase === "editing" && (
            <p className={big ? "bad" : "muted"}>
              Raises the ground by up to {moved.up.toFixed(2)} m and lowers it by up to {moved.down.toFixed(2)} m.
              {big ? " That is a big cut." : ""}
            </p>
          )}
          {phase === "editing" ? (
            <>
              <p className="muted">Shown on the ground now. Nothing is kept until you apply it; leaving the tool puts the ground back.</p>
              <div className="row">
                <button type="button" onClick={apply} disabled={!edit.current}>Apply</button>
                <button type="button" onClick={() => change({ ...DEFAULT_BASIN })}>Reset settings</button>
              </div>
            </>
          ) : (
            <>
              <p className="muted">Applied, and saved with the terrain. Undo (<kbd>Ctrl</kbd>+<kbd>Z</kbd>) takes it back.</p>
              <button type="button" onClick={adjust}>Undo and adjust</button>
            </>
          )}
        </Section>
      )}
    </FloatingCard>
  );
}
