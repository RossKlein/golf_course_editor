import { useEffect, useState } from "react";
import { Plus, Trash2, Wand2 } from "lucide-react";
import type { BundleData } from "../bundle/bundleScene";
import { routeLength, unassignedCount } from "../design/holes";
import { removeHole, updateHole, updateLayout, useDesign } from "../design/store";
import type { Formatter } from "../units/units";

/** A text field that changes the document when you leave it or press Enter, so typing is one undo step, not one per key. */
function TextField({ value, placeholder, onCommit, label }: { value: string; placeholder?: string; onCommit: (v: string) => void; label: string }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = () => text !== value && onCommit(text);
  return (
    <input
      type="text"
      aria-label={label}
      value={text}
      placeholder={placeholder}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          setText(value);
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

const boundsText = (n: number) => (n ? `${n} area${n > 1 ? "s" : ""}` : "all");

type Props = { data: BundleData; hole: number; fmt: Formatter; onHole: (n: number) => void; onAddHole: () => void; onAssign: () => void };

/** Course details and the list of holes: name, par and route length for each, which one is active, and assigning surfaces. */
export default function HolesPanel({ data, hole, fmt, onHole, onAddHole, onAssign }: Props) {
  const layout = useDesign((s) => s.doc.layout);
  const unassigned = useDesign((s) => unassignedCount(s.doc));
  const bounds = useDesign((s) => s.doc.bounds);
  const totalPar = layout.holes.reduce((a, h) => a + h.par, 0);
  const totalLength = layout.holes.reduce((a, h) => a + routeLength(h.route as [number, number][]), 0);
  return (
    <section className="holes">
      <label>
        Name
        <TextField label="Course name" value={layout.name ?? ""} placeholder={data.course.name} onCommit={(v) => updateLayout("Rename course", { name: v.trim() || null })} />
      </label>
      <label>
        Attribution
        <TextField label="Attribution" value={layout.attribution ?? ""} placeholder={data.course.attribution} onCommit={(v) => updateLayout("Edit attribution", { attribution: v.trim() || null })} />
      </label>
      <div className="row">
        <h2 style={{ margin: 0, flex: 1 }}>Holes</h2>
        <button type="button" onClick={onAddHole}><Plus size={13} /> Add</button>
        <button type="button" onClick={onAssign} disabled={!unassigned} title="Give each fairway, green and tee without a hole to the nearest hole's route">
          <Wand2 size={13} /> Assign{unassigned ? ` (${unassigned})` : ""}
        </button>
      </div>
      {layout.holes.length ? (
        <table className="holes-table">
          <thead>
            <tr><th>#</th><th>Name</th><th>Par</th><th>Route</th><th>Bounds</th><th /></tr>
          </thead>
          <tbody>
            {layout.holes.map((h) => {
              const len = routeLength(h.route as [number, number][]);
              return (
                <tr key={h.number} className={h.number === hole ? "on" : undefined}>
                  <td><button type="button" className="link" onClick={() => onHole(h.number)} title="Go to this hole">{h.number}</button></td>
                  <td><TextField label={`Hole ${h.number} name`} value={h.name ?? ""} onCommit={(v) => updateHole(h.number, { name: v.trim() || null })} /></td>
                  <td>
                    <input type="number" aria-label={`Hole ${h.number} par`} min={1} max={9} value={h.par} onChange={(e) => { const par = Math.round(Number(e.target.value)); if (par >= 1 && par <= 9) updateHole(h.number, { par }); }} />
                  </td>
                  <td className={h.route.length < 2 ? "warn-text" : undefined}>{h.route.length < 2 ? "none" : fmt.distance(len, 0)}</td>
                  <td className="muted-cell">{boundsText(Object.values(bounds).filter((a) => a.hole === h.number).length)}</td>
                  <td><button type="button" className="icon" aria-label={`Remove hole ${h.number}`} title="Remove this hole (later holes move down a number)" onClick={() => removeHole(h.number)}><Trash2 size={13} /></button></td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr><td /><td>Total</td><td>{totalPar}</td><td>{fmt.distance(totalLength, 0)}</td><td /><td /></tr>
          </tfoot>
        </table>
      ) : (
        <p className="muted">No holes yet. Add one, then draw its route with the Route tool (<kbd>Shift</kbd>+<kbd>R</kbd>).</p>
      )}
    </section>
  );
}
