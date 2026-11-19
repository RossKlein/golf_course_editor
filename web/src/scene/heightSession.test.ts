import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { designStore, emptyDoc } from "../model/design/store";
import type { Sculptor } from "../terrain/sculpt/sculptor";
import { DEFAULT_TRAP, BUNKER_CLASS } from "../terrain/sculpt/trap";
import { readTile, writeTile } from "../terrain/sculpt/tiles";

vi.mock("../core/api/api", () => ({ api: { heightDelta: vi.fn(async () => new Uint8Array()), saveHeightDelta: vi.fn(async () => undefined) } }));
const { HeightSession } = await import("./heightSession");

const grid = { cols: 150, rows: 70 }; // 3 x 2 tiles

/** Just enough of a Sculptor for the session: the offsets, and applying whole tiles to them. */
function fakeSculptor() {
  const offsets = new Float32Array(grid.cols * grid.rows);
  const sculptor = {
    offsets,
    apply: (keys: number[], tiles: Float32Array[]) => keys.forEach((key, n) => writeTile(offsets, grid, key, tiles[n])),
    load: (o: Float32Array) => offsets.set(o),
  };
  return { offsets, sculptor: sculptor as unknown as Sculptor };
}

describe("HeightSession.restoreAll", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    designStore.getState().reset(emptyDoc());
  });
  afterEach(() => vi.useRealTimers());

  it("takes every edit away as one undo step that puts them all back", () => {
    const { offsets, sculptor } = fakeSculptor();
    offsets[5 * grid.cols + 5] = 1.5; // first tile
    offsets[65 * grid.cols + 140] = -2; // last tile
    const redraw = vi.fn();
    const session = new HeightSession("b", sculptor, { cols: grid.cols, rows: grid.rows } as never, redraw);
    expect(session.restoreAll()).toBe(true);
    expect(offsets.every((v) => v === 0)).toBe(true);
    expect(redraw).toHaveBeenCalled();
    expect(designStore.getState().past.map((e) => e.label)).toEqual(["Restore the original terrain"]);

    designStore.getState().undo();
    expect(offsets[5 * grid.cols + 5]).toBe(1.5);
    expect(offsets[65 * grid.cols + 140]).toBe(-2);
    designStore.getState().redo();
    expect(offsets.every((v) => v === 0)).toBe(true);
  });

  it("leaves undo alone when there is nothing to take away", () => {
    const { sculptor } = fakeSculptor();
    const session = new HeightSession("b", sculptor, { cols: grid.cols, rows: grid.rows } as never, () => undefined);
    expect(session.restoreAll()).toBe(false);
    expect(designStore.getState().past).toEqual([]);
  });

  it("only rewrites the tiles that had edits", () => {
    const { offsets, sculptor } = fakeSculptor();
    offsets[3] = 0.25;
    const apply = vi.spyOn(sculptor, "apply");
    new HeightSession("b", sculptor, { cols: grid.cols, rows: grid.rows } as never, () => undefined).restoreAll();
    expect(apply.mock.calls[0][0]).toEqual([0]);
    expect(readTile(offsets, grid, 0).every((v) => v === 0)).toBe(true);
  });
});

describe("HeightSession.trap", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    designStore.getState().reset(emptyDoc());
  });
  afterEach(() => vi.useRealTimers());

  const cells = 150;
  /** A 150 m course at 1 m: ground 10 m everywhere, and a 16 m round bunker at (60, 60) painted in the class map. */
  function bunkerCourse() {
    const data = new Uint8Array(cells * cells * 4);
    for (let r = 0; r < cells; r++) for (let c = 0; c < cells; c++) data[(r * cells + c) * 4] = Math.hypot(c + 0.5 - 60, r + 0.5 - 60) <= 8 ? BUNKER_CLASS : 0;
    const g = { cols: cells, rows: cells };
    const offsets = new Float32Array(cells * cells);
    const sculptor = {
      offsets,
      apply: (keys: number[], tiles: Float32Array[]) => keys.forEach((key, n) => writeTile(offsets, g, key, tiles[n])),
      load: (o: Float32Array) => offsets.set(o),
    } as unknown as Sculptor;
    const effective = { cols: cells, rows: cells, values: new Float32Array(cells * cells).fill(10), valid: new Uint8Array(cells * cells).fill(1) };
    const redraw = vi.fn();
    const session = new HeightSession("b", sculptor, effective as never, redraw, () => ({
      classes: { data, width: cells, height: cells, res: 1 },
      grid: { cols: cells, rows: cells, res: 1, origin: { x: 0, z: 0 } },
    }));
    return { session, offsets, redraw };
  }

  it("knows which ground is a bunker", () => {
    const { session } = bunkerCourse();
    expect(session.isBunker([60, 60])).toBe(true);
    expect(session.isBunker([100, 100])).toBe(false);
    expect(session.isBunker([-5, 3])).toBe(false);
  });

  it("finds no trap where there is no bunker", () => {
    expect(bunkerCourse().session.trap([100, 100])).toBeNull();
  });

  it("shows the trap while it is tried, puts the ground back on cancel, and keeps it as one undo step", () => {
    const { session, offsets, redraw } = bunkerCourse();
    const edit = session.trap([60, 60])!;
    expect(edit.info.radius).toBeGreaterThan(6);
    const moved = edit.preview({ ...DEFAULT_TRAP, depth: 1, wall: 8, rough: 0, wobble: 0, tilt: 0, lip: 0, face: 0 });
    expect(moved.down).toBeGreaterThan(0.8);
    expect(offsets[60 * cells + 60]).toBeLessThan(-0.8); // dug out in the middle
    expect(redraw).toHaveBeenCalled();
    edit.cancel();
    expect(offsets.every((v) => v === 0)).toBe(true);

    edit.preview({ ...DEFAULT_TRAP, depth: 1, wall: 8, rough: 0, wobble: 0, tilt: 0, lip: 0, face: 0 });
    expect(edit.commit()).toBe(true);
    expect(designStore.getState().past.map((e) => e.label)).toEqual(["Sand trap"]);
    const dug = offsets[60 * cells + 60];
    designStore.getState().undo();
    expect(offsets.every((v) => v === 0)).toBe(true);
    designStore.getState().redo();
    expect(offsets[60 * cells + 60]).toBe(dug);
  });

  it("adds to what was sculpted there already, rather than replacing it", () => {
    const { session, offsets } = bunkerCourse();
    offsets[60 * cells + 60] = 0.5; // sculpted up half a metre before
    const edit = session.trap([60, 60])!;
    edit.preview({ ...DEFAULT_TRAP, depth: 1, wall: 8, rough: 0, wobble: 0, tilt: 0, lip: 0, face: 0 });
    expect(offsets[60 * cells + 60]).toBeCloseTo(0.5 - 1, 1);
  });

  it("keeps nothing when nothing was shown", () => {
    const { session } = bunkerCourse();
    expect(session.trap([60, 60])!.commit()).toBe(false);
    expect(designStore.getState().past).toEqual([]);
  });
});

