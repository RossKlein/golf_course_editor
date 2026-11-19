export type Option<T extends string> = { value: T; label: string };

type Props<T extends string> = {
  label: string;
  value: T;
  options: readonly Option<T>[];
  /** A pick is a single, complete edit, so `onFinish` follows `onChange` at once. */
  onChange: (value: T) => void;
  onFinish?: () => void;
  title?: string;
  disabled?: boolean;
};

/** A labelled list to pick one from. */
export default function SelectField<T extends string>({ label, value, options, onChange, onFinish, title, disabled }: Props<T>) {
  return (
    <label className={disabled ? "field disabled" : "field"} title={title}>
      <span className="field-label">{label}</span>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => {
          onChange(e.target.value as T);
          onFinish?.();
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
