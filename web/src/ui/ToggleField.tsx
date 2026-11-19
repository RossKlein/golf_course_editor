type Props = {
  label: string;
  checked: boolean;
  /** A flip is a single, complete edit, so `onFinish` follows `onChange` at once. */
  onChange: (checked: boolean) => void;
  onFinish?: () => void;
  title?: string;
  disabled?: boolean;
};

/** A labelled switch. */
export default function ToggleField({ label, checked, onChange, onFinish, title, disabled }: Props) {
  return (
    <label className="field check" title={title}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => {
          onChange(e.target.checked);
          onFinish?.();
        }}
      />
      {label}
    </label>
  );
}
