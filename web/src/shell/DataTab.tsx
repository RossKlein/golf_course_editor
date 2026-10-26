import type { BuildStatus } from "../core/api/api";
import { CLASS_NAMES } from "../scene/bundleScene";
import type { BundleData } from "../scene/bundleScene";
import { OWNED } from "../views/map2d/design/olRegions";
import { ringArea } from "../core/geometry/geometry";
import { designStore, removeBoundsAreas, reorderRegions, removeRegions, updateBoundsArea, updateRegion, useDesign } from "../model/design/store";
import ReportView from "../report/ReportView";
import HolesPanel from "./HolesPanel";
import type { Formatter } from "../core/units/units";

function RegionInspector({ fmt, holeCount }: { fmt: Formatter; holeCount: number }) {
  const selected = useDesign((s) => s.selected);
  const regions = useDesign((s) => s.doc.regions);
  if (!selected.length) return <p className="muted">Nothing selected. In the Course editor, press <kbd>V</kbd> and click a region.</p>;
  const rs = selected.map((id) => regions[id]).filter(Boolean);
  if (!rs.length) return null;
  const one = rs.length === 1 ? rs[0] : null;
  const allOwned = rs.every((r) => OWNED.includes(r.class));
  const apply = (label: string, patch: (r: (typeof rs)[number]) => Record<string, unknown>) => {
    const s = designStore.getState();
    s.begin(label);
    for (const r of rs) updateRegion(label, r.id, patch(r));
    s.end();
  };
  return (
    <section className="inspector">
      <h2>{one ? "Region" : `${rs.length} regions`}</h2>
      <label>
        Surface
        <select value={one ? one.class : ""} onChange={(e) => { const cls = Number(e.target.value); apply("Change surface", (r) => ({ class: cls, hole: OWNED.includes(cls) ? r.hole : null })); }}>
          {!one && <option value="">(mixed)</option>}
          {CLASS_NAMES.map((n, i) => <option key={n} value={i}>{n}</option>)}
        </select>
      </label>
      <label>
        Hole
        <select
          value={allOwned ? (rs.every((r) => r.hole === rs[0].hole) ? rs[0].hole ?? "" : "") : ""}
          disabled={!allOwned}
          onChange={(e) => { const hole = e.target.value ? Number(e.target.value) : null; apply("Assign hole", () => ({ hole })); }}
          title={allOwned ? "The hole this surface belongs to" : "Only fairways, greens and tees belong to a hole; other surfaces are shared"}
        >
          <option value="">{allOwned ? "none yet" : "shared by all holes"}</option>
          {Array.from({ length: Math.max(holeCount, ...rs.map((r) => r.hole ?? 0)) }, (_, i) => i + 1).map((n) => <option key={n} value={n}>Hole {n}</option>)}
        </select>
      </label>
      {one && (
        <table className="info"><tbody>
          <tr><td>Area</td><td>{fmt.area(ringArea(one.outer as never) - one.inner.reduce((a, h) => a + ringArea(h as never), 0))}</td></tr>
          <tr><td>Points</td><td>{one.outer.length - 1}{one.inner.length ? ` + ${one.inner.length} hole${one.inner.length > 1 ? "s" : ""}` : ""}</td></tr>
        </tbody></table>
      )}
      <div className="row">
        <button type="button" onClick={() => reorderRegions("Bring to front", selected, "front")}>To front</button>
        <button type="button" onClick={() => reorderRegions("Send to back", selected, "back")}>To back</button>
        <button type="button" onClick={() => { designStore.getState().select([]); removeRegions("Delete region", selected); }}>Delete</button>
      </div>
    </section>
  );
}

/** The selected bounds areas, or, with none selected, what the active hole's bounds amount to. */
function BoundsInspector({ fmt, hole, holeCount }: { fmt: Formatter; hole: number; holeCount: number }) {
  const selected = useDesign((s) => s.selected);
  const bounds = useDesign((s) => s.doc.bounds);
  const areas = selected.map((id) => bounds[id]).filter(Boolean);
  if (!areas.length) {
    const mine = Object.values(bounds).filter((a) => a.hole === hole);
    return (
      <section className="inspector">
        <h2>Bounds of hole {hole}</h2>
        <p className="muted">
          {mine.length
            ? `${mine.length} area${mine.length > 1 ? "s" : ""}, about ${fmt.area(mine.reduce((a, m) => a + ringArea(m.outer as never) - m.inner.reduce((b, h) => b + ringArea(h as never), 0), 0))}. The hole is in bounds inside them and out of bounds everywhere else.`
            : "None drawn yet, so the whole course is in bounds for this hole. Draw an area to say where it may be played from."}
        </p>
      </section>
    );
  }
  const one = areas.length === 1 ? areas[0] : null;
  const apply = (label: string, patch: Record<string, unknown>) => {
    const s = designStore.getState();
    s.begin(label);
    for (const a of areas) updateBoundsArea(label, a.id, patch);
    s.end();
  };
  return (
    <section className="inspector">
      <h2>{one ? "Bounds area" : `${areas.length} bounds areas`}</h2>
      <label>
        Hole
        <select value={areas.every((a) => a.hole === areas[0].hole) ? areas[0].hole : ""} onChange={(e) => apply("Change hole", { hole: Number(e.target.value) })}>
          {!areas.every((a) => a.hole === areas[0].hole) && <option value="">(mixed)</option>}
          {Array.from({ length: Math.max(holeCount, ...areas.map((a) => a.hole)) }, (_, i) => i + 1).map((n) => <option key={n} value={n}>Hole {n}</option>)}
        </select>
      </label>
      {one && (
        <table className="info"><tbody>
          <tr><td>Area</td><td>{fmt.area(ringArea(one.outer as never) - one.inner.reduce((a, h) => a + ringArea(h as never), 0))}</td></tr>
          <tr><td>Points</td><td>{one.outer.length - 1}{one.inner.length ? ` + ${one.inner.length} hole${one.inner.length > 1 ? "s" : ""}` : ""}</td></tr>
        </tbody></table>
      )}
      <div className="row">
        <button type="button" onClick={() => { designStore.getState().select([]); removeBoundsAreas("Delete bounds area", areas.map((a) => a.id)); }}>Delete</button>
      </div>
    </section>
  );
}

function BuildInfo({ build }: { build: BuildStatus | null }) {
  if (!build || !build.id) return <p className="muted">No build yet. Edits are built automatically a moment after you stop.</p>;
  return (
    <section>
      <h2>Last build</h2>
      <table className="info"><tbody>
        <tr><td>Build</td><td>#{build.id}, {build.state}</td></tr>
        <tr><td>Contents</td><td>{build.regions} regions, {build.holes} holes</td></tr>
        <tr><td>Took</td><td>{build.ms.total ?? "?"} ms (rasterize {build.ms.rasterize ?? "?"}, encode {build.ms.encode ?? "?"}, validate {build.ms.validate ?? "?"})</td></tr>
      </tbody></table>
      {build.error && <p className="error">{build.error}</p>}
      {build.notes.map((n) => <p key={n} className="warn">{n}</p>)}
    </section>
  );
}

/** The Data tab for a bundle: the selected region, the last build, validation problems and course info. */
type Props = { data: BundleData; build: BuildStatus | null; fmt: Formatter; editor: string; hole: number; onHole: (n: number) => void; onAddHole: () => void; onAssign: () => void };

export default function DataTab({ data, build, fmt, editor, hole, onHole, onAddHole, onAssign }: Props) {
  const holeCount = useDesign((s) => s.doc.layout.holes.length);
  return (
    <>
      {editor === "bounds" ? <BoundsInspector fmt={fmt} hole={hole} holeCount={holeCount} /> : <RegionInspector fmt={fmt} holeCount={holeCount} />}
      <BuildInfo build={build} />
      <h2>Problems</h2>
      <ReportView report={build?.report ?? data.report} />
      <h2>Course</h2>
      <HolesPanel data={data} hole={hole} fmt={fmt} onHole={onHole} onAddHole={onAddHole} onAssign={onAssign} />
    </>
  );
}
