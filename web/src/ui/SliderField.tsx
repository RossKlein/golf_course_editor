import { useState } from "react";

export type SliderProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  /** The hand went down on the slider: an edit begins (a drag is one undo step). */
  onStart?: () => void;
  /** The edit is finished: the pointer was released, a key was lifted, Enter was pressed or the box was left. */
  onFinish?: () => void;
  /** The value as words, for the number shown beside the label (default: the number). */
  format?: (value: number) => string;
  title?: string;
  /** Under the slider, in small type. */
  caption?: string;
  /** What the value is when it is the default: a dot appears beside the label when it is not, and clicking it calls `onReset`. */
  defaultValue?: number;
  onReset?: () => void;
  disabled?: boolean;
};

const shown = (v: number) => String(Math.round(v * 10000) / 10000);

/** A labelled slider with a number box. Typing or sliding calls `onChange`; letting go or leaving the box calls `onFinish`. */
export default function SliderField({ label, value, min, max, step = 0.01, onChange, onStart, onFinish, format, title, caption, defaultValue, onReset, disabled }: SliderProps) {
  const [text, setText] = useState<string | null>(null); // what is being typed, until the box is left
  const modified = defaultValue !== undefined && Math.abs(value - defaultValue) > 1e-9;
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  return (
    <div className={disabled ? "field disabled" : "field"} title={title}>
      <div className="field-head">
        <span className="field-label">
          {label}
          {modified && onReset && <button type="button" className="dot" title={`Reset to ${shown(defaultValue!)}`} aria-label={`Reset ${label}`} onClick={onReset} />}
        </span>
        <input
          className="num"
          type="text"
          inputMode="decimal"
          aria-label={`${label}, number`}
          disabled={disabled}
          value={text ?? (format ? format(value) : shown(value))}
          onFocus={(e) => {
            onStart?.();
            setText(shown(value));
            e.currentTarget.select();
          }}
          onChange={(e) => {
            setText(e.target.value);
            const v = Number(e.target.value);
            if (e.target.value.trim() !== "" && Number.isFinite(v)) onChange(clamp(v));
          }}
          onBlur={() => {
            setText(null);
            onFinish?.();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              setText(null);
              e.currentTarget.blur();
            }
          }}
        />
      </div>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={clamp(value)}
        disabled={disabled}
        onPointerDown={() => onStart?.()}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={() => onFinish?.()}
        onPointerCancel={() => onFinish?.()}
        onKeyUp={() => onFinish?.()}
      />
      {caption && <div className="field-caption">{caption}</div>}
    </div>
  );
}
