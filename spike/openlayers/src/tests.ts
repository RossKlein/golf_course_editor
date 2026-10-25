import Point from "ol/geom/Point";
import Feature from "ol/Feature";
import { closeRing, fromMap, pointInPoly, selfIntersects, subtract, toMap, type Pt } from "./geom";
import { H, W, type SpikeMap } from "./map";
import { addRegion, emptyDoc, removeRegion, store, updateRegion, type Doc } from "./store";
import { syntheticRegions, syntheticTrees } from "./synthetic";

export type Result = { name: string; pass: boolean; detail: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const m = (): SpikeMap => (window as unknown as { spike: { m: SpikeMap } }).spike.m;
const rect = (x0: number, z0: number, x1: number, z1: number): Pt[] => [[x0, z0], [x1, z0], [x1, z1], [x0, z1], [x0, z0]];
const round = (n: number, d = 2) => Number(n.toFixed(d));
// key order is not meaningful (undoing a delete re-adds the key last), so compare canonically
const canon = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, canon(x)])) : v;
const docs = () => JSON.stringify(canon(store.getState().doc));

// ---- synthetic pointer events, in design coordinates -------------------------------------------------------------

function focus(center: Pt, resolution: number) {
  m().view.setCenter(toMap(center));
  m().view.setResolution(resolution);
  m().map.renderSync();
}

function fire(type: string, at: Pt, o: { down?: boolean; alt?: boolean } = {}) {
  const vp = m().map.getViewport() as HTMLElement;
  const px = m().map.getPixelFromCoordinate(toMap(at))!;
  const r = vp.getBoundingClientRect();
  vp.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true, cancelable: true, composed: true, pointerId: 1, pointerType: "mouse", isPrimary: true,
      button: type === "pointermove" ? -1 : 0, buttons: o.down ? 1 : 0,
      clientX: r.left + px[0], clientY: r.top + px[1], altKey: !!o.alt,
    }),
  );
}

async function click(at: Pt, o: { alt?: boolean } = {}) {
  fire("pointermove", at, o);
  fire("pointerdown", at, { down: true, ...o });
  fire("pointerup", at, o);
  await sleep(40);
}

async function drag(from: Pt, to: Pt, steps = 8) {
  fire("pointermove", from);
  await sleep(20);
  fire("pointerdown", from, { down: true });
  for (let i = 1; i <= steps; i++) {
    fire("pointermove", [from[0] + ((to[0] - from[0]) * i) / steps, from[1] + ((to[1] - from[1]) * i) / steps], { down: true });
    await sleep(10);
  }
  fire("pointerup", to);
  await sleep(60);
}

const regionIds = () => store.getState().doc.order;
const region = (id: string) => store.getState().doc.regions[id];
const fresh = () => {
  store.getState().reset(emptyDoc());
  m().setMode("none");
};

// ---- tests -------------------------------------------------------------------------------------------------------

type Spike = { lastDraw?: { ok: boolean; rawCount?: number; id?: string; ring?: Pt[] } };
const spikeState = () => (window as unknown as { spike: Spike }).spike;

async function post(url: string, init?: RequestInit) {
  return (await fetch(url, init)).json();
}

/** Render only the class raster and find where its coverage starts along a scan line, in device pixels. */
async function edgeError(edge: { at: Pt; axis: "x" | "z"; inside: 1 | -1 }): Promise<number> {
  const { map, layers, view } = m();
  Object.values(layers).forEach((l) => l.setVisible(false));
  layers.classView.setVisible(true);
  focus(edge.at, 0.05);
  // renderSync is independent of animation-frame scheduling; the image loads asynchronously, so render until it shows
  let canvas: HTMLCanvasElement | null = null;
  let data: Uint8ClampedArray = new Uint8ClampedArray(0);
  for (let attempt = 0; attempt < 40; attempt++) {
    map.renderSync();
    canvas = (map.getViewport() as HTMLElement).querySelector("canvas");
    if (canvas && canvas.width > 0) {
      data = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
      if (data.some((v, i) => i % 4 === 3 && v > 0)) break;
    }
    await sleep(100);
  }
  if (!canvas) return -999;
  const ratio = canvas.width / (map.getSize()![0] as number);
  const [px, py] = map.getPixelFromCoordinate(toMap(edge.at))!.map((v) => v * ratio);
  const alpha = (x: number, y: number) => data[(Math.round(y) * canvas.width + Math.round(x)) * 4 + 3];
  // walk from outside toward inside until the raster starts
  let found = -1;
  for (let d = -80; d <= 80; d++) {
    const x = edge.axis === "x" ? px + d * edge.inside : px;
    const y = edge.axis === "z" ? py + d * edge.inside : py;
    if (alpha(x, y) > 0) {
      found = d;
      break;
    }
  }
  void view;
  return found; // 0 means the raster begins exactly at the analytic edge
}

export const tests: Record<string, () => Promise<Result[]>> = {
  async alignment() {
    fresh();
    const R = rect(700, 800, 760, 850);
    addRegion("A", { cls: 2, outer: R, inner: [] });
    addRegion("B", { cls: 1, outer: [[900, 900], [960, 900], [900, 960], [900, 900]], inner: [] });
    await fetch("/spike/regions", { method: "PUT", body: JSON.stringify(store.getState().doc) });
    const report = await post("/spike/rasterize", { method: "POST" });
    m().setClassView(`/out/class_test_view.png?t=${Date.now()}`);
    const results: Result[] = [];
    results.push({
      name: "server raster agrees with polygons (Shapely)",
      pass: report.mismatches === 0 && report.checked > 1000,
      detail: `${report.checked} points checked, ${report.mismatches} mismatches, ${report.skipped_near_edge} skipped near edges, ${report.ms} ms`,
    });
    // the raster edge is at x=700 exactly (cell boundary): where does OpenLayers draw it, versus where it says x=700 is?
    const edges: [string, { at: Pt; axis: "x" | "z"; inside: 1 | -1 }][] = [
      ["left edge x=700", { at: [700, 825], axis: "x", inside: 1 }],
      ["right edge x=760", { at: [760, 825], axis: "x", inside: -1 }],
      ["top edge z=800", { at: [730, 800], axis: "z", inside: 1 }],
      ["bottom edge z=850", { at: [730, 850], axis: "z", inside: -1 }],
    ];
    const errs: string[] = [];
    let worst = 0;
    for (const [label, e] of edges) {
      const found = await edgeError(e);
      errs.push(`${label}: ${found} px`);
      worst = Math.max(worst, found === -1 ? 999 : Math.abs(found));
    }
    Object.values(m().layers).forEach((l) => l.setVisible(true));
    m().layers.classView.setVisible(false);
    results.push({ name: "raster edges drawn where the projection says (1 class cell = 10 screen px)", pass: worst <= 1, detail: errs.join("; ") + ` (worst ${worst})` });
    return results;
  },

  async draw() {
    fresh();
    focus([500, 500], 0.5);
    m().setMode("draw");
    const pts: Pt[] = [[480, 480], [520, 480], [530, 510], [505, 530], [478, 510]];
    for (const p of pts) await click(p);
    await click(pts[0]); // clicking the first point finishes the polygon
    await sleep(80);
    const id = regionIds()[0];
    const r = id && region(id);
    return [{
      name: "click polygon creates one region",
      pass: !!r && r.outer.length === 6 && spikeState().lastDraw?.ok === true,
      detail: r ? `ring has ${r.outer.length} coords (5 clicked + closing), lastDraw ${JSON.stringify(spikeState().lastDraw)}` : `no region; ${JSON.stringify(spikeState().lastDraw)}`,
    }];
  },

  async freehand() {
    fresh();
    focus([500, 500], 0.5);
    m().setMode("freehand");
    const n = 160;
    const ring: Pt[] = Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2;
      const wobble = 1 + 0.03 * Math.sin(a * 17) + 0.01 * ((i * 7919) % 13) / 13; // hand jitter
      return [500 + 45 * wobble * Math.cos(a), 500 + 35 * wobble * Math.sin(a)];
    });
    fire("pointermove", ring[0]);
    await sleep(20);
    fire("pointerdown", ring[0], { down: true });
    for (let i = 1; i < ring.length; i++) {
      fire("pointermove", ring[i], { down: true });
      await sleep(4);
    }
    fire("pointerup", ring[ring.length - 1]);
    await sleep(120);
    const id = regionIds()[0];
    const r = id && region(id);
    const last = spikeState().lastDraw;
    return [{
      name: "freehand drag is simplified and smoothed into a clean polygon",
      pass: !!r && last?.ok === true && !selfIntersects(r.outer) && r.outer.length < (last.rawCount ?? 0),
      detail: r ? `${last?.rawCount} raw points -> ${r.outer.length} stored, self-intersecting: ${selfIntersects(r.outer)}` : `no region; ${JSON.stringify(last)}`,
    }];
  },

  async modify() {
    fresh();
    const id = addRegion("A", { cls: 1, outer: rect(600, 600, 660, 660), inner: [] });
    focus([630, 630], 0.5);
    m().setMode("modify");
    await sleep(100);
    const results: Result[] = [];
    const histBefore = store.getState().past.length;

    // 1. drag a vertex
    const v = region(id).outer[1]; // (660, 600)
    await drag(v, [v[0] + 6, v[1] + 4]);
    const moved = region(id).outer[1];
    results.push({
      name: "Modify drags a vertex and the store follows",
      pass: Math.abs(moved[0] - (v[0] + 6)) < 1 && Math.abs(moved[1] - (v[1] + 4)) < 1 && region(id).outer.length === 5,
      detail: `vertex ${JSON.stringify(v)} -> ${JSON.stringify(moved.map((n) => round(n)))}, ring length ${region(id).outer.length}, history +${store.getState().past.length - histBefore}`,
    });

    // 2. drag from the middle of an edge: inserts a vertex
    const before = region(id).outer.length;
    const mid: Pt = [(region(id).outer[2][0] + region(id).outer[3][0]) / 2, (region(id).outer[2][1] + region(id).outer[3][1]) / 2];
    await drag(mid, [mid[0], mid[1] + 8]);
    results.push({ name: "dragging an edge inserts a vertex", pass: region(id).outer.length === before + 1, detail: `ring length ${before} -> ${region(id).outer.length}` });

    // 3. alt+click deletes a vertex
    const n = region(id).outer.length;
    await click(region(id).outer[1], { alt: true });
    await sleep(450); // singleclick is delayed to rule out a double click
    results.push({ name: "alt+click deletes a vertex", pass: region(id).outer.length === n - 1, detail: `ring length ${n} -> ${region(id).outer.length}` });
    return results;
  },

  async holes() {
    fresh();
    const results: Result[] = [];
    const id = addRegion("Donut", { cls: 3, outer: rect(600, 600, 660, 660), inner: [rect(620, 620, 640, 640)] });
    focus([630, 630], 0.5);
    m().setMode("modify");
    await sleep(100);
    const hole = region(id).inner[0];
    const v = hole[1]; // (640, 620)
    await drag(v, [v[0] + 5, v[1] - 5]);
    const after = region(id);
    results.push({
      name: "Modify edits a vertex of a hole (inner ring) and keeps the ring structure",
      pass: after.inner.length === 1 && Math.abs(after.inner[0][1][0] - (v[0] + 5)) < 1 && after.outer.length === 5,
      detail: `hole vertex ${JSON.stringify(v)} -> ${JSON.stringify(after.inner[0][1].map((n) => round(n)))}, inner rings ${after.inner.length}, outer unchanged ${JSON.stringify(after.outer) === JSON.stringify(rect(600, 600, 660, 660))}`,
    });
    // making holes: Draw cannot, so subtract (polygon-clipping)
    const inside = subtract(rect(0, 0, 100, 100), rect(40, 40, 60, 60));
    const notch = subtract(rect(0, 0, 100, 100), rect(90, 40, 120, 60));
    const split = subtract(rect(0, 0, 100, 100), rect(-10, 40, 110, 60));
    results.push({
      name: "subtract() makes holes, notches and splits (erase tool)",
      pass: inside.length === 1 && inside[0].inner.length === 1 && notch.length === 1 && notch[0].inner.length === 0 && split.length === 2,
      detail: `inside -> ${inside.length} polygon with ${inside[0]?.inner.length} hole; edge cut -> ${notch.length} polygon, ${notch[0]?.inner.length} holes; through-cut -> ${split.length} polygons`,
    });
    const p = { outer: after.outer, inner: after.inner };
    results.push({ name: "point-in-polygon respects holes", pass: pointInPoly([610, 610], p) && !pointInPoly([630, 630], p), detail: "ring point inside, hole centre outside" });
    return results;
  },

  async snap() {
    fresh();
    addRegion("E", { cls: 1, outer: rect(600, 600, 640, 640), inner: [] });
    focus([620, 620], 0.5);
    m().setMode("draw");
    await sleep(100);
    const results: Result[] = [];
    // vertex snap: second click 6 screen px (3 m) from E's corner (640,600)
    const corner: Pt = [640, 600];
    await click([660, 580]);
    await click([corner[0] + 2, corner[1] - 2.2]);
    await click([665, 620]);
    await click([660, 580]);
    await sleep(80);
    const ids = regionIds();
    const a = ids[1] && region(ids[1]);
    const hit = a && a.outer.some((p) => Math.abs(p[0] - corner[0]) < 1e-6 && Math.abs(p[1] - corner[1]) < 1e-6);
    results.push({ name: "drawing snaps to an existing vertex exactly", pass: !!hit, detail: a ? `ring ${JSON.stringify(a.outer.map((p) => p.map((n) => round(n))))}` : "polygon not created" });
    // edge snap: click 2.5 m off the middle of E's top edge (z=600)
    fresh();
    addRegion("E", { cls: 1, outer: rect(600, 600, 640, 640), inner: [] });
    m().setMode("draw");
    await sleep(100);
    await click([590, 570]);
    await click([618.3, 597.5]);
    await click([650, 585]);
    await click([590, 570]);
    await sleep(80);
    const b = regionIds()[1] && region(regionIds()[1]);
    const onEdge = b && b.outer.some((p) => Math.abs(p[1] - 600) < 1e-6 && p[0] > 600 && p[0] < 640);
    results.push({ name: "drawing snaps onto an existing edge (not just vertices)", pass: !!onEdge, detail: b ? `ring z-values ${JSON.stringify(b.outer.map((p) => round(p[1], 3)))}` : "polygon not created" });
    return results;
  },

  async trace() {
    fresh();
    addRegion("E", { cls: 1, outer: rect(600, 600, 640, 640), inner: [] });
    focus([620, 620], 0.5);
    m().setMode("trace");
    await sleep(100);
    // start away, touch E's top-left corner, move along E's top and right edges, click its bottom-right, then
    // go round outside and close. The corner at (640,600) is never clicked.
    await click([580, 560]);
    await click([600, 600]);
    fire("pointermove", [620, 600]);
    await sleep(30);
    fire("pointermove", [640, 620]);
    await sleep(30);
    await click([640, 640]);
    await click([680, 640]);
    await click([680, 560]);
    await click([580, 560]);
    await sleep(100);
    const ids = regionIds();
    const t = ids[1] && region(ids[1]);
    const corner = t && t.outer.some((p) => Math.abs(p[0] - 640) < 1e-6 && Math.abs(p[1] - 600) < 1e-6);
    return [{
      name: "trace follows a neighbour's border (picks up the corner at 640,600 without a click there)",
      pass: !!corner,
      detail: t ? `ring ${JSON.stringify(t.outer.map((p) => p.map((n) => round(n))))}` : `no polygon created; ${JSON.stringify(spikeState().lastDraw)}`,
    }];
  },

  async undo() {
    fresh();
    const snaps: string[] = [docs()];
    const a = addRegion("add A", { cls: 1, outer: rect(0, 0, 10, 10), inner: [] });
    snaps.push(docs());
    const b = addRegion("add B", { cls: 2, outer: rect(20, 0, 30, 10), inner: [] });
    snaps.push(docs());
    store.getState().begin("move both");
    updateRegion("move A", a, { outer: rect(1, 1, 11, 11) });
    updateRegion("move B", b, { outer: rect(21, 1, 31, 11), cls: 3 });
    store.getState().end();
    snaps.push(docs());
    removeRegion("remove A", a);
    snaps.push(docs());
    const steps = store.getState().past.length;
    const results: Result[] = [{ name: "a grouped edit is one history entry", pass: steps === 4, detail: `${steps} entries for 5 commits (add, add, group of 2, remove)` }];
    const undone: boolean[] = [];
    for (let i = snaps.length - 2; i >= 0; i--) {
      store.getState().undo();
      undone.push(docs() === snaps[i]);
    }
    results.push({ name: "undo restores every earlier state exactly", pass: undone.every(Boolean), detail: `undo steps match: ${undone.join(", ")}` });
    const redone: boolean[] = [];
    for (let i = 1; i < snaps.length; i++) {
      store.getState().redo();
      redone.push(docs() === snaps[i]);
    }
    results.push({ name: "redo replays every state exactly", pass: redone.every(Boolean), detail: `redo steps match: ${redone.join(", ")}` });
    // new work after undo drops the redo branch
    store.getState().undo();
    addRegion("branch", { cls: 4, outer: rect(50, 50, 60, 60), inner: [] });
    results.push({ name: "a new edit after undo clears redo", pass: store.getState().future.length === 0, detail: `future length ${store.getState().future.length}` });
    // OpenLayers follows the store through undo (one-way mirror)
    fresh();
    focus([500, 500], 0.5);
    m().setMode("draw");
    for (const p of [[480, 480], [520, 480], [520, 520], [480, 480]] as Pt[]) await click(p);
    await sleep(80);
    const featuresAfterDraw = m().regionSource.getFeatures().length;
    store.getState().undo();
    const featuresAfterUndo = m().regionSource.getFeatures().length;
    store.getState().redo();
    const featuresAfterRedo = m().regionSource.getFeatures().length;
    results.push({
      name: "map features follow undo/redo of a drawn polygon",
      pass: featuresAfterDraw === 1 && featuresAfterUndo === 0 && featuresAfterRedo === 1,
      detail: `features after draw ${featuresAfterDraw}, undo ${featuresAfterUndo}, redo ${featuresAfterRedo}`,
    });
    return results;
  },

  async perf() {
    fresh();
    const { map, view, treeSource } = m();
    const t0 = performance.now();
    const doc: Doc = { order: [], regions: {} };
    for (const r of syntheticRegions(450, W, H)) {
      doc.order.push(r.id);
      doc.regions[r.id] = r;
    }
    store.getState().reset(doc);
    const tRegions = performance.now() - t0;
    const t1 = performance.now();
    treeSource.clear();
    treeSource.addFeatures(syntheticTrees(31250, W, H).map((p) => new Feature(new Point(toMap(p)))));
    map.renderSync();
    const tTrees = performance.now() - t1;
    const measure = (res: number, label: string) => {
      view.setResolution(res);
      const times: number[] = [];
      for (let i = 0; i < 40; i++) {
        view.setCenter([W / 2 + Math.sin(i / 4) * 100, -H / 2 + Math.cos(i / 4) * 100]);
        const t = performance.now();
        map.renderSync();
        times.push(performance.now() - t);
      }
      times.sort((a, b) => a - b);
      const avg = times.reduce((s, v) => s + v, 0) / times.length;
      return { label, avg: round(avg, 1), p95: round(times[Math.floor(times.length * 0.95)], 1) };
    };
    const out = [measure(2, "whole course (2 m/px)"), measure(0.5, "zoomed in (0.5 m/px)")];
    return [
      { name: "450 regions load into store and map", pass: m().regionSource.getFeatures().length === 450, detail: `${round(tRegions, 0)} ms; ${m().regionSource.getFeatures().length} features` },
      { name: "31,250 trees on a WebGL layer", pass: treeSource.getFeatures().length === 31250, detail: `${round(tTrees, 0)} ms to add and render once` },
      ...out.map((o) => ({ name: `render per frame, ${o.label}`, pass: o.avg < 16, detail: `average ${o.avg} ms, p95 ${o.p95} ms (60 fps needs under 16.7)` })),
    ];
  },

  async saveLoad() {
    fresh();
    const doc: Doc = { order: [], regions: {} };
    for (const r of syntheticRegions(450, W, H, 3)) {
      doc.order.push(r.id);
      doc.regions[r.id] = r;
    }
    store.getState().reset(doc);
    const t = performance.now();
    const put = await fetch("/spike/regions", { method: "PUT", body: JSON.stringify(store.getState().doc) });
    const saveMs = performance.now() - t;
    const report = await post("/spike/rasterize", { method: "POST" });
    const loaded = (await post("/spike/regions")) as Doc;
    store.getState().reset(loaded);
    const same = docs() === JSON.stringify(canon(doc));
    const bytes = JSON.stringify(doc).length;
    return [
      { name: "save and load round-trips the design exactly", pass: put.status === 204 && same, detail: `${bytes} bytes of JSON for 450 regions, saved in ${round(saveMs, 0)} ms, identical after load: ${same}` },
      { name: "server raster of 450 regions agrees with Shapely", pass: report.mismatches === 0 && report.checked > 3000, detail: `${report.checked} points checked, ${report.mismatches} mismatches; rasterize ${report.ms_rasterize} ms, encode two PNGs ${report.ms_encode_both_pngs} ms; class.png ${report.class_png_bytes} bytes` },
    ];
  },

  async panels() {
    const { left } = (window as unknown as { spike: { left: { current: { collapse(): void; expand(): void; isCollapsed(): boolean } } } }).spike;
    const panel = document.getElementById("left-panel")!.parentElement as HTMLElement;
    const widthOpen = panel.getBoundingClientRect().width;
    const el = document.getElementById("map")!;
    const mapOpen = el.getBoundingClientRect().width;
    left.current.collapse();
    await sleep(300);
    const collapsed = left.current.isCollapsed();
    const widthClosed = panel.getBoundingClientRect().width;
    // (the page's ResizeObserver calls updateSize; observers are only delivered on rendered frames, so call it here)
    m().map.updateSize();
    const mapClosed = el.getBoundingClientRect().width;
    const olClosed = m().map.getSize()![0];
    left.current.expand();
    await sleep(300);
    m().map.updateSize();
    const widthBack = panel.getBoundingClientRect().width;
    const mapBack = el.getBoundingClientRect().width;
    return [
      { name: "left panel collapses to nothing and the map grows to fill it", pass: collapsed && widthClosed < 2 && mapClosed > mapOpen + 200 && olClosed === Math.round(mapClosed), detail: `panel ${round(widthOpen, 0)} -> ${round(widthClosed, 0)} px, map element ${round(mapOpen, 0)} -> ${round(mapClosed, 0)} px, OpenLayers size ${olClosed}` },
      { name: "expand restores the previous size", pass: Math.abs(widthBack - widthOpen) < 2 && Math.abs(mapBack - mapOpen) < 2, detail: `panel back to ${round(widthBack, 0)} px (was ${round(widthOpen, 0)}), map ${mapBack}` },
    ];
  },
};

export async function runAll(only?: string[]): Promise<Result[]> {
  const all: Result[] = [];
  for (const [name, fn] of Object.entries(tests)) {
    if (only && !only.includes(name)) continue;
    try {
      all.push(...(await fn()));
    } catch (e) {
      all.push({ name: `${name} threw`, pass: false, detail: String((e as Error).stack ?? e).slice(0, 400) });
    }
  }
  m().setMode("none");
  return all;
}

export { closeRing, fromMap };
