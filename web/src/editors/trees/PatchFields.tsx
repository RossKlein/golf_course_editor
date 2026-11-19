import type { TreeKind } from "../../core/api/api";
import { forestOf, setForest } from "../../model/design/forest";
import { designStore, useDesign } from "../../model/design/store";
import SliderField from "../../ui/SliderField";
import { about, estimatePatch, perHectare } from "./estimate";
import { FOREST_FIELDS, newSeed, WEIGHT } from "./forestFields";

type Props = {
  /** The woods patches to set, or null for the woods defaults. With several, the values shown are the first one's. */
  ids: readonly string[] | null;
  /** The look's tree models, which the kind mix weights. */
  kinds: readonly TreeKind[];
  /** An edit is finished (a release, Enter, a pick): the design should be saved and built now. */
  onFinish: () => void;
};

/** The forest settings of a patch (or of the woods defaults): how close, which models, how tall, how it thins at the border, which arrangement. */
export default function PatchFields({ ids, kinds, onFinish }: Props) {
  const doc = useDesign((s) => s.doc);
  const shown = ids === null ? doc.trees.defaults : forestOf(doc, ids[0]);
  const noun = ids === null ? "woods defaults" : ids.length > 1 ? `${ids.length} patches` : "patch";

  const apply = (label: string, patch: Parameters<typeof setForest>[2]) => {
    if (ids === null) setForest(label, null, patch);
    else for (const id of ids) setForest(label, id, patch);
  };
  const start = (what: string) => designStore.getState().begin(`Set ${noun} ${what}`);
  const finish = () => {
    designStore.getState().end();
    onFinish();
  };
  /** A change that is one event: it is its own undo step. */
  const once = (what: string, patch: Parameters<typeof setForest>[2]) => {
    start(what);
    apply(`Set ${noun} ${what}`, patch);
    finish();
  };

  const weightOf = (name: string) => shown.kinds[name] ?? 1;
  const totalWeight = kinds.reduce((a, k) => a + weightOf(k.name), 0);
  const estimate = ids !== null && ids.length === 1 ? about(estimatePatch(doc, ids[0])) : null;

  return (
    <>
      {FOREST_FIELDS.map((f) => (
        <SliderField
          key={f.prop}
          label={f.label}
          value={shown[f.prop]}
          min={f.min}
          max={f.max}
          step={f.step}
          title={f.title}
          caption={f.prop === "spacing" ? `${Math.round(perHectare(shown.spacing)).toLocaleString()} trees a hectare${estimate ? `, ${estimate}` : ""}` : undefined}
          disabled={f.prop === "edgeDensity" && shown.edgeThinning === 0}
          onStart={() => start(f.label.toLowerCase())}
          onChange={(v) => apply(`Set ${noun} ${f.label.toLowerCase()}`, { [f.prop]: v })}
          onFinish={finish}
        />
      ))}

      <div className="field-label kinds-heading" title="How much of each tree model there is. A model at 0 is not planted; the others share what is left">Mix</div>
      {kinds.map((k) => (
        <SliderField
          key={k.name}
          label={k.name}
          value={weightOf(k.name)}
          min={WEIGHT.min}
          max={WEIGHT.max}
          step={WEIGHT.step}
          caption={`${totalWeight > 0 ? Math.round((weightOf(k.name) / totalWeight) * 100) : Math.round(100 / kinds.length)}% of the trees`}
          onStart={() => start(`${k.name} share`)}
          onChange={(v) => apply(`Set ${noun} ${k.name} share`, (s) => ({ kinds: { ...s.kinds, [k.name]: v } }))}
          onFinish={finish}
        />
      ))}

      <div className="field seed-row" title="Which random arrangement of trees. A new one plants the same number of trees in different places">
        <span className="field-label">Arrangement {shown.seed}</span>
        <button type="button" onClick={() => once("arrangement", { seed: newSeed() })}>Reseed</button>
      </div>
    </>
  );
}
