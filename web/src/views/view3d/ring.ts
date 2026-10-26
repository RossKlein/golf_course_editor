import { transform, type Mat4 } from "../../gfx/math/mat4";
import type { Pt } from "../../core/geometry/coords";
import type { Heights } from "../../terrain/camera/pick";

/** Metres a ring floats above the ground so it is not lost in it. */
const LIFT = 0.15;
const SEGMENTS = 96;

export type RingView = { viewProj: Mat4; /** The picture's size in pixels. */ width: number; height: number };

/** A pixel of the picture, or null where the point is behind the camera. */
type Pixel = [number, number] | null;

const toPixel = (v: RingView, x: number, y: number, z: number): Pixel => {
  const [cx, cy, , w] = transform(v.viewProj, [x, y, z]);
  if (!(w > 0)) return null;
  return [(cx / w * 0.5 + 0.5) * v.width, (1 - (cy / w * 0.5 + 0.5)) * v.height];
};

/** Where a circle of `radius` metres on the ground around `centre` falls in the picture, point by point. */
export function ringOnScreen(v: RingView, centre: Pt, radius: number, height: Heights): Pixel[] {
  const fallback = height(centre[0], centre[1]) ?? 0;
  const out: Pixel[] = [];
  for (let i = 0; i <= SEGMENTS; i++) {
    const a = (i / SEGMENTS) * Math.PI * 2;
    const x = centre[0] + Math.cos(a) * radius, z = centre[1] + Math.sin(a) * radius;
    out.push(toPixel(v, x, (height(x, z) ?? fallback) + LIFT, z));
  }
  return out;
}

function trace(ctx: CanvasRenderingContext2D, points: Pixel[]) {
  ctx.beginPath();
  let drawing = false;
  for (const p of points) {
    if (!p) {
      drawing = false;
      continue;
    }
    if (drawing) ctx.lineTo(p[0], p[1]);
    else ctx.moveTo(p[0], p[1]);
    drawing = true;
  }
}

const stroke = (ctx: CanvasRenderingContext2D, points: Pixel[], color: string, width: number, dash: number[]) => {
  trace(ctx, points);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.setLineDash(dash);
  ctx.stroke();
};

/**
 * Draw a brush's cursor on the ground: a ring at its edge and a dashed one where its core ends, each white over a dark
 * outline so it shows on any ground. `scale` is device pixels to a CSS pixel, so lines are the same width on any screen.
 */
export function paintRing(ctx: CanvasRenderingContext2D, v: RingView, centre: Pt, ring: { radius: number; hardness: number }, height: Heights, scale = 1) {
  const edge = ringOnScreen(v, centre, ring.radius, height);
  const core = ringOnScreen(v, centre, Math.max(0.01, ring.radius * ring.hardness), height);
  const dash = [4 * scale, 4 * scale];
  stroke(ctx, core, "rgba(0, 0, 0, 0.45)", 3 * scale, dash);
  stroke(ctx, core, "rgba(255, 255, 255, 0.9)", scale, dash);
  stroke(ctx, edge, "rgba(0, 0, 0, 0.6)", 4 * scale, []);
  stroke(ctx, edge, "#ffffff", 1.5 * scale, []);
}
