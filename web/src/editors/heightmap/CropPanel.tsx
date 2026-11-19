import { useMemo, useState } from "react";
import { api } from "../../core/api/api";
import { designStore, useDesign } from "../../model/design/store";
import FloatingCard from "../../ui/FloatingCard";
import Section from "../../ui/Section";
import { useFormatter } from "../../ui/useUnits";
import { contentBox, cropImpact, touchesDesign } from "./cropImpact";
import { reloadWith } from "./cropNotice";
import { setCrop, useCropRect } from "./cropStore";
import { isWhole, sizeOf, tidy, trimmed, wholeMap, type CropRect, type MapSize } from "./cropRect";

const DEFAULT_MARGIN = 30;

type Props = {
  bundle: string;
  size: MapSize;
  landmarks: readonly { x: number; z: number }[];
  /** The crop box is drawn on the 2D map only. */
  view3d: boolean;
  /** Write everything the editor has not saved yet (the design and the sculpting) so the server crops what is on screen. */
  save: () => Promise<void>;
  say: (text: string) => void;
};

function Trim({ label, value, max, onChange }: { label: string; value: number; max: number; onChange: (v: number) => void }) {
  return (
    <label className="crop-trim">
      {label}
      <input type="number" min={0} max={max} step={1} value={value} onChange={(e) => Number.isFinite(e.target.valueAsNumber) && onChange(Math.round(e.target.valueAsNumber))} />
    </label>
  );
}

/**
 * The Crop tool's card: the part of the map to keep as numbers, a button to fit it round the course, what it would cut from the design, and
 * the button that does it. A crop changes every coordinate in the course, so it saves first, asks, lets the server do it, and loads the page afresh.
 */
export default function CropPanel({ bundle, size, landmarks, view3d, save, say }: Props) {
  const fmt = useFormatter();
  const stored = useCropRect();
  const rect = useMemo(() => (stored ? tidy(stored, size) : wholeMap(size)), [stored, size]);
  const [collapsed, setCollapsed] = useState(false);
  const [margin, setMargin] = useState(DEFAULT_MARGIN);
  const [busy, setBusy] = useState(false);
  const doc = useDesign((s) => s.doc);
  const impact = useMemo(() => cropImpact(doc, landmarks, rect), [doc, landmarks, rect]);

  const now = { w: size.w, h: size.h };
  const next = sizeOf(rect);
  const whole = isWhole(rect, size);
  const kept = (next.w * next.h) / (now.w * now.h);
  const set = (r: CropRect) => setCrop(tidy(r, size));
  const trims = { west: rect.x0, north: rect.z0, east: size.w - rect.x1, south: size.h - rect.z1 };

  const fit = () => {
    const box = contentBox(designStore.getState().doc, landmarks, margin);
    if (!box) return say("There is nothing drawn yet to fit the box round. Draw some surfaces or a route first.");
    set(box);
  };

  const apply = async () => {
    const lines = [
      `Crop the map from ${now.w} x ${now.h} m to ${next.w} x ${next.h} m?`,
      "",
      "The part outside the box is removed from the terrain and from the design (surfaces, bounds, routes, trees, landmarks).",
      "Everything else keeps its place. The old map is kept, and Undo crop brings it back, but edits made after the crop would be lost when you do.",
    ];
    if (impact.routes.length) lines.push("", `The route of hole ${impact.routes.join(", ")} reaches outside the box.`);
    if (!window.confirm(lines.join("\n"))) return;
    setBusy(true);
    try {
      await save();
      const done = await api.crop(bundle, rect);
      const text = [`Cropped to ${done.cols - 1} x ${done.rows - 1} m.`, ...done.notes.slice(0, 3)].join(" ");
      reloadWith(`${text} Undo crop (in the Mesh bar) brings the old map back.`);
    } catch (e) {
      say(`Could not crop: ${(e as Error).message}`);
      setBusy(false);
    }
  };

  return (
    <FloatingCard title="Crop the map" collapsed={collapsed} onCollapsedChange={setCollapsed}>
      <Section title="Keep">
        <p className="muted">
          {whole ? `The whole map, ${now.w} x ${now.h} m.` : `${next.w} x ${next.h} m of ${now.w} x ${now.h} m (${Math.round(kept * 100)}% of the ground, ${fmt.area(next.w * next.h)}).`}
          {view3d ? " The box is drawn on the 2D map: press 3 to go back to it." : " Drag the handles on the map, or set the edges here."}
        </p>
        <div className="crop-trims">
          <Trim label="Cut from west (m)" value={trims.west} max={size.w} onChange={(v) => set(trimmed(size, { ...trims, west: v }))} />
          <Trim label="Cut from east (m)" value={trims.east} max={size.w} onChange={(v) => set(trimmed(size, { ...trims, east: v }))} />
          <Trim label="Cut from north (m)" value={trims.north} max={size.h} onChange={(v) => set(trimmed(size, { ...trims, north: v }))} />
          <Trim label="Cut from south (m)" value={trims.south} max={size.h} onChange={(v) => set(trimmed(size, { ...trims, south: v }))} />
        </div>
        <div className="row">
          <button type="button" onClick={fit} title="Put the box round every surface, route, placed tree and landmark, with the margin below">Fit to the course</button>
          <label className="crop-margin" title="Metres of map to keep beyond the outermost thing drawn">
            plus
            <input type="number" min={0} max={500} step={5} value={margin} onChange={(e) => Number.isFinite(e.target.valueAsNumber) && setMargin(Math.max(0, e.target.valueAsNumber))} />
            m
          </label>
          <button type="button" onClick={() => setCrop(wholeMap(size))} disabled={whole}>Whole map</button>
        </div>
      </Section>

      <Section title="What it cuts">
        {touchesDesign(impact) ? (
          <ul className="crop-impact">
            {impact.gone > 0 && <li>{impact.gone} surface{impact.gone === 1 ? "" : "s"} or bounds area{impact.gone === 1 ? "" : "s"} outside the box will be removed.</li>}
            {impact.cut > 0 && <li>{impact.cut} cross{impact.cut === 1 ? "es" : ""} its edge and will be cut to it.</li>}
            {impact.routes.length > 0 && <li className="bad">The route of hole {impact.routes.join(", ")} reaches outside the box. It is kept as it is; the hole will need its route redrawn.</li>}
            {impact.trees > 0 && <li>{impact.trees} placed tree{impact.trees === 1 ? "" : "s"} will be removed.</li>}
            {impact.landmarks > 0 && <li>{impact.landmarks} landmark{impact.landmarks === 1 ? "" : "s"} will be removed.</li>}
          </ul>
        ) : (
          <p className="muted">Nothing drawn lies outside the box.</p>
        )}
        <p className="muted">The forest is planted again for the smaller map.</p>
      </Section>

      <Section title="Crop">
        <div className="row">
          <button type="button" onClick={() => void apply()} disabled={whole || busy}>{busy ? "Cropping…" : whole ? "Choose a smaller box" : `Crop to ${next.w} x ${next.h} m`}</button>
        </div>
        <p className="muted">This changes the files, so it is not an Undo step. The page reloads when it is done. Undo crop in the Mesh bar takes the last five back.</p>
      </Section>
    </FloatingCard>
  );
}
