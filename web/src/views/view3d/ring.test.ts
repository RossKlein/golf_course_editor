import { describe, expect, it } from "vitest";
import { matricesOf, type Camera } from "../../terrain/camera/camera";
import { paintRing, ringOnScreen } from "./ring";

const W = 1000, H = 625;
const cam: Camera = { x: 300, z: 200, yaw: 1.1, pitch: (85 * Math.PI) / 180, distance: 200 };
const flat = () => 0;
const view = (c: Camera = cam) => ({ viewProj: matricesOf(c, W / H, flat).viewProj, width: W, height: H });

describe("the brush ring", () => {
  it("is a closed loop of points about the centre", () => {
    const pts = ringOnScreen(view(), [cam.x, cam.z], 20, flat);
    expect(pts.length).toBeGreaterThan(32);
    expect(pts[0]).toEqual(pts[pts.length - 1]);
  });

  it("is round from straight above, and sits where the camera looks", () => {
    const pts = ringOnScreen(view(), [cam.x, cam.z], 20, flat).filter((p): p is [number, number] => !!p);
    const radii = pts.map(([x, y]) => Math.hypot(x - W / 2, y - H / 2));
    expect(Math.max(...radii) / Math.min(...radii)).toBeLessThan(1.05);
    const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length;
    expect(cx).toBeCloseTo(W / 2, -1);
  });

  it("is larger the larger the brush", () => {
    const radius = (r: number) => {
      const p = ringOnScreen(view(), [cam.x, cam.z], r, flat)[0]!;
      return Math.hypot(p[0] - W / 2, p[1] - H / 2);
    };
    expect(radius(40)).toBeGreaterThan(radius(20) * 1.9);
  });

  it("has no points behind the camera", () => {
    const low: Camera = { ...cam, pitch: (20 * Math.PI) / 180 };
    const eye = matricesOf(low, W / H, flat).eye;
    const behind: [number, number] = [eye[0] - Math.sin(low.yaw) * 400, eye[2] + Math.cos(low.yaw) * 400];
    expect(ringOnScreen(view(low), behind, 10, flat).every((p) => p === null)).toBe(true);
  });

  it("follows the ground it lies on", () => {
    const hill = (x: number) => (x > cam.x ? 40 : 0);
    const level = ringOnScreen(view(), [cam.x, cam.z], 20, flat);
    const raised = ringOnScreen(view(), [cam.x, cam.z], 20, (x) => hill(x));
    expect(raised).not.toEqual(level);
  });

  it("paints two rings, each in an outline and a line", () => {
    const calls: string[] = [];
    const ctx = new Proxy({} as Record<string, unknown>, {
      get: (_t, k: string) => (k === "stroke" ? () => calls.push("stroke") : () => {}),
      set: () => true,
    }) as unknown as CanvasRenderingContext2D;
    paintRing(ctx, view(), [cam.x, cam.z], { radius: 20, hardness: 0.5 }, flat);
    expect(calls).toEqual(["stroke", "stroke", "stroke", "stroke"]);
  });
});
