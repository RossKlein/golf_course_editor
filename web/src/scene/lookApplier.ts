import type { Look } from "../core/api/api";

/** How long the hand must be still, in the middle of a drag or while typing, before a change of look is applied. */
export const LOOK_QUIET_MS = 300;

/** `pending`: an edit is waiting for a pause or a release. `updating`: it is being applied (and baked) and saved. */
export type LookPhase = "idle" | "pending" | "updating";

export type LookStatus = {
  phase: LookPhase;
  /** The look the 3D view is showing; null before one is set. */
  applied: Look | null;
  /** Why the last save failed, until one succeeds. */
  error: string | null;
};

type Deps = {
  /** Show `look` on the course. Resolves when the bakes it needs have run. */
  apply: (look: Look) => Promise<void> | void;
  /** Write `look` to the course. `keepalive` is for a page that is closing. */
  save: (look: Look, keepalive: boolean) => Promise<void>;
  quietMs?: number;
};

/**
 * What happens to a change of look (docs/look-editor-plan.md, section 3). The panel shows a change at once; this decides
 * when the course does. A change is applied when it is finished (`finish`: a release, Enter, a pick) or when the hand has been
 * still for `quietMs`, then saved straight after. Latest wins: a change during an apply starts the wait again, and the
 * apply and save that are running finish first, so jobs never overlap.
 */
export class LookApplier {
  private latest: Look | null = null;
  private applied: Look | null = null;
  private saved: Look | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<void> = Promise.resolve();
  private busy = 0;
  private error: string | null = null;
  private status: LookStatus = { phase: "idle", applied: null, error: null };
  private readonly listeners = new Set<() => void>();
  private readonly quietMs: number;

  constructor(private readonly deps: Deps) {
    this.quietMs = deps.quietMs ?? LOOK_QUIET_MS;
  }

  /** The look in use is `look`, already shown and already saved (a bundle was opened). Forgets any edit still waiting. */
  reset(look: Look | null) {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.latest = this.applied = this.saved = look;
    this.error = null;
    this.publish();
  }

  /** An edit made `look`. It is applied after a pause, or at once if `finish` follows. */
  change(look: Look) {
    if (look === this.latest) return;
    this.latest = look;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.quietMs);
    this.publish();
  }

  /** The edit is finished (a release, Enter, a pick from a list): apply what is waiting now. */
  finish() {
    if (this.timer !== undefined) this.flush();
  }

  /** The page is going away: save what is waiting, without applying it. */
  saveNow() {
    clearTimeout(this.timer);
    this.timer = undefined;
    const look = this.latest;
    if (look && look !== this.saved) {
      this.saved = look;
      void this.deps.save(look, true).catch(() => {});
    }
    this.publish();
  }

  private flush() {
    clearTimeout(this.timer);
    this.timer = undefined;
    const look = this.latest;
    if (!look || look === this.applied) return this.publish();
    this.busy++;
    this.running = this.running.then(() => this.run(look)).finally(() => {
      this.busy--;
      this.publish();
    });
    this.publish();
  }

  private async run(look: Look) {
    try {
      if (look !== this.applied) {
        this.applied = look;
        this.publish();
        await this.deps.apply(look);
      }
      if (look !== this.saved) {
        this.saved = look;
        await this.deps.save(look, false);
      }
      this.error = null;
    } catch (e) {
      this.error = (e as Error).message;
      this.saved = null; // so the next change tries again
    }
  }

  get state(): LookStatus {
    return this.status;
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  private publish() {
    const phase: LookPhase = this.busy ? "updating" : this.timer !== undefined || this.latest !== this.applied ? "pending" : "idle";
    const s = this.status;
    if (s.phase === phase && s.applied === this.applied && s.error === this.error) return;
    this.status = { phase, applied: this.applied, error: this.error };
    this.listeners.forEach((l) => l());
  }
}
