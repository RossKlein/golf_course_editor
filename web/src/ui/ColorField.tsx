import { useRef, useState, type PointerEvent } from "react";
import { Popover } from "radix-ui";
import { hexToRgb, hsvToRgb, rgbToCss, rgbToHex, rgbToHsv, type Hsv, type Rgb } from "../model/look/color";

type Edit = {
  /** The hand went down on a colour area or bar: an edit begins (a drag is one undo step). */
  onStart?: () => void;
  /** The edit is finished: the pointer was released, Enter was pressed or a box was left. */
  onFinish?: () => void;
};

type Props = Edit & {
  label: string;
  value: Rgb;
  onChange: (value: Rgb) => void;
  title?: string;
  defaultValue?: Rgb;
  onReset?: () => void;
  disabled?: boolean;
};

const same = (a: readonly number[], b: readonly number[]) => a.every((v, i) => Math.abs(v - b[i]) < 1e-9);
const shown = (v: number) => String(Math.round(v * 1000) / 1000);

/** A labelled swatch that opens a picker: a square for saturation and value, a bar for hue, red, green and blue as the look keeps them (0 to 1), and hex. */
export default function ColorField({ label, value, onChange, onStart, onFinish, title, defaultValue, onReset, disabled }: Props) {
  const modified = defaultValue !== undefined && !same(value, defaultValue);
  return (
    <div className={disabled ? "field color-field disabled" : "field color-field"} title={title}>
      <span className="field-label">
        {label}
        {modified && onReset && <button type="button" className="dot" title="Reset to the default colour" aria-label={`Reset ${label}`} onClick={onReset} />}
      </span>
      <Popover.Root>
        <Popover.Trigger asChild>
          <button type="button" className="swatch-button" disabled={disabled} aria-label={`${label}: ${rgbToHex(value)}`}>
            <span className="swatch" style={{ background: rgbToCss(value) }} />
            <span className="hex">{rgbToHex(value)}</span>
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content className="picker" side="left" align="start" sideOffset={8} collisionPadding={12} onOpenAutoFocus={(e) => e.preventDefault()}>
            <Picker value={value} onChange={onChange} onStart={onStart} onFinish={onFinish} />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}

/** A colour a surface may not have: a switch, and the picker when it is on. `fallback` is what it becomes when switched on. */
export function OptionalColorField({ label, value, fallback, onChange, onStart, onFinish, title }: Omit<Props, "value" | "onChange"> & { value: Rgb | null; fallback: Rgb; onChange: (value: Rgb | null) => void }) {
  return (
    <div className="optional" title={title}>
      <label className="check">
        <input
          type="checkbox"
          checked={value !== null}
          onChange={(e) => {
            onChange(e.target.checked ? fallback : null);
            onFinish?.();
          }}
        />
        <span className="field-label">{label}</span>
      </label>
      {value && <ColorField label="" value={value} onChange={onChange} onStart={onStart} onFinish={onFinish} />}
    </div>
  );
}

function Picker({ value, onChange, onStart, onFinish }: Edit & { value: Rgb; onChange: (v: Rgb) => void }) {
  // hue and saturation are kept here while the value is the same colour, or a grey would lose its hue every time it was moved
  const [hsv, setHsv] = useState<Hsv>(() => rgbToHsv(value));
  const current = same(hsvToRgb(hsv), value) ? hsv : rgbToHsv(value);
  if (current !== hsv) setHsv(current);
  const [hex, setHex] = useState<string | null>(null);
  const area = useRef<HTMLDivElement>(null);

  const setFromHsv = (h: Hsv) => {
    setHsv(h);
    onChange(hsvToRgb(h));
  };
  const pick = (e: PointerEvent) => {
    const r = area.current!.getBoundingClientRect();
    const s = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const v = Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height));
    setFromHsv([current[0], s, v]);
  };
  const [dragging, setDragging] = useState(false);

  return (
    <div className="picker-body">
      <div
        ref={area}
        className="sv"
        style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent), hsl(${current[0]} 100% 50%)` }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          setDragging(true);
          onStart?.();
          pick(e);
        }}
        onPointerMove={(e) => dragging && pick(e)}
        onPointerUp={() => {
          setDragging(false);
          onFinish?.();
        }}
        onPointerCancel={() => {
          setDragging(false);
          onFinish?.();
        }}
      >
        <span className="sv-dot" style={{ left: `${current[1] * 100}%`, top: `${(1 - current[2]) * 100}%` }} />
      </div>
      <input
        className="hue"
        type="range"
        aria-label="Hue"
        min={0}
        max={360}
        step={1}
        value={current[0]}
        onPointerDown={() => onStart?.()}
        onChange={(e) => setFromHsv([Number(e.target.value), current[1], current[2]])}
        onPointerUp={() => onFinish?.()}
        onKeyUp={() => onFinish?.()}
      />
      <div className="rgb">
        {(["R", "G", "B"] as const).map((name, i) => (
          <label key={name}>
            {name}
            <input
              type="number"
              min={0}
              max={1}
              step={0.01}
              value={shown(value[i])}
              onChange={(e) => {
                const v = Math.min(1, Math.max(0, Number(e.target.value)));
                if (!Number.isFinite(v)) return;
                const next = [...value] as Rgb;
                next[i] = v;
                onChange(next);
              }}
              onBlur={() => onFinish?.()}
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            />
          </label>
        ))}
        <label>
          Hex
          <input
            type="text"
            value={hex ?? rgbToHex(value)}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => {
              setHex(e.target.value);
              const rgb = hexToRgb(e.target.value);
              if (rgb) onChange(rgb);
            }}
            onBlur={() => {
              setHex(null);
              onFinish?.();
            }}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          />
        </label>
      </div>
    </div>
  );
}
