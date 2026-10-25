import { api, fileUrl, tifRgbUrl, type Course, type Report } from "../api/api";
import { buildHillshade, decodeHeights, loadBytes, loadImage, loadPixels, memoLast, pixelCanvas, sampleGrid } from "../decode/decode";
import type { Layer, ReadoutLine, Scene } from "../map/scene";

// docs/golf-course-format.md: class map R = surface, G = owning hole; bounds = one in-bounds bit per hole.
export const CLASS_NAMES = ["rough", "fairway", "green", "collar", "tee", "bunker", "water", "path", "woods"];
const CLASS_COLORS: [number, number, number][] = [
  [106, 143, 58], [143, 209, 79], [31, 170, 89], [127, 199, 122], [224, 184, 74],
  [241, 227, 160], [59, 130, 196], [154, 154, 154], [47, 90, 42],
];
const UNKNOWN: [number, number, number] = [255, 0, 255];
const TREE_RECORD = 12;

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}
export const holeColor = (n: number) => hslToRgb((n * 47) % 360, 0.7, 0.55);
const css = ([r, g, b]: [number, number, number]) => `rgb(${r}, ${g}, ${b})`;

export type BundleData = { path: string; course: Course; report: Report };

/** A bundle on the map, read from its files the way the game will read them. */
export async function loadBundleScene(path: string): Promise<{ scene: Scene; data: BundleData }> {
  const course = await api.course(path);
  const [heightPx, classPx, boundsPx, treeBytes, report, aerial] = await Promise.all([
    loadPixels(fileUrl(path, course.height.file)),
    loadPixels(fileUrl(path, course.class.file)),
    loadPixels(fileUrl(path, course.bounds.file)),
    loadBytes(fileUrl(path, course.trees.file)),
    api.validate(path),
    api.aerial(path),
  ]);
  const { cols, rows } = course.height;
  const extent = { x: 0, z: 0, w: cols - 1, h: rows - 1 };
  const grid = decodeHeights(heightPx, course.hMin, course.hMax);
  const trees = new DataView(treeBytes);
  const classRect = { x: 0, z: 0, w: classPx.width * course.class.res, h: classPx.height * course.class.res };
  const boundsMask = (c: number, r: number) => {
    const i = (r * boundsPx.width + c) * 4;
    return boundsPx.data[i] | (boundsPx.data[i + 1] << 8) | (boundsPx.data[i + 2] << 16);
  };

  const layers: Layer[] = [];
  if (aerial) {
    layers.push({
      id: "aerial", label: "Aerial", visible: true, opacity: 1,
      raster: {
        image: await loadImage(tifRgbUrl(aerial.stack)), smooth: true,
        rect: { x: aerial.x0, z: aerial.z0, w: aerial.width * aerial.res, h: aerial.height * aerial.res },
      },
    });
  }
  const shade = memoLast((exaggeration: number) => buildHillshade(grid, course.height.res, course.height.res, exaggeration));
  layers.push({
    id: "hillshade", label: "Hillshade", visible: true, opacity: aerial ? 0.55 : 1,
    // samples sit on grid points, so each pixel is centred on its sample
    raster: { image: (p) => shade(p.exaggeration), rect: { x: -0.5, z: -0.5, w: cols, h: rows }, smooth: true, blend: "multiply" },
  });
  layers.push({
    id: "class", label: "Surface class", visible: false, opacity: 0.6,
    raster: {
      rect: classRect, smooth: false,
      image: pixelCanvas(classPx.width, classPx.height, (d) => {
        for (let i = 0; i < classPx.width * classPx.height; i++) d.set([...(CLASS_COLORS[classPx.data[i * 4]] ?? UNKNOWN), 255], i * 4);
      }),
    },
  });
  layers.push({
    id: "owner", label: "Hole ownership", visible: false, opacity: 0.8,
    raster: {
      rect: classRect, smooth: false,
      image: pixelCanvas(classPx.width, classPx.height, (d) => {
        for (let i = 0; i < classPx.width * classPx.height; i++) {
          const n = classPx.data[i * 4 + 1];
          if (n) d.set([...holeColor(n), 255], i * 4);
        }
      }),
    },
  });
  const outOfBounds = memoLast((hole: number) =>
    pixelCanvas(boundsPx.width, boundsPx.height, (d) => {
      for (let r = 0; r < boundsPx.height; r++)
        for (let c = 0; c < boundsPx.width; c++)
          if (!((boundsMask(c, r) >> (hole - 1)) & 1)) d.set([220, 40, 40, 255], (r * boundsPx.width + c) * 4);
    }),
  );
  layers.push({
    id: "bounds", label: "Out of bounds (selected hole)", visible: false, opacity: 0.55,
    raster: {
      rect: { x: 0, z: 0, w: boundsPx.width * course.bounds.res, h: boundsPx.height * course.bounds.res }, smooth: false,
      image: (p) => (course.holes.length ? outOfBounds(p.hole) : null),
    },
  });
  layers.push({
    id: "patches", label: `Patches (${course.patches.length})`, visible: true, opacity: 1,
    draw: (ctx, px) => {
      ctx.strokeStyle = "#ffd24a";
      ctx.lineWidth = 1.5 * px;
      for (const p of course.patches) ctx.strokeRect(p.x0, p.z0, p.cellsX, p.cellsZ);
    },
  });
  layers.push({
    id: "trees", label: `Trees (${course.trees.count})`, visible: true, opacity: 1,
    draw: (ctx, px) => {
      ctx.fillStyle = "#1e5e2a";
      const r = Math.max(1.2 * px, 0.6);
      for (let o = 0; o + TREE_RECORD <= trees.byteLength; o += TREE_RECORD)
        ctx.fillRect(trees.getFloat32(o, true) - r, trees.getFloat32(o + 4, true) - r, 2 * r, 2 * r);
    },
  });
  layers.push({
    id: "routes", label: `Hole routes (${course.holes.length})`, visible: true, opacity: 1,
    draw: (ctx, px) => {
      ctx.lineWidth = 2 * px;
      ctx.font = `${13 * px}px system-ui`;
      for (const h of course.holes) {
        ctx.strokeStyle = css(holeColor(h.number));
        ctx.beginPath();
        h.route.forEach(([x, z], i) => (i ? ctx.lineTo(x, z) : ctx.moveTo(x, z)));
        ctx.stroke();
        const [gx, gz] = h.route[h.route.length - 1];
        ctx.fillStyle = "#fff";
        ctx.fillText(String(h.number), gx + 4 * px, gz - 4 * px);
      }
    },
  });
  layers.push({
    id: "landmarks", label: `Landmarks (${course.landmarks.length})`, visible: true, opacity: 1,
    draw: (ctx, px) => {
      ctx.font = `${12 * px}px system-ui`;
      ctx.fillStyle = "#ff6ad5";
      for (const m of course.landmarks) {
        ctx.fillRect(m.x - 4 * px, m.z - 4 * px, 8 * px, 8 * px);
        ctx.fillText(m.name, m.x + 7 * px, m.z + 4 * px);
      }
    },
  });

  const readout = (x: number, z: number): ReadoutLine[] => {
    const lines: ReadoutLine[] = [{ text: `x ${x.toFixed(1)} m   z ${z.toFixed(1)} m` }];
    if (x < 0 || z < 0 || x > extent.w || z > extent.h) return [...lines, { text: "outside the course grid" }];
    const height = sampleGrid(grid, x / course.height.res, z / course.height.res);
    lines.push({ text: `height ${height?.toFixed(2) ?? "?"} m` });
    const c = Math.min(classPx.width - 1, Math.floor(x / course.class.res));
    const r = Math.min(classPx.height - 1, Math.floor(z / course.class.res));
    const klass = classPx.data[(r * classPx.width + c) * 4];
    const owner = classPx.data[(r * classPx.width + c) * 4 + 1];
    lines.push({ text: `${CLASS_NAMES[klass] ?? `class ${klass}?`}${owner ? `, hole ${owner}` : ""}`, color: css(CLASS_COLORS[klass] ?? UNKNOWN) });
    const mask = boundsMask(
      Math.min(boundsPx.width - 1, Math.floor(x / course.bounds.res)),
      Math.min(boundsPx.height - 1, Math.floor(z / course.bounds.res)),
    );
    const inBounds = course.holes.filter((h) => (mask >> (h.number - 1)) & 1).map((h) => h.number);
    lines.push({ text: `in bounds for: ${inBounds.length ? inBounds.join(", ") : "no hole"}` });
    const patch = course.patches.findIndex((p) => x >= p.x0 && x <= p.x0 + p.cellsX && z >= p.z0 && z <= p.z0 + p.cellsZ);
    lines.push({ text: patch >= 0 ? `0.25 m patch ${patch}` : "1 m macro grid" });
    return lines;
  };

  return {
    data: { path, course, report },
    scene: {
      key: `bundle:${path}`,
      title: course.name,
      subtitle: `${path} · ${extent.w} x ${extent.h} m, ${course.holes.length} holes`,
      extent, layers, readout,
    },
  };
}
