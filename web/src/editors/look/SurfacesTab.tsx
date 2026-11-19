import { useState } from "react";
import Section from "../../ui/Section";
import { rgbToCss, type Rgb } from "../../model/look/color";
import { getPath } from "../../model/look/path";
import { FieldList, ResetButton, type Editing } from "./FieldView";
import { SURFACE_MAIN, SURFACE_MORE, type Field } from "./lookSchema";

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Whether a surface uses a field that most surfaces have no use for (stripes on a fairway), so it is shown with the rest. */
function inUse(look: unknown, base: (string | number)[], f: Field): boolean {
  const v = getPath(look, [...base, f.prop]);
  return typeof v === "number" ? v > 0 : Array.isArray(v);
}

/** One surface at a time: a row of swatches to pick it from, and its fields. */
export default function SurfacesTab({ editing, selected, onSelect }: { editing: Editing; selected: string; onSelect: (name: string) => void }) {
  const { look } = editing;
  const [moreOpen, setMoreOpen] = useState(false);
  if (!look) return null;
  const names = Object.keys(look.surfaces);
  const name = names.includes(selected) ? selected : names[0];
  const base = ["surfaces", name];
  const used = SURFACE_MORE.filter((f) => inUse(look, base, f));
  const rest = SURFACE_MORE.filter((f) => !used.includes(f));
  return (
    <>
      <div className="chips" role="tablist" aria-label="Surface">
        {names.map((n) => (
          <button key={n} type="button" role="tab" aria-selected={n === name} className={n === name ? "chip on" : "chip"} onClick={() => onSelect(n)} title={cap(n)}>
            <span className="swatch" style={{ background: rgbToCss(look.surfaces[n].color as Rgb) }} />
            {cap(n)}
          </button>
        ))}
      </div>
      <Section title={cap(name)} actions={<ResetButton label={cap(name)} fields={[...SURFACE_MAIN, ...SURFACE_MORE]} base={base} editing={editing} />}>
        <FieldList fields={SURFACE_MAIN} base={base} noun={cap(name)} editing={editing} />
        <FieldList fields={used} base={base} noun={cap(name)} editing={editing} />
      </Section>
      {rest.length > 0 && (
        <details className="more" open={moreOpen} onToggle={(e) => setMoreOpen(e.currentTarget.open)}>
          <summary>More: {rest.map((f) => f.label.toLowerCase()).join(", ")}</summary>
          <FieldList fields={rest} base={base} noun={cap(name)} editing={editing} />
        </details>
      )}
    </>
  );
}
