import { useEffect, useRef, useState } from "react";
import { designStore } from "../../model/design/store";
import type { TerrainSource } from "../../scene/scene";
import type { TrapEdit } from "../../scene/heightSession";
import { DEFAULT_TRAP, TRAP_LIMITS, TRAP_PRESETS, presetFor, type TrapInfo, type TrapParams } from "../../terrain/sculpt/trap";
import FloatingCard from "../../ui/FloatingCard";
import Section from "../../ui/Section";
import SliderField from "../../ui/SliderField";
import ToggleField from "../../ui/ToggleField";
import { useTrapUi } from "./trapUi";

const LABEL = "Sand trap";

/** The settings last used, kept while the tool is off so the next bunker starts where the last left off. */
let remembered: TrapParams = DEFAULT_TRAP;

type Numbers = Exclude<keyof TrapParams, "level">;
type Slider = { key: Numbers; label: string; step: number; title: string; format?: (v: number) => string };

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const compass = (deg: number) => `${Math.round(deg)}° ${COMPASS[Math.round(deg / 45) % 8]}`;

const SHAPE: Slider[] = [
  { key: "depth", label: "Depth (m)", step: 0.05, title: "How far below the rim the floor lies, at its deepest" },
  { key: "wall", label: "Wall width (m)", step: 0.1, title: "How far in from the edge the ground takes to reach the floor. As wide as the bunker is a round bowl; narrow is a flat floor with steep sides; in a long thin bunker it makes a trough" },
  { key: "shape", label: "Wall curve", step: 0.05, title: "Below 1 the sides drop quickly and the floor is flat; above 1 they ease in and the floor is round" },
];
const FLOOR: Slider[] = [
  { key: "tilt", label: "Tilt (m)", step: 0.05, title: "How much deeper the floor is on the side the bunker faces than on the other" },
  { key: "rough", label: "Roughness (m)", step: 0.01, title: "How much the floor is roughened by bumps and hollows, so it is not smooth" },
  { key: "roughSize", label: "Bump size (m)", step: 0.1, title: "How big the bumps are across" },
];
const RIM: Slider[] = [
  { key: "lip", label: "Lip height (m)", step: 0.01, title: "How high the rim stands above the ground round it, all the way round. 0 for none" },
  { key: "lipWidth", label: "Lip width (m)", step: 0.25, title: "How far out from the edge the lip gives way to the natural ground" },
  { key: "face", label: "Face height (m)", step: 0.01, title: "How much higher the lip stands on the side the bunker faces: the face of a greenside bunker" },
  { key: "detail", label: "Bank detail", step: 0.05, title: "How much of the natural ground's small bumps the lip keeps: 0 is smooth, 1 is all of them" },
];
const CHARACTER: Slider[] = [
  { key: "facing", label: "Facing", step: 5, title: "The way the bunker faces, towards its green: the floor is deeper and the lip higher on this side. Degrees clockwise from north", format: compass },
  { key: "wobble", label: "Edge wobble (m)", step: 0.05, title: "How far noise pushes the edge about, so the sides are not the same all the way round" },
];

/**
 * The Sand trap tool's card: the bunker that was picked, and how the ground inside it is shaped. The shape is shown on the ground as the
 * settings change; Apply keeps it (one undo step). Then the ordinary brushes finish it.
 */
export default function TrapPanel({ terrain }: { terrain: TerrainSource }) {
  const session = terrain.sculpt;
  const anchor = useTrapUi((s) => s.anchor);
  const [collapsed, setCollapsed] = useState(false);
  const [params, setParams] = useState<TrapParams>(remembered);
  const [phase, setPhase] = useState<"editing" | "applied">("editing");
  const [info, setInfo] = useState<TrapInfo | null>(null);
  const [moved, setMoved] = useState<{ up: number; down: number } | null>(null);
  const [missing, setMissing] = useState(false);
  const edit = useRef<TrapEdit | null>(null);
  const current = useRef(params);
  const [x, z] = anchor ?? [0, 0];
  const picked = anchor !== null;

  // a different bunker starts afresh
  useEffect(() => setPhase("editing"), [x, z]);

  // begin a trap on the bunker, shown on the ground at once; leaving it, or picking another bunker, puts the ground back unless it was applied
  useEffect(() => {
    if (!session || !picked || phase !== "editing") return;
    const e = session.trap([x, z]);
    edit.current = e;
    setMissing(!e);
    setInfo(e?.info ?? null);
    setMoved(e ? e.preview(current.current) : null);
    return () => {
      e?.cancel();
      if (edit.current === e) edit.current = null;
    };
  }, [session, picked, x, z, phase]);

  const change = (next: TrapParams) => {
    current.current = next;
    remembered = next;
    setParams(next);
    if (edit.current) setMoved(edit.current.preview(next));
  };

  const apply = () => {
    if (edit.current?.commit(LABEL)) setPhase("applied");
  };

  const adjust = () => {
    const { past, undo } = designStore.getState();
    if (past[past.length - 1]?.label === LABEL) undo();
    setPhase("editing");
  };

  if (!session) return null;
  const disabled = phase === "applied";
  const slider = (s: Slider) => (
    <SliderField
      key={s.key}
      label={s.label}
      title={s.title}
      value={params[s.key]}
      min={TRAP_LIMITS[s.key][0]}
      max={TRAP_LIMITS[s.key][1]}
      step={s.step}
      format={s.format}
      defaultValue={DEFAULT_TRAP[s.key]}
      onReset={() => change({ ...current.current, [s.key]: DEFAULT_TRAP[s.key] })}
      onChange={(v) => change({ ...current.current, [s.key]: v })}
      disabled={disabled}
    />
  );

  return (
    <FloatingCard title="Sand trap" collapsed={collapsed} onCollapsedChange={setCollapsed} status={phase === "applied" ? "Applied" : undefined}>
      <Section title="Bunker">
        {!picked ? (
          <p className="muted">Click a bunker on the map or in 3D. Bunkers are painted in the Course editor (surface Bunker); this shapes the ground inside the one you pick, from the outline the last build made.</p>
        ) : missing ? (
          <p className="muted">There is no bunker ground there now. Click another, or paint one in the Course editor and let it build.</p>
        ) : (
          info && (
            <p className="muted">
              About {(info.radius * 2).toFixed(0)} m across at its widest ({info.area.toFixed(0)} m²), the ground round it sloping {info.slope.toFixed(1)}%. A wall width of about {info.radius.toFixed(1)} m makes it a bowl; narrower makes the floor flat.
              {info.slope > 8 ? " That is a steep slope: turn on Level floor to cut it into the hill, or let it follow." : ""}
            </p>
          )
        )}
      </Section>

      {picked && !missing && (
        <>
          <Section title="Start from">
            <div className="row">
              {TRAP_PRESETS.map((p) => (
                <button key={p.id} type="button" title={p.hint} disabled={disabled} onClick={() => change(presetFor(p.id, info?.radius ?? 3, current.current))}>
                  {p.label}
                </button>
              ))}
            </div>
          </Section>

          <Section title="Shape">{SHAPE.map(slider)}</Section>

          <Section title="Floor">
            <ToggleField
              label="Level floor"
              title="The floor is flat and cut into a slope (the uphill side gets a high wall). Off, the floor follows the slope of the ground"
              checked={params.level}
              onChange={(level) => change({ ...current.current, level })}
              disabled={disabled}
            />
            {FLOOR.map(slider)}
          </Section>

          <Section title="Rim">{RIM.map(slider)}</Section>

          <Section title="Character" defaultOpen={false}>
            {CHARACTER.map(slider)}
            <div className="row">
              <span className="muted">Seed {params.seed}</span>
              <button type="button" disabled={disabled} title="A different arrangement of the roughness and the wobbly edge" onClick={() => change({ ...current.current, seed: Math.floor(Math.random() * (TRAP_LIMITS.seed[1] + 1)) })}>
                Reseed
              </button>
            </div>
          </Section>

          <Section title="Apply">
            {moved && phase === "editing" && (
              <p className="muted">
                Raises the ground by up to {moved.up.toFixed(2)} m and lowers it by up to {moved.down.toFixed(2)} m.
              </p>
            )}
            {phase === "editing" ? (
              <>
                <p className="muted">Shown on the ground now. Nothing is kept until you apply it; leaving the tool or picking another bunker puts the ground back.</p>
                <div className="row">
                  <button type="button" onClick={apply} disabled={!edit.current}>Apply</button>
                  <button type="button" onClick={() => change({ ...DEFAULT_TRAP, seed: current.current.seed })}>Reset settings</button>
                </div>
              </>
            ) : (
              <>
                <p className="muted">Applied, and saved with the terrain. Finish it with the brushes, or Undo (<kbd>Ctrl</kbd>+<kbd>Z</kbd>) takes it back.</p>
                <button type="button" onClick={adjust}>Undo and adjust</button>
              </>
            )}
          </Section>
        </>
      )}
    </FloatingCard>
  );
}
