import { api } from "../core/api/api";
import type { HeightGrid } from "../core/decode/decode";
import { designStore } from "../model/design/store";
import type { Sculptor, Stamp } from "../terrain/sculpt/sculptor";
import { decodeDelta, encodeDelta } from "../terrain/sculpt/tiles";

const SAVE_DELAY = 500;

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
