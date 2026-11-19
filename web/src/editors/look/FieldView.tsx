import { useState } from "react";
import ColorField, { OptionalColorField } from "../../ui/ColorField";
import SelectField from "../../ui/SelectField";
import SliderField from "../../ui/SliderField";
import { renameTreeKind } from "../../model/design/forest";
import { getPath, type Path } from "../../model/look/path";
import type { Rgb } from "../../model/look/color";
import type { useLookEditing } from "../../scene/useLookEditing";
import type { Field } from "./lookSchema";

export type Editing = ReturnType<typeof useLookEditing>;

type Props = {
  field: Field;
  /** Where the object the field belongs to is in the look: `["surfaces", "fairway"]`. */
  base: Path;
  /** What the object is called in an undo step: "Fairway". */
  noun: string;
  editing: Editing;
};

/** One field of the look as the control its spec asks for, reading and writing the look through `editing`. */
export default function FieldView({ field, base, noun, editing }: Props) {
  const { look, defaults, start, set, finish, reset } = editing;
  const path = [...base, field.prop];
  const label = `${noun} ${field.label.toLowerCase()}`;
  const value = getPath(look, path);
  const fallback = getPath(defaults, path);
  const common = { title: field.title, onStart: () => start(label), onFinish: finish };

  switch (field.kind) {
    case "slider": {
      if (typeof value !== "number") return null;
      const d = field.display;
      const shown = d ? d.to(value) : value;
      return (
        <SliderField
          label={field.label}
          value={shown}
          min={field.min}
          max={field.max}
          step={field.step}
          format={d?.format}
          caption={d?.caption?.(value)}
          defaultValue={typeof fallback === "number" ? (d ? d.to(fallback) : fallback) : undefined}
          onReset={() => reset(label, path)}
          onChange={(v) => set(label, path, field.integer ? Math.round(v) : d ? d.from(v) : v)}
          {...common}
        />
      );
    }
    case "color": {
      if (!Array.isArray(value)) return null;
      return <ColorField label={field.label} value={value as Rgb} defaultValue={Array.isArray(fallback) ? (fallback as Rgb) : undefined} onReset={() => reset(label, path)} onChange={(v) => set(label, path, v)} {...common} />;
    }
    case "optionalColor": {
      const on = getPath(look, [...base, field.fallbackProp]) as Rgb | undefined;
      return <OptionalColorField label={field.label} value={Array.isArray(value) ? (value as Rgb) : null} fallback={on ?? [0.5, 0.5, 0.5]} onChange={(v) => set(label, path, v)} {...common} />;
    }
    case "select": {
      if (typeof value !== "string") return null;
      return <SelectField label={field.label} value={value} options={field.options} onChange={(v) => set(label, path, v)} onFinish={finish} title={field.title} />;
    }
    case "text": {
      if (typeof value !== "string") return null;
      return (
        <label className="field" title={field.title}>
          <span className="field-label">{field.label}</span>
          <input type="text" value={value} onFocus={() => start(label)} onChange={(e) => set(label, path, e.target.value)} onBlur={finish} onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} />
        </label>
      );
    }
    case "kindName": {
      if (typeof value !== "string") return null;
      return <KindNameField index={Number(base[base.length - 1])} value={value} label={field.label} title={field.title} noun={label} editing={editing} />;
    }
    case "readonly":
      return (
        <div className="field" title={field.title}>
          <span className="field-label">{field.label}</span>
          <code>{String(value)}</code>
        </div>
      );
    case "range": {
      if (!Array.isArray(value)) return null;
      const [low, high] = value as [number, number];
      const each = (i: 0 | 1, name: string) => (
        <SliderField
          key={name}
          label={`${field.label}: ${name}`}
          value={i ? high : low}
          min={field.min}
          max={field.max}
          step={field.step}
          title={field.title}
          onStart={() => start(label)}
          onFinish={finish}
          onChange={(v) => set(label, path, i ? [low, Math.max(low, v)] : [Math.min(high, v), high])}
        />
      );
      return <>{each(0, "shortest")}{each(1, "tallest")}</>;
    }
  }
}

/**
 * A tree kind's name. Each valid keystroke renames the kind (and carries its weights, in one undo step with the rest of the edit); a
 * blank name or a name another kind has is not applied, and is said to be wrong until it is fixed or the box is left.
 */
function KindNameField({ index, value, label, title, noun, editing }: { index: number; value: string; label: string; title?: string; noun: string; editing: Editing }) {
  const [typed, setTyped] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <label className="field" title={title}>
      <span className="field-label">{label}</span>
      <input
        type="text"
        value={typed ?? value}
        aria-invalid={problem !== null}
        onFocus={() => editing.start(noun)}
        onChange={(e) => {
          const result = renameTreeKind(index, e.target.value);
          setTyped(result === "ok" ? null : e.target.value);
          setProblem(result === "blank" ? "A tree model needs a name." : result === "taken" ? "Another tree model already has that name." : null);
        }}
        onBlur={() => {
          setTyped(null);
          setProblem(null);
          editing.finish();
        }}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      />
      {problem && <span className="field-caption bad">{problem}</span>}
    </label>
  );
}

/** The paths of a list of fields, for resetting them together. */
export const pathsOf = (fields: Field[], base: Path): Path[] => fields.map((f) => [...base, f.prop]);

type ListProps = { fields: Field[]; base: Path; noun: string; editing: Editing };

/** A list of fields, one after another. */
export function FieldList({ fields, base, noun, editing }: ListProps) {
  return (
    <>
      {fields.map((f) => (
        <FieldView key={f.prop + f.label} field={f} base={base} noun={noun} editing={editing} />
      ))}
    </>
  );
}

/** A "Reset" button for a section: its fields go back to the default, as one undo step. */
export function ResetButton({ label, fields, base, editing }: { label: string; fields: Field[]; base: Path; editing: Editing }) {
  return (
    <button type="button" disabled={!editing.defaults} title={`Put ${label.toLowerCase()} back to the default`} onClick={() => editing.resetAll(`Reset ${label.toLowerCase()}`, pathsOf(fields, base))}>
      Reset
    </button>
  );
}
