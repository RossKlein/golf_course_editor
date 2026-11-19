import { describe, expect, it } from "vitest";
import { BASIN_LIMITS, BASIN_REACH, DEFAULT_BASIN, WATERLINE_SINK, WATER_CLASS, basinHeight, carve, distanceToFeatures, naturalOf, shoreField, shoreStats, type BasinParams, type ClassRaster, type SampleGrid } from "./basin";

const P: BasinParams = { ...DEFAULT_BASIN };
const LEVEL = 50;

/** A class map of `cells` x `cells` rough, with a disc of water at (cx, cz) metres, radius `r`. */
function discMap(cells: number, res: number, cx: number, cz: number, r: number): ClassRaster & { data: Uint8Array } {
  const data = new Uint8Array(cells * cells * 4);
  for (let row = 0; row < cells; row++) {
    for (let col = 0; col < cells; col++) {
      const x = (col + 0.5) * res, z = (row + 0.5) * res;
      data[(row * cells + col) * 4] = Math.hypot(x - cx, z - cz) <= r ? WATER_CLASS : 0;
    }
  }
  return { data, width: cells, height: cells, res };
}

describe("the distance transform", () => {
  it("measures straight and diagonal distances to the nearest feature", () => {
    const feature = new Uint8Array(5 * 5);
    feature[2 * 5 + 2] = 1;
    const d = distanceToFeatures(feature, 5, 5);
    expect(d[2 * 5 + 2]).toBe(0);
    expect(d[2 * 5 + 4]).toBeCloseTo(2, 5);
    expect(d[0]).toBeCloseTo(Math.hypot(2, 2), 5);
  });

  it("takes the nearer of two features", () => {
    const feature = new Uint8Array(9);
    feature[0] = 1;
    feature[8] = 1;
    const d = distanceToFeatures(feature, 9, 1);
    expect(Array.from(d)).toEqual([0, 1, 2, 3, 4, 3, 2, 1, 0]);
  });

  it("copes with no feature at all", () => {
    expect(distanceToFeatures(new Uint8Array(4), 2, 2)[0]).toBeGreaterThan(1e6);
  });
});

describe("the profile across the shore", () => {
  it("is a hair below the water at the waterline, whatever the ground was", () => {
    for (const natural of [LEVEL - 3, LEVEL, LEVEL + 4]) {
      expect(basinHeight(0, natural, 0.3, LEVEL, P)).toBeCloseTo(LEVEL - WATERLINE_SINK, 9);
    }
  });

  it("falls away to the depth across the bed, whatever the ground was", () => {
    expect(basinHeight(-P.bedWidth, LEVEL + 9, 1, LEVEL, P)).toBeCloseTo(LEVEL - WATERLINE_SINK - P.depth, 9);
    expect(basinHeight(-100, LEVEL - 30, 0, LEVEL, P)).toBeCloseTo(LEVEL - WATERLINE_SINK - P.depth, 9);
    let last = Infinity;
    for (let s = 0; s >= -P.bedWidth; s -= 0.25) {
      const h = basinHeight(s, LEVEL, 0, LEVEL, P);
      expect(h).toBeLessThanOrEqual(last + 1e-9);
      last = h;
    }
  });

  it("gives way to the natural ground at the edge of the bank, and not before", () => {
    expect(basinHeight(P.bankWidth, 53.7, 0.2, LEVEL, P)).toBe(53.7);
    expect(basinHeight(P.bankWidth + 20, 49, 0.2, LEVEL, P)).toBe(49);
    expect(basinHeight(P.bankWidth * 0.5, 53.7, 0, LEVEL, P)).not.toBe(53.7);
  });

  it("rises from the waterline to ground that is level with the water, and does not stand up from it with no bank rise", () => {
    const p = { ...P, bankRise: 0, detail: 0 };
    let last = -Infinity;
    for (let s = 0; s <= p.bankWidth; s += 0.1) {
      const h = basinHeight(s, LEVEL, 0, LEVEL, p);
      expect(h).toBeGreaterThanOrEqual(last - 1e-9);
      expect(h).toBeLessThanOrEqual(LEVEL + 1e-9);
      last = h;
    }
    expect(last).toBeCloseTo(LEVEL, 3); // the loop stops just short of the bank's edge
  });

  it("stands up as a lip of the bank rise along the shore, on ground level with the water", () => {
    const p = { ...P, bankRise: 0.4, detail: 0 };
    let top = -Infinity;
    for (let s = 0; s <= p.bankWidth; s += 0.1) top = Math.max(top, basinHeight(s, LEVEL, 0, LEVEL, p));
    expect(top - LEVEL).toBeGreaterThan(0.15);
    expect(top - LEVEL).toBeLessThan(0.4);
  });

  it("keeps none of the bumps at the waterline and more of them further up the bank", () => {
    const flat = basinHeight(0.3, LEVEL, 0, LEVEL, { ...P, detail: 1 });
    const bumpy = basinHeight(0.3, LEVEL, 0.4, LEVEL, { ...P, detail: 1 });
    expect(bumpy - flat).toBeLessThan(0.05);
    const high = basinHeight(P.bankWidth * 0.5, LEVEL, 0.4, LEVEL, { ...P, detail: 1 }) - basinHeight(P.bankWidth * 0.5, LEVEL, 0, LEVEL, { ...P, detail: 1 });
    expect(high).toBeGreaterThan(0.1);
    expect(basinHeight(P.bankWidth * 0.5, LEVEL, 0.4, LEVEL, { ...P, detail: 0 })).toBeCloseTo(basinHeight(P.bankWidth * 0.5, LEVEL, 0, LEVEL, { ...P, detail: 0 }), 9);
  });

  it("moves the waterline inwards by the shift", () => {
    const p = { ...P, shift: 1.5 };
    expect(basinHeight(-1.5, LEVEL + 2, 0, LEVEL, p)).toBeCloseTo(LEVEL - WATERLINE_SINK, 9);
    expect(basinHeight(0, LEVEL, 0, LEVEL, p)).toBeGreaterThan(LEVEL - WATERLINE_SINK); // a metre and a half up the bank by now
  });

  it("has limits that its reach covers", () => {
    expect(BASIN_LIMITS.bankWidth[1] + BASIN_LIMITS.shift[1]).toBeLessThan(BASIN_REACH);
  });
});

describe("the shore of a lake", () => {
  const grid: SampleGrid = { cols: 121, rows: 121, res: 1, origin: { x: 0, z: 0 } };
  const classes = discMap(240, 0.5, 60, 60, 20);

  it("is a signed distance to the outline in metres, negative in the water", () => {
    const f = shoreField(classes, [60, 60], grid, 10)!;
    const at = (x: number, z: number) => f.s[(z - f.z0) * f.w + x - f.x0];
    const near = (got: number, want: number) => expect(Math.abs(got - want)).toBeLessThan(0.75); // a cell is half a metre, and a disc of them is not round
    near(at(60, 60), -20);
    near(at(60, 40), 0); // on the rim
    near(at(60, 35), 5);
    near(at(80, 60), 0);
    near(at(60, 70), -10);
    near(at(60 + 20 + 7, 60), 7);
  });

  it("covers the lake and its reach, and no more than the grid", () => {
    // the lake spans 40 to 80 m; its reach, 10 m, and two cells over, make the window 29 m to 91 m
    const f = shoreField(classes, [60, 60], grid, 10)!;
    expect([f.x0, f.z0]).toEqual([29, 29]);
    expect([f.w, f.h]).toEqual([63, 63]);
    const wide = shoreField(classes, [60, 60], grid, 60)!;
    expect([wide.x0, wide.z0, wide.w, wide.h]).toEqual([0, 0, 121, 121]);
  });

  it("is only for the lake at the anchor", () => {
    const two = discMap(240, 0.5, 30, 60, 10);
    for (let row = 0; row < 240; row++) for (let col = 150; col < 190; col++) if (Math.hypot((col + 0.5) * 0.5 - 85, (row + 0.5) * 0.5 - 60) <= 8) two.data[(row * 240 + col) * 4] = WATER_CLASS;
    const f = shoreField(two, [30, 60], grid, 6)!;
    expect(f.x0 + f.w - 1).toBeLessThan(60); // the far one, 40 m away, is land to this field and outside its window
    expect(shoreField(two, [60, 10], grid, 6)).toBeNull(); // dry land
  });
});

describe("carving a basin", () => {
  const grid: SampleGrid = { cols: 121, rows: 121, res: 1, origin: { x: 0, z: 0 } };
  const classes = discMap(240, 0.5, 60, 60, 20);
  const field = shoreField(classes, [60, 60], grid)!;
  // ground that slopes 4 cm per metre across the course, with a little noise, and a hollow where the lake is
  const heights = new Float32Array(121 * 121);
  const valid = new Uint8Array(121 * 121).fill(1);
  for (let z = 0; z < 121; z++) for (let x = 0; x < 121; x++) heights[z * 121 + x] = LEVEL + (x - 60) * 0.04 + Math.sin(x * 1.7 + z * 0.9) * 0.15 - (Math.hypot(x - 60, z - 60) < 20 ? 2 : 0);
  const natural = naturalOf(field, 121, heights, valid);

  it("leaves the ground below the water inside the outline and close to it just outside, wherever the ground was", () => {
    const carved = carve(field, natural, LEVEL, P);
    let checked = 0;
    for (let i = 0; i < carved.heights.length; i++) {
      if (field.s[i] <= 0) expect(carved.heights[i]).toBeLessThan(LEVEL);
      if (field.s[i] > 0 && field.s[i] <= 0.5) {
        expect(carved.heights[i]).toBeGreaterThan(LEVEL - 0.15);
        expect(carved.heights[i]).toBeLessThan(LEVEL + 0.25);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(20);
  });

  it("changes nothing past the bank", () => {
    const carved = carve(field, natural, LEVEL, P);
    for (let i = 0; i < carved.heights.length; i++) if (field.s[i] > P.bankWidth) expect(carved.heights[i]).toBe(natural.heights[i]);
  });

  it("leaves samples with no data alone", () => {
    const hole = { ...natural, valid: natural.valid.slice() };
    const middle = 35 * field.w + 35;
    hole.valid[middle] = 0;
    expect(carve(field, hole, LEVEL, P).heights[middle]).toBe(natural.heights[middle]);
  });

  it("reports the most the ground moved", () => {
    const carved = carve(field, natural, LEVEL, P);
    expect(carved.up).toBeGreaterThan(0);
    expect(carved.down).toBeGreaterThan(0);
    let lowered = 0;
    for (let i = 0; i < carved.heights.length; i++) lowered = Math.max(lowered, natural.heights[i] - carved.heights[i]);
    expect(carved.down).toBeCloseTo(lowered, 6);
  });

  it("is steeper at the shore for a smaller bed width", () => {
    const wide = carve(field, natural, LEVEL, { ...P, bedWidth: 12 });
    const narrow = carve(field, natural, LEVEL, { ...P, bedWidth: 2 });
    const probe = field.s.findIndex((s) => s < -1.9 && s > -2.1);
    expect(narrow.heights[probe]).toBeLessThan(wide.heights[probe]);
  });

  it("tells how the natural ground meets the water", () => {
    const stats = shoreStats(field, natural, LEVEL)!;
    expect(stats.low).toBeLessThan(stats.mid);
    expect(stats.mid).toBeLessThan(stats.high);
    expect(stats.high - stats.low).toBeGreaterThan(1); // the ground slopes across the lake, 4 cm a metre over 40 m
  });

  it("gives back the carved ground as the same thing however often it is worked out", () => {
    const a = carve(field, natural, LEVEL, P);
    const b = carve(field, natural, LEVEL, P);
    expect(Array.from(a.heights)).toEqual(Array.from(b.heights));
  });
});
