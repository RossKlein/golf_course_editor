import { useCallback, useEffect, useRef } from "react";
import type { Viewport } from "../api/api";
import { viewFromViewport, viewportFromView } from "../editor/editorState";
import type { LayerState, Params, Scene } from "./scene";

type Props = {
  scene: Scene | null;
  layerState: LayerState;
  params: Params;
  /** Where to put the view when the scene changes; null fits the course. */
  initialViewport: Viewport | null;
  /** Called after the user pans, zooms or fits (not for the initial placement). */
  onViewChange: (viewport: Viewport) => void;
  onHover: (point: { x: number; z: number } | null) => void;
};

type View = { scale: number; ox: number; oz: number }; // screen = (world - origin) * scale, in CSS pixels

const SCALE_STEPS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];

/** Pan/zoom canvas that draws a scene's layers. Drag to pan, wheel to zoom, F to fit. */
export default function MapView({ scene, layerState, params, initialViewport, onViewChange, onHover }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const view = useRef<View>({ scale: 1, ox: 0, oz: 0 });
  const latest = useRef({ scene, layerState, params, initialViewport, onViewChange, onHover });
  latest.current = { scene, layerState, params, initialViewport, onViewChange, onHover };

  const emitView = useCallback(() => {
    const canvas = canvasRef.current;
    if (canvas) latest.current.onViewChange(viewportFromView(view.current, canvas.clientWidth, canvas.clientHeight));
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const dpr = window.devicePixelRatio || 1;
    const { scene, layerState, params } = latest.current;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!scene) return;
    const v = view.current;
    const s = v.scale * dpr;
    ctx.setTransform(s, 0, 0, s, -v.ox * s, -v.oz * s);
    let drawnBelow = false;
    for (const layer of scene.layers) {
      const state = layerState[layer.id];
      if (!state?.visible) continue;
      ctx.globalAlpha = state.opacity;
      if (layer.raster) {
        const r = layer.raster;
        const image = typeof r.image === "function" ? r.image(params) : r.image;
        if (!image) continue;
        ctx.imageSmoothingEnabled = r.smooth;
        ctx.globalCompositeOperation = r.blend === "multiply" && drawnBelow ? "multiply" : "source-over";
        ctx.drawImage(image, r.rect.x, r.rect.z, r.rect.w, r.rect.h);
        drawnBelow = true;
      }
      ctx.globalCompositeOperation = "source-over";
      layer.draw?.(ctx, 1 / s);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";

    // scale bar, in screen space
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const metres = SCALE_STEPS.find((m) => m * v.scale >= 80) ?? SCALE_STEPS[SCALE_STEPS.length - 1];
    const x = 16;
    const y = canvas.clientHeight - 20;
    const w = metres * v.scale;
    ctx.strokeStyle = ctx.fillStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y - 5);
    ctx.lineTo(x, y);
    ctx.lineTo(x + w, y);
    ctx.lineTo(x + w, y - 5);
    ctx.stroke();
    ctx.font = "12px system-ui";
    ctx.fillText(metres >= 1000 ? `${metres / 1000} km` : `${metres} m`, x, y - 9);
  }, []);

  const fit = useCallback(() => {
    const canvas = canvasRef.current;
    const scene = latest.current.scene;
    if (!canvas || !scene) return;
    const e = scene.extent;
    const scale = Math.min(canvas.clientWidth / e.w, canvas.clientHeight / e.h) * 0.95;
    view.current = {
      scale,
      ox: e.x + e.w / 2 - canvas.clientWidth / 2 / scale,
      oz: e.z + e.h / 2 - canvas.clientHeight / 2 / scale,
    };
    draw();
  }, [draw]);

  // place the view when a different scene is shown: restore the saved one, or fit
  useEffect(() => {
    const canvas = canvasRef.current;
    const saved = latest.current.initialViewport;
    if (canvas && saved) {
      view.current = viewFromViewport(saved, canvas.clientWidth, canvas.clientHeight);
      draw();
    } else {
      fit();
    }
  }, [scene, fit, draw]);
  useEffect(draw, [layerState, params, draw]);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(canvas.clientWidth * dpr);
      canvas.height = Math.round(canvas.clientHeight * dpr);
      draw();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    const toWorld = (e: { offsetX: number; offsetY: number }) => ({
      x: e.offsetX / view.current.scale + view.current.ox,
      z: e.offsetY / view.current.scale + view.current.oz,
    });
    let drag: { x: number; y: number; ox: number; oz: number; moved: boolean } | null = null;
    const down = (e: PointerEvent) => {
      drag = { x: e.clientX, y: e.clientY, ox: view.current.ox, oz: view.current.oz, moved: false };
      canvas.setPointerCapture(e.pointerId);
      canvas.classList.add("dragging");
    };
    const up = () => {
      if (drag?.moved) emitView();
      drag = null;
      canvas.classList.remove("dragging");
    };
    const move = (e: PointerEvent) => {
      if (drag) {
        drag.moved = true;
        view.current.ox = drag.ox - (e.clientX - drag.x) / view.current.scale;
        view.current.oz = drag.oz - (e.clientY - drag.y) / view.current.scale;
        draw();
      }
      if (latest.current.scene) latest.current.onHover(toWorld(e));
    };
    const leave = () => latest.current.onHover(null);
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const before = toWorld(e);
      const v = view.current;
      v.scale = Math.min(200, Math.max(0.01, v.scale * Math.pow(1.0015, -e.deltaY)));
      v.ox = before.x - e.offsetX / v.scale;
      v.oz = before.z - e.offsetY / v.scale;
      draw();
      emitView();
      if (latest.current.scene) latest.current.onHover(toWorld(e));
    };
    const key = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if ((e.key === "f" || e.key === "F") && !["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)) {
        fit();
        emitView();
      }
    };
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerleave", leave);
    canvas.addEventListener("wheel", wheel, { passive: false });
    window.addEventListener("keydown", key);
    return () => {
      observer.disconnect();
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerleave", leave);
      canvas.removeEventListener("wheel", wheel);
      window.removeEventListener("keydown", key);
    };
  }, [draw, fit, emitView]);

  return <canvas ref={canvasRef} className="map" />;
}
