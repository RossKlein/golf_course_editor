import { CLASS_COLORS, css, holeColor } from "../bundle/colours";
import type { Rect } from "../map/coords";
import type { Doc } from "../design/store";

type Ring = readonly (readonly [number, number])[];
type Ctx = Pick<
  CanvasRenderingContext2D,
  "setTransform" | "clearRect" | "beginPath" | "moveTo" | "lineTo" | "closePath" | "fill" | "stroke" | "save" | "restore"
> & { fillStyle: unknown; strokeStyle: unknown; lineWidth: number; lineJoin: unknown; globalCompositeOperation: unknown };

/** Pixels across the square canvases the design is painted into. */
export const DRAPE_PIXELS = 2048;

const inRect = (ring: Ring, r: Rect) => {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of ring) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return maxX >= r.x && minX <= r.x + r.w && maxZ >= r.z && minZ <= r.z + r.h;
};

function trace(ctx: Ctx, rings: Ring[]) {
  ctx.beginPath();
  for (const ring of rings) {
    ring.forEach(([x, z], i) => (i ? ctx.lineTo(x, z) : ctx.moveTo(x, z)));
    ctx.closePath();
  }
}

/**
 * Paint the design over a square of the course. `fill` gets the surfaces in the order the build lays them down, later
 * ones over earlier, so what shows is what the build will make. `lines` gets their outlines and the hole routes; where a
 * surface covers an earlier one, the earlier one's outline is hidden under it, as in the 2D editor.
 * Both are cleared first and painted in course metres scaled to the canvas, and are ready to upload as textures.
 */
export function paintDrape(fill: Ctx, lines: Ctx, doc: Doc, win: Rect, pixels: number) {
  const k = pixels / win.w;
  for (const ctx of [fill, lines]) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, pixels, pixels);
    ctx.setTransform(k, 0, 0, k, -win.x * k, -win.z * k);
    ctx.lineJoin = "round";
  }
  const hairline = (screenPx: number, minMetres: number) => Math.max(minMetres, screenPx / k);

  for (const id of doc.order) {
    const region = doc.regions[id];
    if (!region || !inRect(region.outer as Ring, win)) continue;
    const rings = [region.outer as Ring, ...(region.inner as Ring[])];

    fill.fillStyle = css(CLASS_COLORS[region.class] ?? [255, 0, 255]);
    trace(fill, rings);
    (fill.fill as (rule: CanvasFillRule) => void)("evenodd");

    lines.save();
    lines.globalCompositeOperation = "destination-out"; // this surface hides the outlines of whatever is under it
    trace(lines, rings);
    (lines.fill as (rule: CanvasFillRule) => void)("evenodd");
    lines.restore();
    lines.strokeStyle = "rgba(255, 255, 255, 0.95)";
    lines.lineWidth = hairline(1.5, 0.12);
    trace(lines, rings);
    lines.stroke();
  }

  for (const hole of doc.layout.holes) {
    const route = hole.route as Ring;
    if (route.length < 2 || !inRect(route, win)) continue;
    lines.strokeStyle = css(holeColor(hole.number));
    lines.lineWidth = hairline(2.5, 0.3);
    lines.beginPath();
    route.forEach(([x, z], i) => (i ? lines.lineTo(x, z) : lines.moveTo(x, z)));
    lines.stroke();
  }
}
