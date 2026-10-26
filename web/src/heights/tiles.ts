// Terrain edits are stored as a sparse set of 64 x 64 tiles of height offsets (docs: course_maker/build/height.py, which
// reads the same file). The browser keeps the whole offset grid; tiles are the unit of undo, of saving and of upload.

export const TILE = 64;
const MM = 1000;
const MAGIC = [0x48, 0x44, 0x4c, 0x54]; // "HDLT"
const VERSION = 1;
const HEADER = 20; // magic, version, tile size, columns, rows, tile count

export type Grid = { cols: number; rows: number };
export type Rect = { x: number; y: number; w: number; h: number };

export const tilesAcross = (g: Grid) => Math.ceil(g.cols / TILE);
export const tilesDown = (g: Grid) => Math.ceil(g.rows / TILE);
export const tileKey = (g: Grid, tx: number, ty: number) => ty * tilesAcross(g) + tx;

/** The samples a tile covers, clipped to the grid. */
export function tileRect(g: Grid, key: number): Rect {
  const across = tilesAcross(g);
  const tx = key % across, ty = Math.floor(key / across);
  const x = tx * TILE, y = ty * TILE;
  return { x, y, w: Math.min(TILE, g.cols - x), h: Math.min(TILE, g.rows - y) };
}

/** Keys of the tiles touched by the samples x0..x1, y0..y1 (inclusive, in any order, clipped to the grid). */
export function tilesInBox(g: Grid, x0: number, y0: number, x1: number, y1: number): number[] {
  const lo = (v: number, n: number) => Math.min(n - 1, Math.max(0, Math.floor(v / TILE)));
  const [ax, bx] = [lo(Math.min(x0, x1), tilesAcross(g)), lo(Math.max(x0, x1), tilesAcross(g))];
  const [ay, by] = [lo(Math.min(y0, y1), tilesDown(g)), lo(Math.max(y0, y1), tilesDown(g))];
  const keys: number[] = [];
  for (let ty = ay; ty <= by; ty++) for (let tx = ax; tx <= bx; tx++) keys.push(tileKey(g, tx, ty));
  return keys;
}

/** A copy of one tile of a grid-sized array, row by row at the tile's own width. */
export function readTile(values: Float32Array, g: Grid, key: number): Float32Array {
  const r = tileRect(g, key);
  const out = new Float32Array(r.w * r.h);
  for (let j = 0; j < r.h; j++) out.set(values.subarray((r.y + j) * g.cols + r.x, (r.y + j) * g.cols + r.x + r.w), j * r.w);
  return out;
}

export function writeTile(values: Float32Array, g: Grid, key: number, tile: Float32Array) {
  const r = tileRect(g, key);
  for (let j = 0; j < r.h; j++) values.set(tile.subarray(j * r.w, (j + 1) * r.w), (r.y + j) * g.cols + r.x);
}

/** The offsets as the file the server reads: millimetres in int16, only for tiles with something in them. */
export function encodeDelta(values: Float32Array, g: Grid): Uint8Array {
  const tiles: { tx: number; ty: number; mm: Int16Array }[] = [];
  for (let ty = 0; ty < tilesDown(g); ty++) {
    for (let tx = 0; tx < tilesAcross(g); tx++) {
      const r = tileRect(g, tileKey(g, tx, ty));
      const mm = new Int16Array(TILE * TILE); // padded to a full tile past the grid's edge
      let any = false;
      for (let j = 0; j < r.h; j++) {
        for (let i = 0; i < r.w; i++) {
          const v = Math.max(-32767, Math.min(32767, Math.round(values[(r.y + j) * g.cols + r.x + i] * MM)));
          mm[j * TILE + i] = v;
          if (v) any = true;
        }
      }
      if (any) tiles.push({ tx, ty, mm });
    }
  }
  const out = new Uint8Array(HEADER + tiles.length * (4 + TILE * TILE * 2));
  const dv = new DataView(out.buffer);
  out.set(MAGIC, 0);
  dv.setUint16(4, VERSION, true);
  dv.setUint16(6, TILE, true);
  dv.setUint32(8, g.cols, true);
  dv.setUint32(12, g.rows, true);
  dv.setUint32(16, tiles.length, true);
  tiles.forEach((t, n) => {
    const at = HEADER + n * (4 + TILE * TILE * 2);
    dv.setUint16(at, t.tx, true);
    dv.setUint16(at + 2, t.ty, true);
    for (let i = 0; i < t.mm.length; i++) dv.setInt16(at + 4 + i * 2, t.mm[i], true);
  });
  return out;
}

/** The offsets from a file; an empty file is no edits. Throws if the file is not one for this grid. */
export function decodeDelta(bytes: Uint8Array, g: Grid): Float32Array {
  const out = new Float32Array(g.cols * g.rows);
  if (!bytes.length) return out;
  if (bytes.length < HEADER || MAGIC.some((b, i) => bytes[i] !== b)) throw new Error("not a height delta file");
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint16(4, true) !== VERSION || dv.getUint16(6, true) !== TILE) throw new Error("a height delta file of another version");
  if (dv.getUint32(8, true) !== g.cols || dv.getUint32(12, true) !== g.rows) throw new Error("the height delta file is for a different grid");
  const count = dv.getUint32(16, true);
  const each = 4 + TILE * TILE * 2;
  if (bytes.length !== HEADER + count * each) throw new Error("the height delta file is damaged");
  for (let n = 0; n < count; n++) {
    const at = HEADER + n * each;
    const tx = dv.getUint16(at, true), ty = dv.getUint16(at + 2, true);
    if (tx >= tilesAcross(g) || ty >= tilesDown(g)) throw new Error("the height delta file has a tile outside the grid");
    const r = tileRect(g, tileKey(g, tx, ty));
    for (let j = 0; j < r.h; j++) for (let i = 0; i < r.w; i++) out[(r.y + j) * g.cols + r.x + i] = dv.getInt16(at + 4 + (j * TILE + i) * 2, true) / MM;
  }
  return out;
}
