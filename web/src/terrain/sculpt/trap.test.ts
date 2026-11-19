import { describe, expect, it } from "vitest";
import { naturalOf, shoreField, type ClassRaster, type SampleGrid } from "./basin";
import { BUNKER_CLASS, DEFAULT_TRAP, TRAP_LIMITS, TRAP_PRESETS, carveTrap, noise, presetFor, rimOf, trapInfo, type TrapParams } from "./trap";

const RES = 1;
const SIZE = 60; // samples across and down; the class map has the same size at 1 m cells
const grid: SampleGrid = { cols: SIZE, rows: SIZE, res: RES, origin: { x: 0, z: 0 } };
const FLAT: TrapParams = { ...DEFAULT_TRAP, rough: 0, wobble: 0, tilt: 0, face: 0, lip: 0, level: false };

/** A class map with the cells where `inside(x, z)` (metres) bunker, and a field and ground made from it. */
function setup(inside: (x: number, z: number) => boolean, height: (x: number, z: number) => number = () => 10) {
  const data = new Uint8Array(SIZE * SIZE * 4);
  const heights = new Float32Array(SIZE * SIZE);
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      data[(r * SIZE + c) * 4] = inside(c + 0.5, r + 0.5) ? BUNKER_CLASS : 0;
      heights[r * SIZE + c] = height(c, r);
    }
  }
  const classes: ClassRaster = { data, width: SIZE, height: SIZE, res: RES };
  const field = shoreField(classes, [30, 30], grid, 16, BUNKER_CLASS)!;
  const natural = naturalOf(field, SIZE, heights, new Uint8Array(SIZE * SIZE).fill(1));
  const at = (h: Float32Array, x: number, z: number) => h[(z - field.z0) * field.w + (x - field.x0)];
  return { field, natural, at };
}

const disc = (r: number) => (x: number, z: number) => Math.hypot(x - 30, z - 30) <= r;
/** A strip `length` long and `width` across, lying east to west. */
const strip = (length: number, width: number) => (x: number, z: number) => Math.abs(x - 30) <= length / 2 && Math.abs(z - 30) <= width / 2;

describe("the trap's depth across a round bunker", () => {
  it("is a bowl when the walls are as wide as the bunker: deepest in the middle, rising evenly to the rim", () => {
    const { field, natural, at } = setup(disc(8));
    const { heights } = carveTrap(field, natural, grid, { ...FLAT, depth: 1, wall: 8, shape: 1 });
    const middle = at(heights, 30, 30);
    expect(middle).toBeCloseTo(9, 1); // 1 m below the 10 m ground
    const along = [30, 31, 32, 33, 34, 35, 36].map((x) => at(heights, x, 30));
    for (let i = 1; i < along.length; i++) expect(along[i]).toBeGreaterThan(along[i - 1] - 1e-6); // up, all the way out
    expect(at(heights, 37, 30)).toBeGreaterThan(9.8); // the edge is at the rim
  });

  it("has a flat floor and steep sides when the walls are narrow", () => {
    const { field, natural, at } = setup(disc(8));
    const { heights } = carveTrap(field, natural, grid, { ...FLAT, depth: 1, wall: 1, shape: 1 });
    for (const [x, z] of [[30, 30], [33, 30], [30, 34], [26, 27]]) expect(at(heights, x, z)).toBeCloseTo(9, 2); // the whole floor is at depth
    expect(at(heights, 38, 30)).toBeGreaterThan(9.3); // and it comes up within a metre of the edge (the edge is at 38)
  });

  it("has sides that drop faster for a smaller shape and ease in for a larger one", () => {
    const { field, natural, at } = setup(disc(8));
    const depthAt = (shape: number) => 10 - at(carveTrap(field, natural, grid, { ...FLAT, depth: 1, wall: 6, shape }).heights, 34, 30); // 4 m from the middle, 4 m in
    expect(depthAt(0.5)).toBeGreaterThan(depthAt(1));
    expect(depthAt(1)).toBeGreaterThan(depthAt(2));
  });
});

describe("a long, thin bunker is a trough", () => {
  it("is deepest along its middle and rises towards its ends, which are rounded", () => {
    const { field, natural, at } = setup(strip(24, 6));
    const { heights } = carveTrap(field, natural, grid, { ...FLAT, depth: 1, wall: 2 }); // the middle is 2.5 m from the sides
    expect(at(heights, 30, 30)).toBeCloseTo(9, 1); // the middle of the trough: full depth
    expect(at(heights, 22, 30)).toBeCloseTo(9, 1); // and along it
    expect(at(heights, 30, 28)).toBeGreaterThan(at(heights, 30, 30)); // up the side
    expect(at(heights, 41, 30)).toBeGreaterThan(at(heights, 30, 30) + 0.4); // up at the end
  });
});

describe("the rim and the lip", () => {
  it("leaves the ground alone beyond the lip's reach", () => {
    const { field, natural, at } = setup(disc(6), (x, z) => 10 + 0.03 * x + 0.01 * z);
    const { heights } = carveTrap(field, natural, grid, { ...DEFAULT_TRAP, lipWidth: 4 });
    for (const [x, z] of [[30 + 6 + 5, 30], [30, 30 - 6 - 6], [30 - 6 - 8, 30]]) expect(at(heights, x, z)).toBeCloseTo(at(natural.heights, x, z), 4);
  });

  it("stands the lip above the rim, and higher on the side the trap faces", () => {
    const { field, natural, at } = setup(disc(6));
    const lip = carveTrap(field, natural, grid, { ...FLAT, lip: 0.2, lipWidth: 6, face: 0.4, facing: 90 }).heights; // faces east
    const east = at(lip, 30 + 6 + 2, 30) - 10, west = at(lip, 30 - 6 - 2, 30) - 10;
    expect(west).toBeGreaterThan(0.05);
    expect(east).toBeGreaterThan(west + 0.1);
  });

  it("takes the floor down with the slope when it follows the ground, and holds it level when it is told to", () => {
    const slope = (x: number) => 10 + 0.05 * x; // 5% down to the west
    const a = setup(disc(8), slope);
    const follow = carveTrap(a.field, a.natural, grid, { ...FLAT, depth: 1, wall: 1, level: false }).heights;
    expect(a.at(follow, 26, 30) - a.at(follow, 34, 30)).toBeCloseTo(-0.4, 1); // the floor rises 40 cm over 8 m with the ground
    const level = carveTrap(a.field, a.natural, grid, { ...FLAT, depth: 1, wall: 1, level: true }).heights;
    expect(a.at(level, 26, 30)).toBeCloseTo(a.at(level, 34, 30), 2); // flat
  });

  it("measures its depth from where the ground round the rim is, not from the rest of the map", () => {
    const { field, natural, at } = setup(disc(6), (x, z) => (Math.hypot(x - 30, z - 30) < 12 ? 25 : 10)); // a plateau of 25 m round the trap
    const { heights } = carveTrap(field, natural, grid, { ...FLAT, depth: 1, wall: 3 });
    expect(at(heights, 30, 30)).toBeCloseTo(24, 0);
  });
});

describe("what makes each trap different", () => {
  it("tilts the floor deeper on the side it faces", () => {
    const { field, natural, at } = setup(disc(8));
    const { heights } = carveTrap(field, natural, grid, { ...FLAT, depth: 0.8, wall: 1, tilt: 0.6, facing: 180 }); // faces south
    expect(at(heights, 30, 35)).toBeLessThan(at(heights, 30, 25) - 0.5);
  });

  it("is the same for the same seed, differs for another, and ignores the seed when there is no roughness or wobble", () => {
    const { field, natural } = setup(disc(8));
    const make = (p: Partial<TrapParams>) => carveTrap(field, natural, grid, { ...DEFAULT_TRAP, ...p }).heights;
    expect(Array.from(make({ seed: 3 }))).toEqual(Array.from(make({ seed: 3 })));
    expect(Array.from(make({ seed: 3 }))).not.toEqual(Array.from(make({ seed: 4 })));
    expect(Array.from(make({ seed: 3, rough: 0, wobble: 0 }))).toEqual(Array.from(make({ seed: 4, rough: 0, wobble: 0 })));
  });

  it("changes the floor by about the roughness and no more", () => {
    const { field, natural } = setup(disc(8));
    const calm = carveTrap(field, natural, grid, { ...FLAT, depth: 1, wall: 1 }).heights;
    const rough = carveTrap(field, natural, grid, { ...FLAT, depth: 1, wall: 1, rough: 0.2, roughSize: 2 }).heights;
    let most = 0;
    for (let i = 0; i < calm.length; i++) most = Math.max(most, Math.abs(rough[i] - calm[i]));
    expect(most).toBeGreaterThan(0.05);
    expect(most).toBeLessThanOrEqual(0.2 + 1e-6);
  });

  it("never digs above the rim, whatever the settings", () => {
    const { field, natural } = setup(disc(8));
    for (const preset of TRAP_PRESETS) {
      const { heights, down } = carveTrap(field, natural, grid, { ...presetFor(preset.id, 8), lip: 0, face: 0 });
      expect(down).toBeGreaterThan(0.1);
      expect(Math.max(...heights)).toBeLessThanOrEqual(10 + 1e-5);
    }
  });
});

describe("the bunker's facts and the presets", () => {
  it("measures how far in the middle of the widest part is, and the rim's slope", () => {
    const { field, natural } = setup(disc(8), (x) => 10 + 0.05 * x);
    const info = trapInfo(field, natural, grid)!;
    expect(info.radius).toBeGreaterThan(7);
    expect(info.radius).toBeLessThan(9);
    expect(info.area).toBeGreaterThan(Math.PI * 7 * 7);
    expect(info.slope).toBeCloseTo(5, 0);
  });

  it("has a rim to fit, unless the outline is on ground with no data", () => {
    const { field, natural } = setup(disc(8));
    expect(rimOf(field, natural, grid)).not.toBeNull();
    expect(rimOf(field, { ...natural, valid: new Uint8Array(natural.valid.length) }, grid)).toBeNull();
    const none = carveTrap(field, { ...natural, valid: new Uint8Array(natural.valid.length) }, grid, DEFAULT_TRAP);
    expect(none.up + none.down).toBe(0);
  });

  it("leaves samples with no data alone", () => {
    const { field, natural } = setup(disc(8));
    const valid = Uint8Array.from(natural.valid);
    valid[Math.floor(valid.length / 2)] = 0;
    const { heights } = carveTrap(field, { ...natural, valid }, grid, DEFAULT_TRAP);
    expect(heights[Math.floor(valid.length / 2)]).toBe(natural.heights[Math.floor(valid.length / 2)]);
  });

  it("makes presets that stay inside every slider's range", () => {
    for (const preset of TRAP_PRESETS) {
      for (const radius of [0.5, 3, 40]) {
        const p = presetFor(preset.id, radius) as unknown as Record<string, number | boolean>;
        for (const [key, [lo, hi]] of Object.entries(TRAP_LIMITS)) {
          expect(p[key] as number, `${preset.id} ${key} at ${radius}`).toBeGreaterThanOrEqual(lo);
          expect(p[key] as number, `${preset.id} ${key} at ${radius}`).toBeLessThanOrEqual(hi);
        }
      }
    }
  });
});

describe("noise", () => {
  it("is smooth, bounded and repeatable", () => {
    for (let i = 0; i < 200; i++) {
      const x = i * 0.37, z = i * 0.91;
      const v = noise(x, z, 5);
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThanOrEqual(1);
      expect(Math.abs(noise(x + 0.01, z, 5) - v)).toBeLessThan(0.1);
      expect(noise(x, z, 5)).toBe(v);
    }
  });
});
