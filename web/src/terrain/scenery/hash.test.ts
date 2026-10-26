import { describe, expect, it } from "vitest";
import { hash2 } from "./hash";

describe("hash", () => {
  it("is deterministic and spread over [0, 1)", () => {
    expect(hash2(3, 4, 5)).toBe(hash2(3, 4, 5));
    expect(hash2(3, 4, 5)).not.toBe(hash2(4, 3, 5));
    let sum = 0;
    for (let i = 0; i < 2000; i++) {
      const v = hash2(i, i * 7, 1);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      sum += v;
    }
    expect(sum / 2000).toBeGreaterThan(0.45);
    expect(sum / 2000).toBeLessThan(0.55);
  });
});
