import { describe, expect, it } from "vitest";
import type { Pt } from "../../core/geometry/coords";
import type { Brush } from "../../terrain/sculpt/brush";
import type { Stamp } from "../../terrain/sculpt/sculptor";
import { Stroke, type Frames } from "./stroke";

/** Frames that run when the test says so. */
function manualFrames() {
  let next = 1;
  const waiting = new Map<number, (now: number) => void>();
  const frames: Frames = { request: (cb) => (waiting.set(next, cb), next++), cancel: (id) => void waiting.delete(id) };
  return {
    frames,
    pending: () => waiting.size,
    run(now: number) {
      const due = [...waiting.entries()];
      waiting.clear();
      due.forEach(([, cb]) => cb(now));
    },
  };
}

function setup(brush: Partial<Brush> = {}) {
  const stamps: Stamp[] = [];
  const log: string[] = [];
  const f = manualFrames();
  let pointer: Pt | null = [10, 20];
  const b: Brush = { kind: "raise", radius: 8, hardness: 0.5, strength: 0.5, ...brush };
  const stroke = new Stroke(
    {
      session: { stamp: (s) => stamps.push(s), show: () => log.push("show"), end: () => log.push("end") },
      ground: (x, z) => x + z,
      brush: () => b,
    },
    f.frames,
  );
  return { stroke, stamps, log, f, move: (p: Pt | null) => (pointer = p), where: () => pointer, brush: b };
}

describe("a sculpting stroke", () => {
  it("stamps where the pointer is on each frame, and shows it", () => {
    const t = setup();
    t.stroke.begin(t.where, false, 0);
    expect(t.stamps).toHaveLength(0); // nothing until a frame comes
    t.f.run(16);
    expect(t.stamps).toHaveLength(1);
    expect([t.stamps[0].x, t.stamps[0].z]).toEqual([10, 20]);
    expect(t.stamps[0].kind).toBe("raise");
    expect(t.log).toEqual(["show"]);
  });

  it("builds up while held still, in proportion to the time", () => {
    const t = setup();
    t.stroke.begin(t.where, false, 0);
    t.f.run(16);
    t.f.run(32);
    expect(t.stamps).toHaveLength(2);
    expect(t.stamps[1].amount).toBeCloseTo(t.stamps[0].amount, 6); // equal frames, equal dabs
    t.f.run(32 + 100); // a slow frame is capped, not a huge dab
    expect(t.stamps[2].amount).toBeLessThan(t.stamps[0].amount * 4);
  });

  it("paints a line between where the pointer was and where it is", () => {
    const t = setup();
    t.stroke.begin(t.where, false, 0);
    t.f.run(16);
    t.move([50, 20]);
    t.f.run(32);
    const line = t.stamps.slice(1);
    expect(line.length).toBeGreaterThan(1);
    expect(line[line.length - 1].x).toBeCloseTo(50, 6);
    expect(line[0].x).toBeGreaterThan(10);
    const total = line.reduce((a, s) => a + s.amount, 0);
    expect(total).toBeCloseTo(t.stamps[0].amount, 6); // a long drag is no stronger than holding still for the same time
  });

  it("does nothing while the pointer is off the ground, and picks up again", () => {
    const t = setup();
    t.stroke.begin(t.where, false, 0);
    t.move(null);
    t.f.run(16);
    expect(t.stamps).toHaveLength(0);
    t.move([12, 12]);
    t.f.run(32);
    expect(t.stamps).toHaveLength(1);
    expect(t.stamps[0].x).toBe(12);
  });

  it("swaps raise and lower with Shift, live", () => {
    const t = setup();
    t.stroke.begin(t.where, true, 0);
    t.f.run(16);
    t.stroke.shift(false);
    t.f.run(32);
    expect(t.stamps.map((s) => s.kind)).toEqual(["lower", "raise"]);
    const smooth = setup({ kind: "smooth" });
    smooth.stroke.begin(smooth.where, true, 0);
    smooth.f.run(16);
    expect(smooth.stamps[0].kind).toBe("smooth"); // Shift changes nothing for the others
  });

  it("levels a flatten to the ground where the stroke began", () => {
    const t = setup({ kind: "flatten" });
    t.stroke.begin(t.where, false, 0);
    t.move([40, 40]);
    t.f.run(16);
    t.f.run(32);
    expect(t.stamps.every((s) => s.level === 30)).toBe(true); // ground(10, 20)
  });

  it("reads the brush afresh each frame", () => {
    const t = setup();
    t.stroke.begin(t.where, false, 0);
    t.f.run(16);
    t.brush.radius = 20;
    t.f.run(32);
    expect(t.stamps.map((s) => s.radius)).toEqual([8, 20]);
  });

  it("ends as one undo step, and stops asking for frames", () => {
    const t = setup();
    t.stroke.begin(t.where, false, 0);
    t.f.run(16);
    expect(t.stroke.active).toBe(true);
    t.stroke.end();
    expect(t.stroke.active).toBe(false);
    expect(t.log).toEqual(["show", "end"]);
    expect(t.f.pending()).toBe(0);
    t.stroke.end(); // a second end is harmless
    expect(t.log).toEqual(["show", "end"]);
  });

  it("finishes a stroke that is still going when the next begins", () => {
    const t = setup();
    t.stroke.begin(t.where, false, 0);
    t.f.run(16);
    t.stroke.begin(t.where, false, 20);
    expect(t.log).toEqual(["show", "end"]);
    expect(t.f.pending()).toBe(1);
  });
});
