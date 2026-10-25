// Course bundle viewer. Decodes the bundle the way the game's loader will (docs/golf-course-format.md in the
// Rally Club repo): PNGs with no color conversion, 16-bit heights in R/G, class in R and hole in G, bounds as bits.
// World coordinates are course metres: x east, z south; the map draws z downwards.

const CLASS_NAMES = ["rough", "fairway", "green", "collar", "tee", "bunker", "water", "path", "woods"];
const CLASS_COLORS = [
  [106, 143, 58], [143, 209, 79], [31, 170, 89], [127, 199, 122], [224, 184, 74],
  [241, 227, 160], [59, 130, 196], [154, 154, 154], [47, 90, 42],
];
const CLASS_RES = 0.5;

const $ = (id) => document.getElementById(id);
const canvas = $("map");
const ctx = canvas.getContext("2d");

function hslToRgb(h, s, l) {
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}
const holeColor = (n) => hslToRgb((n * 47) % 360, 0.7, 0.55);
const css = ([r, g, b]) => `rgb(${r}, ${g}, ${b})`;

async function loadPixels(url) {
  const blob = await (await fetch(url)).blob();
  const bitmap = await createImageBitmap(blob, { colorSpaceConversion: "none", premultiplyAlpha: "none" });
  const off = new OffscreenCanvas(bitmap.width, bitmap.height);
  const g = off.getContext("2d", { willReadFrequently: true });
  g.drawImage(bitmap, 0, 0);
  return g.getImageData(0, 0, bitmap.width, bitmap.height);
}

function pixelCanvas(width, height, fill) {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  const img = new ImageData(width, height);
  fill(img.data);
  c.getContext("2d").putImageData(img, 0, 0);
  return c;
}

// --- Bundle ---------------------------------------------------------------

const course = await (await fetch("/bundle/course.json")).json();
const heightPx = await loadPixels(`/bundle/${course.height.file}`);
const classPx = await loadPixels(`/bundle/${course.class.file}`);
const boundsPx = await loadPixels(`/bundle/${course.bounds.file}`);
const treeBuf = await (await fetch(`/bundle/${course.trees.file}`)).arrayBuffer();

const { cols, rows } = course.height;
const extent = { x: cols - 1, z: rows - 1 };
const heights = new Float32Array(cols * rows);
for (let i = 0; i < heights.length; i++) {
  const v = heightPx.data[i * 4] * 256 + heightPx.data[i * 4 + 1];
  heights[i] = course.hMin + (v / 65535) * (course.hMax - course.hMin);
}
const trees = new DataView(treeBuf);

function heightAt(x, z) {
  const fx = Math.min(Math.max(x, 0), cols - 1), fz = Math.min(Math.max(z, 0), rows - 1);
  const c0 = Math.min(Math.floor(fx), cols - 2), r0 = Math.min(Math.floor(fz), rows - 2);
  const tx = fx - c0, tz = fz - r0, h = (r, c) => heights[r * cols + c];
  return (h(r0, c0) * (1 - tx) + h(r0, c0 + 1) * tx) * (1 - tz) + (h(r0 + 1, c0) * (1 - tx) + h(r0 + 1, c0 + 1) * tx) * tz;
}

// --- Layers ---------------------------------------------------------------

const layers = [];
function addLayer(layer) {
  layers.push({ visible: false, opacity: 1, smooth: false, blend: "source-over", ...layer });
  return layers[layers.length - 1];
}
const layer = (id) => layers.find((l) => l.id === id);

const aerialMeta = await fetch("/aerial.json").then((r) => (r.ok ? r.json() : null)).catch(() => null);
if (aerialMeta) {
  const img = new Image();
  img.src = "/aerial.jpg";
  await img.decode().catch(() => {});
  addLayer({
    id: "aerial", label: "Aerial (NAIP)", visible: true, smooth: true, canvas: img,
    rect: { x: aerialMeta.x0, z: aerialMeta.z0, w: aerialMeta.width * aerialMeta.res, h: aerialMeta.height * aerialMeta.res },
  });
}

function buildHillshade(exaggeration) {
  const az = (315 * Math.PI) / 180, alt = (45 * Math.PI) / 180;
  return pixelCanvas(cols, rows, (d) => {
    const h = (r, c) => heights[Math.min(rows - 1, Math.max(0, r)) * cols + Math.min(cols - 1, Math.max(0, c))];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const dx = ((h(r, c + 1) - h(r, c - 1)) / (c === 0 || c === cols - 1 ? 1 : 2)) * exaggeration;
        const dz = ((h(r + 1, c) - h(r - 1, c)) / (r === 0 || r === rows - 1 ? 1 : 2)) * exaggeration;
        const slope = Math.PI / 2 - Math.atan(Math.hypot(dx, dz));
        const aspect = Math.atan2(-dx, dz);
        const hs = Math.max(0, Math.min(1, Math.sin(alt) * Math.sin(slope) + Math.cos(alt) * Math.cos(slope) * Math.cos(az - aspect)));
        const i = (r * cols + c) * 4;
        d[i] = d[i + 1] = d[i + 2] = Math.round(hs * 255);
        d[i + 3] = 255;
      }
    }
  });
}
const hillshade = addLayer({
  id: "hillshade", label: "Hillshade", visible: true, opacity: 0.55, smooth: true,
  canvas: buildHillshade(3), rect: { x: -0.5, z: -0.5, w: cols, h: rows },
});

addLayer({
  id: "class", label: "Surface class", opacity: 0.6,
  rect: { x: 0, z: 0, w: classPx.width * CLASS_RES, h: classPx.height * CLASS_RES },
  canvas: pixelCanvas(classPx.width, classPx.height, (d) => {
    for (let i = 0; i < classPx.width * classPx.height; i++) {
      const color = CLASS_COLORS[classPx.data[i * 4]] ?? [255, 0, 255];
      d.set([...color, 255], i * 4);
    }
  }),
});
addLayer({
  id: "owner", label: "Hole ownership", opacity: 0.8,
  rect: { x: 0, z: 0, w: classPx.width * CLASS_RES, h: classPx.height * CLASS_RES },
  canvas: pixelCanvas(classPx.width, classPx.height, (d) => {
    for (let i = 0; i < classPx.width * classPx.height; i++) {
      const n = classPx.data[i * 4 + 1];
      if (n) d.set([...holeColor(n), 255], i * 4);
    }
  }),
});
const boundsLayer = addLayer({
  id: "bounds", label: "Out of bounds (selected hole)", opacity: 0.55,
  rect: { x: 0, z: 0, w: boundsPx.width, h: boundsPx.height }, canvas: null,
});

function boundsMask(col, row) {
  const i = (row * boundsPx.width + col) * 4;
  return boundsPx.data[i] | (boundsPx.data[i + 1] << 8) | (boundsPx.data[i + 2] << 16);
}
function buildBounds(hole) {
  boundsLayer.canvas = pixelCanvas(boundsPx.width, boundsPx.height, (d) => {
    for (let r = 0; r < boundsPx.height; r++) {
      for (let c = 0; c < boundsPx.width; c++) {
        if (!((boundsMask(c, r) >> (hole - 1)) & 1)) d.set([220, 40, 40, 255], (r * boundsPx.width + c) * 4);
      }
    }
  });
}

const vectors = [
  { id: "patches", label: "Patches", on: true },
  { id: "trees", label: `Trees (${course.trees.count})`, on: true },
  { id: "routes", label: "Hole routes", on: true },
  { id: "landmarks", label: "Landmarks", on: true },
];

// --- Panel ----------------------------------------------------------------

$("title").textContent = course.name;
$("subtitle").textContent = `${extent.x} x ${extent.z} m, ${course.holes.length} holes. ${course.attribution}`;
const panelLayers = $("layers");
for (const l of layers) {
  const row = document.createElement("div");
  row.className = "layer";
  row.innerHTML = `<label><input type="checkbox" ${l.visible ? "checked" : ""}> ${l.label}</label><input type="range" min="0" max="1" step="0.05" value="${l.opacity}">`;
  const [box, slider] = row.querySelectorAll("input");
  box.onchange = () => { l.visible = box.checked; draw(); };
  slider.oninput = () => { l.opacity = Number(slider.value); draw(); };
  panelLayers.append(row);
}
for (const v of vectors) {
  const row = document.createElement("div");
  row.className = "vector";
  row.innerHTML = `<label><input type="checkbox" ${v.on ? "checked" : ""}> ${v.label}</label>`;
  row.querySelector("input").onchange = (e) => { v.on = e.target.checked; draw(); };
  panelLayers.append(row);
}
const holeSelect = $("boundsHole");
if (course.holes.length) {
  for (const h of course.holes) holeSelect.add(new Option(`Hole ${h.number}`, h.number));
  buildBounds(1);
} else {
  holeSelect.add(new Option("(no holes yet)", 0));
  holeSelect.disabled = true;
}
holeSelect.onchange = () => { buildBounds(Number(holeSelect.value)); draw(); };
let exagTimer;
$("exag").oninput = (e) => {
  clearTimeout(exagTimer);
  exagTimer = setTimeout(() => { hillshade.canvas = buildHillshade(Number(e.target.value)); draw(); }, 120);
};

// --- View -----------------------------------------------------------------

const view = { scale: 1, ox: 0, oz: 0 };
let dpr = 1;
function resize() {
  dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(canvas.clientWidth * dpr);
  canvas.height = Math.round(canvas.clientHeight * dpr);
  draw();
}
function fit() {
  view.scale = Math.min(canvas.clientWidth / extent.x, canvas.clientHeight / extent.z) * 0.95;
  view.ox = extent.x / 2 - canvas.clientWidth / 2 / view.scale;
  view.oz = extent.z / 2 - canvas.clientHeight / 2 / view.scale;
  draw();
}
const toWorld = (px, py) => ({ x: px / view.scale + view.ox, z: py / view.scale + view.oz });

function draw() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#161a16";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const s = view.scale * dpr;
  ctx.setTransform(s, 0, 0, s, -view.ox * s, -view.oz * s);
  const aerialOn = layer("aerial")?.visible;
  for (const l of layers) {
    if (!l.visible || !l.canvas) continue;
    ctx.globalAlpha = l.opacity;
    ctx.imageSmoothingEnabled = l.smooth;
    ctx.globalCompositeOperation = l.id === "hillshade" && aerialOn ? "multiply" : "source-over";
    ctx.drawImage(l.canvas, l.rect.x, l.rect.z, l.rect.w, l.rect.h);
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  const px = 1 / s; // one device pixel in world metres
  const on = (id) => vectors.find((v) => v.id === id).on;
  ctx.lineWidth = 1.5 * px;
  if (on("patches")) {
    ctx.strokeStyle = "#ffd24a";
    for (const p of course.patches ?? []) ctx.strokeRect(p.x0, p.z0, p.cellsX, p.cellsZ);
  }
  if (on("trees")) {
    ctx.fillStyle = "#1e5e2a";
    const r = Math.max(1.2 * px, 0.6);
    for (let o = 0; o + 12 <= trees.byteLength; o += 12) {
      ctx.fillRect(trees.getFloat32(o, true) - r, trees.getFloat32(o + 4, true) - r, 2 * r, 2 * r);
    }
  }
  if (on("routes")) {
    for (const h of course.holes) {
      ctx.strokeStyle = css(holeColor(h.number));
      ctx.beginPath();
      h.route.forEach(([x, z], i) => (i ? ctx.lineTo(x, z) : ctx.moveTo(x, z)));
      ctx.stroke();
      const [gx, gz] = h.route[h.route.length - 1];
      ctx.fillStyle = "#fff";
      ctx.font = `${13 * px}px system-ui`;
      ctx.fillText(String(h.number), gx + 4 * px, gz - 4 * px);
    }
  }
  if (on("landmarks")) {
    for (const m of course.landmarks ?? []) {
      ctx.fillStyle = "#ff6ad5";
      ctx.fillRect(m.x - 4 * px, m.z - 4 * px, 8 * px, 8 * px);
      ctx.font = `${12 * px}px system-ui`;
      ctx.fillText(m.name, m.x + 7 * px, m.z + 4 * px);
    }
  }
  drawScaleBar();
}
function drawScaleBar() {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const nice = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000].find((m) => m * view.scale >= 80) ?? 1000;
  const x = 16, y = canvas.clientHeight - 20, w = nice * view.scale;
  ctx.strokeStyle = ctx.fillStyle = "#fff";
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(x, y - 5); ctx.lineTo(x, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y - 5); ctx.stroke();
  ctx.font = "12px system-ui";
  ctx.fillText(`${nice} m`, x, y - 9);
}

// --- Interaction ----------------------------------------------------------

let drag = null;
canvas.onpointerdown = (e) => {
  drag = { x: e.clientX, y: e.clientY, ox: view.ox, oz: view.oz };
  canvas.setPointerCapture(e.pointerId);
  canvas.classList.add("dragging");
};
canvas.onpointerup = () => { drag = null; canvas.classList.remove("dragging"); };
canvas.onpointermove = (e) => {
  if (drag) {
    view.ox = drag.ox - (e.clientX - drag.x) / view.scale;
    view.oz = drag.oz - (e.clientY - drag.y) / view.scale;
    draw();
  }
  readout(e.offsetX, e.offsetY);
};
canvas.onwheel = (e) => {
  e.preventDefault();
  const before = toWorld(e.offsetX, e.offsetY);
  view.scale = Math.min(60, Math.max(0.05, view.scale * Math.pow(1.0015, -e.deltaY)));
  view.ox = before.x - e.offsetX / view.scale;
  view.oz = before.z - e.offsetY / view.scale;
  draw();
  readout(e.offsetX, e.offsetY);
};
window.onkeydown = (e) => { if (e.key === "f" || e.key === "F") fit(); };
window.onresize = resize;

function readout(px, py) {
  const { x, z } = toWorld(px, py);
  const out = [`x ${x.toFixed(1)} m   z ${z.toFixed(1)} m`];
  if (x < 0 || z < 0 || x > extent.x || z > extent.z) {
    out.push("outside the course grid");
  } else {
    out.push(`height ${heightAt(x, z).toFixed(2)} m`);
    const c = Math.min(classPx.width - 1, Math.floor(x / CLASS_RES)), r = Math.min(classPx.height - 1, Math.floor(z / CLASS_RES));
    const i = (r * classPx.width + c) * 4;
    const klass = classPx.data[i], owner = classPx.data[i + 1];
    out.push(`<span class="swatch" style="background:${css(CLASS_COLORS[klass] ?? [255, 0, 255])}"></span>${CLASS_NAMES[klass] ?? "?"}${owner ? `, hole ${owner}` : ""}`);
    const mask = boundsMask(Math.min(boundsPx.width - 1, Math.floor(x)), Math.min(boundsPx.height - 1, Math.floor(z)));
    const inBounds = course.holes.filter((h) => (mask >> (h.number - 1)) & 1).map((h) => h.number);
    out.push(`in bounds for: ${inBounds.length ? inBounds.join(", ") : "no hole"}`);
    const patch = (course.patches ?? []).findIndex((p) => x >= p.x0 && x <= p.x0 + p.cellsX && z >= p.z0 && z <= p.z0 + p.cellsZ);
    out.push(patch >= 0 ? `0.25 m patch ${patch}` : "1 m macro grid");
  }
  $("readout").innerHTML = out.join("\n");
}

resize();
fit();
