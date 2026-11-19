import { api } from "../core/api/api";
import type { HeightGrid } from "../core/decode/decode";
import { designStore } from "../model/design/store";
import { carve, naturalOf, shoreField, shoreStats, type BasinParams, type Carved, type ClassRaster, type Natural, type SampleGrid, type ShoreField, type ShoreStats } from "../terrain/sculpt/basin";
import { BUNKER_CLASS, carveTrap, TRAP_REACH, trapInfo, type TrapInfo, type TrapParams } from "../terrain/sculpt/trap";
import type { Sculptor, Stamp } from "../terrain/sculpt/sculptor";
import { decodeDelta, encodeDelta, readTile, tileKey, tileRect, tilesAcross, tilesDown, tilesInBox, TILE } from "../terrain/sculpt/tiles";

const SAVE_DELAY = 500;
/** The most a sculpted height may differ from the baked one (the sculptor's own limit). */
const MAX_OFFSET = 32;

/** What the basin needs to know of the course: its surface classes and the grid of heights. */
export type BasinSource = { classes: ClassRaster; grid: SampleGrid };

/** A lake basin being tried: shown on the terrain as it would be cut, and kept or put back. */
export type BasinEdit = {
  /** How the natural ground meets the water round the outline; null when there is no ground data there. */
  stats: ShoreStats | null;
  /** Show the basin with these settings in place of what was shown. Returns the most the ground was raised and lowered, in metres. */
  preview: (p: BasinParams) => { up: number; down: number };
  /** Keep what is shown: one undo step, and saved. Does nothing if nothing was shown. */
  commit: (label?: string) => boolean;
  /** Put the ground back as it was. */
  cancel: () => void;
};

/** A sand trap being tried: shown on the terrain as it would be cut, and kept or put back. */
export type TrapEdit = {
  /** What the sliders need to know of the bunker. */
  info: TrapInfo;
  /** Show the trap with these settings in place of what was shown. Returns the most the ground was raised and lowered, in metres. */
  preview: (p: TrapParams) => { up: number; down: number };
  /** Keep what is shown: one undo step, and saved. Does nothing if nothing was shown. */
  commit: (label?: string) => boolean;
  /** Put the ground back as it was. */
  cancel: () => void;
};

/**
 * The terrain sculpting of one open bundle: loads and saves the offsets file, and turns strokes into undo steps. The
 * brushes themselves run on the GPU (see Sculptor); this is the part that knows about the project.
 */
export class HeightSession {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private saving = false;
  private again = false;
  /** Called with a message when saving fails, and with null when it works again. */
  onError: (message: string | null) => void = () => {};

  constructor(
    private readonly bundle: string,
    private readonly sculptor: Sculptor,
    private readonly effective: HeightGrid,
    private readonly redraw: () => void,
    /** The class map and height grid as they are now, for the lake basin. */
    private readonly basinSource: () => BasinSource = () => {
      throw new Error("this session has no class map");
    },
  ) {}

  private get grid() {
    return { cols: this.effective.cols, rows: this.effective.rows };
  }

  async load() {
    const bytes = await api.heightDelta(this.bundle);
    this.sculptor.load(decodeDelta(bytes, this.grid));
  }

  /** One dab of a brush. */
  stamp(s: Stamp) {
    this.sculptor.stamp(s);
  }

  /** Show what the stamps since the last call did. */
  show() {
    this.redraw();
  }

  /** The stroke is done: it becomes one undo step, and is saved. */
  end(label = "Sculpt") {
    const change = this.sculptor.commit();
    if (!change) return;
    designStore.getState().pushExternal(label, {
      undo: () => this.set(change.keys, change.before),
      redo: () => this.set(change.keys, change.after),
    });
    this.changed();
  }

  /**
   * Take every edit away, so the ground is what was baked. One undo step, and saved. False when there was nothing to take away.
   * (The Restore brush does the same under a brush; this is the whole map at once.)
   */
  restoreAll(label = "Restore the original terrain"): boolean {
    const keys: number[] = [];
    const before: Float32Array[] = [];
    for (let key = 0; key < tilesAcross(this.grid) * tilesDown(this.grid); key++) {
      const tile = readTile(this.sculptor.offsets, this.grid, key);
      if (tile.some((v) => v !== 0)) {
        keys.push(key);
        before.push(tile);
      }
    }
    if (!keys.length) return false;
    const after = before.map((t) => new Float32Array(t.length));
    this.set(keys, after);
    designStore.getState().pushExternal(label, {
      undo: () => this.set(keys, before),
      redo: () => this.set(keys, after),
    });
    return true;
  }

  /**
   * Try a basin round the lake that has `anchor` in its water, with the surface at `level`. Nothing is kept until `commit`; the ground is
   * shown changed as the settings change, and `cancel` (or another basin begun on top) puts it back. Null when there is no lake at `anchor`.
   */
  basin(anchor: readonly [number, number], level: number): BasinEdit | null {
    const { classes, grid } = this.basinSource();
    const field = shoreField(classes, anchor, grid);
    if (!field) return null;
    const natural = naturalOf(field, this.effective.cols, this.effective.values, this.effective.valid);
    const edit = this.carveEdit(field, natural, (p: BasinParams) => carve(field, natural, level, p));
    return { stats: shoreStats(field, natural, level), preview: edit.preview, commit: (label = "Lake basin") => edit.commit(label), cancel: edit.cancel };
  }

  /** Whether the ground at a point is painted as a bunker (in the class map as the last build made it). */
  isBunker(at: readonly [number, number]): boolean {
    const { classes } = this.basinSource();
    const c = Math.floor(at[0] / classes.res), r = Math.floor(at[1] / classes.res);
    return c >= 0 && r >= 0 && c < classes.width && r < classes.height && classes.data[(r * classes.width + c) * 4] === BUNKER_CLASS;
  }

  /**
   * Try a sand trap in the bunker that has `anchor` in it: shown on the ground as its settings change, kept by `commit` as one undo step, put
   * back by `cancel`. Null when there is no bunker at `anchor`, or none of its ground has data.
   */
  trap(anchor: readonly [number, number]): TrapEdit | null {
    const { classes, grid } = this.basinSource();
    const field = shoreField(classes, anchor, grid, TRAP_REACH, BUNKER_CLASS);
    if (!field) return null;
    const natural = naturalOf(field, this.effective.cols, this.effective.values, this.effective.valid);
    const info = trapInfo(field, natural, grid);
    if (!info) return null;
    const edit = this.carveEdit(field, natural, (p: TrapParams) => carveTrap(field, natural, grid, p));
    return { info, preview: edit.preview, commit: (label = "Sand trap") => edit.commit(label), cancel: edit.cancel };
  }

  /**
   * What the basin and the sand trap share: a window of ground (a field's samples) that is shown carved as settings change, kept as one undo
   * step, or put back. `compute` is the ground the settings make; what is shown is the change it makes, added to the sculpting there already.
   */
  private carveEdit<P>(field: ShoreField, natural: Natural, compute: (p: P) => Carved) {
    const keys = tilesInBox(this.grid, field.x0, field.z0, field.x0 + field.w - 1, field.z0 + field.h - 1);
    const at = new Map(keys.map((key, n) => [key, n]));
    const before = keys.map((key) => readTile(this.sculptor.offsets, this.grid, key));
    let shown: Float32Array[] | null = null;

    const show = (tiles: Float32Array[]) => {
      this.sculptor.apply(keys, tiles);
      this.redraw();
    };
    return {
      preview: (p: P) => {
        const carved = compute(p);
        const tiles = before.map((t) => t.slice());
        for (let j = 0; j < field.h; j++) {
          for (let i = 0; i < field.w; i++) {
            const x = field.x0 + i, z = field.z0 + j;
            const key = tileKey(this.grid, Math.floor(x / TILE), Math.floor(z / TILE));
            const n = at.get(key);
            if (n === undefined) continue;
            const r = tileRect(this.grid, key);
            const cell = (z - r.y) * r.w + x - r.x;
            const moved = carved.heights[j * field.w + i] - natural.heights[j * field.w + i];
            tiles[n][cell] = Math.max(-MAX_OFFSET, Math.min(MAX_OFFSET, tiles[n][cell] + moved));
          }
        }
        shown = tiles;
        show(tiles);
        return { up: carved.up, down: carved.down };
      },
      commit: (label: string) => {
        const after = shown;
        shown = null;
        if (!after || after.every((t, n) => t.every((v, i) => v === before[n][i]))) return false;
        designStore.getState().pushExternal(label, {
          undo: () => this.set(keys, before),
          redo: () => this.set(keys, after),
        });
        this.changed();
        return true;
      },
      cancel: () => {
        if (!shown) return;
        shown = null;
        show(before);
      },
    };
  }

  private set(keys: number[], tiles: Float32Array[]) {
    this.sculptor.apply(keys, tiles);
    this.changed();
  }

  private changed() {
    this.redraw();
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.save(), SAVE_DELAY);
  }

  /** Save now. A save in flight is followed by one more, so the last change is never left behind. */
  async save() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.saving) {
      this.again = true;
      return;
    }
    this.saving = true;
    try {
      await api.saveHeightDelta(this.bundle, encodeDelta(this.sculptor.offsets, this.grid));
      this.onError(null);
    } catch (e) {
      this.onError(`Couldn't save the terrain: ${(e as Error).message}`);
    } finally {
      this.saving = false;
      if (this.again) {
        this.again = false;
        void this.save();
      }
    }
  }
}
