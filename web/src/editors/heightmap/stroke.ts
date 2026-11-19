import type { Pt } from "../../core/geometry/coords";
import { perStamp, stampPoints, type Brush, type BrushKind } from "../../terrain/sculpt/brush";
import type { CloneParams, Stamp } from "../../terrain/sculpt/sculptor";

/** Holding Shift swaps these two. */
const SWAPPED: Partial<Record<BrushKind, BrushKind>> = { raise: "lower", lower: "raise" };

/** Calls back once a frame. Standing in for the browser's here lets a test run frames by hand. */
export type Frames = { request(callback: (now: number) => void): number; cancel(id: number): void };
const BROWSER: Frames = { request: (cb) => requestAnimationFrame(cb), cancel: (id) => cancelAnimationFrame(id) };

/** What a stroke needs from the rest of the app. */
export type StrokeEnv = {
  /** The sculpting of the open bundle: dabs go in, and it is shown and ended. */
  session: { stamp(s: Stamp): void; show(): void; end(): void };
  /** The ground's height at a point, which a flatten brush levels to. */
  ground: (x: number, z: number) => number | null;
  /** The brush as it is set now; read every frame, so a slider moved mid-stroke takes effect. */
  brush: () => Brush;
  /** For the clone brush: whether it copies the shape only, and a way to tell the user what to do. */
  clone?: { relative: () => boolean; say: (text: string) => void };
};

/**
 * One stroke of a sculpting brush, from the button going down to it coming up. Every frame it asks where the pointer is
 * on the ground and stamps the brush from the last place to there, so holding still builds up and a drag paints a line.
 * It does not care which view the pointer is in: whoever starts it says how to find the pointer.
 */
export class Stroke {
  private where: (() => Pt | null) | null = null;
  private shifted = false;
  private last: Pt | null = null;
  private level = 0;
  private before = 0;
  private frame = 0;
  /** The spot the clone brush copies from, picked with Ctrl+click. It stays until another is picked. */
  private source: Pt | null = null;
  /** The clone brush's offset from where it paints to what it copies, for the stroke that is going. */
  private copying: CloneParams | null = null;
  /** Told when the source is picked, so it can be marked. */
  onSource: (source: Pt | null) => void = () => {};

  constructor(private readonly env: StrokeEnv, private readonly frames: Frames = BROWSER) {}

  get active() {
    return this.where !== null;
  }

  /** The spot being copied from, for a pointer at `pointer`: it moves with the pointer during a clone stroke. Null when none is picked. */
  spot(pointer: Pt | null): Pt | null {
    if (this.copying && pointer) return [pointer[0] + this.copying.dx, pointer[1] + this.copying.dz];
    return this.source;
  }

  /**
   * `where` is asked for the pointer's place on the ground every frame; null means it is off the ground just now. With the clone brush
   * Ctrl picks the place to copy from (and starts no stroke), and painting needs one to have been picked.
   */
  begin(where: () => Pt | null, shift: boolean, now = performance.now(), ctrl = false) {
    this.end();
    const start = where();
    this.copying = null;
    if (this.env.brush().kind === "clone") {
      if (ctrl) {
        if (start) {
          this.source = start;
          this.onSource(start);
          this.env.clone?.say("Copying from here. Paint where you want it; each stroke starts again from this spot.");
        }
        return;
      }
      if (!this.source || !start) {
        if (!this.source) this.env.clone?.say("Ctrl+click first, on the ground you want to copy.");
        return;
      }
      this.copying = { dx: this.source[0] - start[0], dz: this.source[1] - start[1], srcLevel: this.env.ground(this.source[0], this.source[1]) ?? 0, relative: this.env.clone?.relative() ?? true };
    }
    this.where = where;
    this.shifted = shift;
    this.level = start ? this.env.ground(start[0], start[1]) ?? 0 : 0; // flatten levels to where the stroke began
    this.last = null;
    this.before = now;
    this.frame = this.frames.request(this.tick);
  }

  shift(down: boolean) {
    this.shifted = down;
  }

  /** Finish: the stamps so far become one undo step. Does nothing when no stroke is going. */
  end() {
    if (!this.where) return;
    this.where = null;
    this.copying = null;
    this.frames.cancel(this.frame);
    this.env.session.end();
  }

  private tick = (now: number) => {
    if (!this.where) return;
    this.frame = this.frames.request(this.tick);
    const pointer = this.where();
    if (!pointer) return;
    const dt = Math.min(0.05, (now - this.before) / 1000);
    this.before = now;
    const b = this.env.brush();
    const points = stampPoints(this.last, pointer, b.radius);
    const { amount, k } = perStamp(b, dt, points.length);
    const kind = this.shifted ? SWAPPED[b.kind] ?? b.kind : b.kind;
    const clone = this.copying ? { ...this.copying, relative: this.env.clone?.relative() ?? this.copying.relative } : undefined; // the toggle works mid-stroke too
    for (const [x, z] of points) this.env.session.stamp({ kind, x, z, radius: b.radius, hardness: b.hardness, amount, pull: k, level: this.level, clone });
    this.last = pointer;
    this.env.session.show();
  };
}
