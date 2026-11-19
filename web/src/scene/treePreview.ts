import type { Region, TreeEdits } from "../core/api/api";
import type { Doc } from "../model/design/store";

/** What a forest preview is asked: the tree edits, and each woods patch's own settings by id (null: it takes the woods defaults). */
export type PreviewRequest = { edits: TreeEdits; settings: Record<string, Region["trees"]> };

/** The request for the design as it is now. */
export function requestOf(doc: Doc): PreviewRequest {
  const settings: PreviewRequest["settings"] = {};
  for (const id of doc.order) if (doc.regions[id]?.class === 8) settings[id] = doc.regions[id].trees;
  return { edits: doc.trees, settings };
}

/**
 * What decides the trees, as a short list of references: the tree edits (which hold the defaults, the placed trees and the clearings) and
 * each woods patch's settings. The design keeps what it did not change as the same object, so two lists with the same members mean the
 * same trees, and a slider tick or a click changes one of them. Nothing else in the design (a hole's par, a fairway's outline) is in it.
 */
export function signatureOf(doc: Doc): unknown[] {
  return [doc.trees, ...doc.order.flatMap((id) => (doc.regions[id]?.class === 8 ? [id, doc.regions[id].trees] : []))];
}

export const sameSignature = (a: readonly unknown[], b: readonly unknown[]) => a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * Asks for a preview as a slider is dragged, without ever having more than one in flight: while one is out, newer asks collapse into a
 * single one for whatever the design is when it comes back. So the view follows the hand as fast as the server answers, and never queues up
 * answers to settings that have already been dragged past.
 */
export class Previewer {
  private asked = false;
  private busy = false;

  constructor(
    /** Ask the server. */
    private readonly send: () => Promise<ArrayBuffer>,
    /** Show what it said. */
    private readonly show: (trees: ArrayBuffer) => void,
    private readonly failed: (e: Error) => void = () => {},
  ) {}

  /** The design changed: show its trees as soon as the one in flight (if any) is back. */
  ask() {
    this.asked = true;
    if (!this.busy) void this.run();
  }

  /** Whether one is in flight. */
  get working() {
    return this.busy;
  }

  private async run() {
    this.busy = true;
    try {
      while (this.asked) {
        this.asked = false;
        try {
          this.show(await this.send());
        } catch (e) {
          this.failed(e as Error); // the build that follows the release says what is wrong; a preview that failed is only not shown
        }
      }
    } finally {
      this.busy = false;
    }
  }
}
