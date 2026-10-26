import { describe, expect, it, vi } from "vitest";
import type { Device } from "../device/device";
import { LazyTexture } from "./texture";

/** Just enough of a context to count what a texture does to it. */
function fakeDevice(generation: number) {
  const calls = { created: 0, bound: 0, deleted: 0 };
  const gl = {
    TEXTURE0: 0x84c0,
    TEXTURE_2D: 0xde1,
    activeTexture: () => {},
    createTexture: () => ({ id: ++calls.created }),
    bindTexture: () => void calls.bound++,
    deleteTexture: () => void calls.deleted++,
  };
  return { device: { gl, generation } as unknown as Device, calls };
}

describe("a lazy texture", () => {
  it("uploads the first time it is bound and not again", () => {
    const { device, calls } = fakeDevice(1);
    const upload = vi.fn();
    const t = new LazyTexture(upload);
    t.bind(device, 0);
    t.bind(device, 0);
    t.bind(device, 3);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(calls.created).toBe(1);
    expect(calls.bound).toBe(3);
  });

  it("uploads again when its source changed", () => {
    const { device } = fakeDevice(1);
    const upload = vi.fn();
    const t = new LazyTexture(upload);
    t.bind(device, 0);
    t.invalidate();
    t.bind(device, 0);
    expect(upload).toHaveBeenCalledTimes(2);
  });

  it("is made again when the context was replaced, as after a lost context", () => {
    const first = fakeDevice(1), second = fakeDevice(2);
    const upload = vi.fn();
    const t = new LazyTexture(upload);
    t.bind(first.device, 0);
    expect(t.current(first.device)).not.toBeNull();
    expect(t.current(second.device)).toBeNull(); // the old texture is not valid on the new context
    t.bind(second.device, 0);
    expect(second.calls.created).toBe(1);
    expect(upload).toHaveBeenCalledTimes(2);
  });
});
