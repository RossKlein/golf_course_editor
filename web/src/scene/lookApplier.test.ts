import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Look } from "../core/api/api";
import { testLook } from "../terrain/look/look.fixture";
import { LOOK_QUIET_MS, LookApplier } from "./lookApplier";

const look = (n: number): Look => ({ ...testLook, sky: [n / 10, 0, 0] });

function make() {
  const applied: Look[] = [];
  const saved: { look: Look; keepalive: boolean }[] = [];
  const log: string[] = [];
  const gates: (() => void)[] = [];
  let slowApply = false;
  const applier = new LookApplier({
    apply: (l) => {
      log.push("apply");
      applied.push(l);
      if (!slowApply) return;
      return new Promise<void>((resolve) => gates.push(resolve));
    },
    save: async (l, keepalive) => {
      log.push("save");
      saved.push({ look: l, keepalive });
    },
  });
  return { applier, applied, saved, log, gates, slow: () => (slowApply = true) };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("what happens to a change of look", () => {
  it("applies and then saves once the hand has been still for the quiet period", async () => {
    const { applier, applied, saved, log } = make();
    applier.reset(look(0));
    applier.change(look(1));
    expect(applier.state.phase).toBe("pending");
    await vi.advanceTimersByTimeAsync(LOOK_QUIET_MS - 1);
    expect(applied).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(log).toEqual(["apply", "save"]);
    expect(applied[0]).toBe(saved[0].look);
    expect(applier.state.phase).toBe("idle");
    expect(applier.state.applied).toBe(applied[0]);
  });

  it("waits again for every change in a drag, then applies only the last", async () => {
    const { applier, applied, saved } = make();
    applier.reset(look(0));
    for (let i = 1; i <= 10; i++) {
      applier.change(look(i));
      await vi.advanceTimersByTimeAsync(LOOK_QUIET_MS - 50);
    }
    expect(applied).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(50);
    expect(applied).toEqual([look(10)]);
    expect(saved).toHaveLength(1);
  });

  it("applies at once on a finishing event, without waiting", async () => {
    const { applier, applied, saved } = make();
    applier.reset(look(0));
    applier.change(look(1));
    applier.change(look(2));
    applier.finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(applied).toEqual([look(2)]);
    expect(saved).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(LOOK_QUIET_MS * 2);
    expect(applied).toHaveLength(1); // the timer that was waiting is gone
  });

  it("does nothing on a finishing event when nothing is waiting", async () => {
    const { applier, applied } = make();
    applier.reset(look(0));
    applier.finish();
    await vi.advanceTimersByTimeAsync(LOOK_QUIET_MS);
    expect(applied).toHaveLength(0);
    expect(applier.state.phase).toBe("idle");
  });

  it("starts the wait again for a change during an apply, and never overlaps two jobs", async () => {
    const { applier, applied, saved, gates, slow, log } = make();
    slow();
    applier.reset(look(0));
    applier.change(look(1));
    await vi.advanceTimersByTimeAsync(LOOK_QUIET_MS);
    expect(applier.state.phase).toBe("updating");
    applier.change(look(2));
    await vi.advanceTimersByTimeAsync(LOOK_QUIET_MS * 3); // long enough for the second to be due, but the first apply is still baking
    expect(log).toEqual(["apply"]);
    gates[0](); // the first bake ends
    await vi.advanceTimersByTimeAsync(0);
    expect(log.slice(0, 3)).toEqual(["apply", "save", "apply"]); // saved, then the second one begins
    gates[1]();
    await vi.advanceTimersByTimeAsync(0);
    expect(applied).toEqual([look(1), look(2)]);
    expect(saved.map((s) => s.look)).toEqual([look(1), look(2)]);
    expect(applier.state.phase).toBe("idle");
  });

  it("treats undo and redo as changes like any other", async () => {
    const { applier, applied } = make();
    const a = look(1), b = look(2);
    applier.reset(a);
    applier.change(b);
    await vi.advanceTimersByTimeAsync(LOOK_QUIET_MS);
    applier.change(a); // an undo puts the earlier look back
    await vi.advanceTimersByTimeAsync(LOOK_QUIET_MS);
    expect(applied).toEqual([b, a]);
  });

  it("does not apply a change that put back the look already shown", async () => {
    const { applier, applied, saved } = make();
    const a = look(1);
    applier.reset(a);
    applier.change(look(2));
    applier.change(a);
    await vi.advanceTimersByTimeAsync(LOOK_QUIET_MS);
    expect(applied).toHaveLength(0);
    expect(saved).toHaveLength(0);
    expect(applier.state.phase).toBe("idle");
  });

  it("forgets a waiting change when another course is opened", async () => {
    const { applier, applied } = make();
    applier.reset(look(0));
    applier.change(look(1));
    applier.reset(look(5));
    await vi.advanceTimersByTimeAsync(LOOK_QUIET_MS * 2);
    expect(applied).toHaveLength(0);
    expect(applier.state.applied).toEqual(look(5));
  });

  it("saves what is waiting, unapplied, when the page is going away", async () => {
    const { applier, applied, saved } = make();
    applier.reset(look(0));
    applier.change(look(3));
    applier.saveNow();
    await vi.advanceTimersByTimeAsync(LOOK_QUIET_MS * 2);
    expect(applied).toHaveLength(0);
    expect(saved).toEqual([{ look: look(3), keepalive: true }]);
  });

  it("reports a failed save, keeps the look on screen, and tries again with the next change", async () => {
    let fail = true;
    const applied: Look[] = [];
    const applier = new LookApplier({
      apply: (l) => void applied.push(l),
      save: async () => {
        if (fail) throw new Error("grain must be at most 1");
      },
    });
    applier.reset(look(0));
    applier.change(look(1));
    await vi.advanceTimersByTimeAsync(LOOK_QUIET_MS);
    expect(applier.state.error).toBe("grain must be at most 1");
    expect(applied).toEqual([look(1)]);
    fail = false;
    applier.change(look(2));
    await vi.advanceTimersByTimeAsync(LOOK_QUIET_MS);
    expect(applier.state.error).toBeNull();
  });

  it("tells listeners when its state changes", async () => {
    const { applier } = make();
    const seen: string[] = [];
    applier.subscribe(() => seen.push(applier.state.phase));
    applier.reset(look(0));
    applier.change(look(1));
    await vi.advanceTimersByTimeAsync(LOOK_QUIET_MS);
    expect(seen).toContain("pending");
    expect(seen).toContain("updating");
    expect(seen[seen.length - 1]).toBe("idle");
  });
});
