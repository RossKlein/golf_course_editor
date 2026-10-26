import type { Pt } from "../../core/geometry/coords";
import { perStamp, stampPoints, type Brush, type BrushKind } from "../../terrain/sculpt/brush";
import type { Stamp } from "../../terrain/sculpt/sculptor";

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

  constructor(private readonly env: StrokeEnv, private readonly frames: Frames = BROWSER) {}

  get active() {
    return this.where !== null;
  }

  /** `where` is asked for the pointer's place on the ground every frame; null means it is off the ground just now. */
  begin(where: () => Pt | null, shift: boolean, now = performance.now()) {
    this.end();
    const start = where();
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
    for (const [x, z] of points) this.env.session.stamp({ kind, x, z, radius: b.radius, hardness: b.hardness, amount, pull: k, level: this.level });
    this.last = pointer;
    this.env.session.show();
  };
}
