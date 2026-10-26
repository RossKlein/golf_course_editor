import { useCallback, useEffect, useRef, useState, type MutableRefObject, type PointerEvent as ReactPointerEvent } from "react";
import { designStore } from "../model/design/store";
import type { Rect } from "../core/geometry/coords";
import type { TerrainSource } from "../map/scene";
import { cameraFor, drapeWindow, matricesOf, meshLevels, nudge, orbit, pan, zoom, type Camera } from "../terrain/camera/camera";
import { TUFT_RANGE } from "../terrain/passes/tufts/tufts";
import { DRAPE_PIXELS, paintDrape } from "./drape";

/** What the app can do to the 3D camera from outside (the keyboard). */
export type Controls3d = {
  zoom: (factor: number) => void;
  /** Move by half the view: x to the right, y forward. */
  nudge: (x: number, y: number) => void;
  fit: () => void;
};

type Props = {
  terrain: TerrainSource;
  /** The whole course, for fitting. */
  extent: Rect;
  active: boolean;
  /** The camera. The app sets it when opening the view and reads it when closing. */
  cameraRef: MutableRefObject<Camera>;
  controlsRef: MutableRefObject<Controls3d | null>;
  contour: number;
  slope: boolean;
  /** The relief exaggeration shared with the map's hillshade, and a way to change it. */
  relief: number;
  onRelief: (value: number) => void;
  /** Draw the bundle's design (surfaces, outlines, routes) over the ground. */
  hasDesign: boolean;
};

type Options = { aerial: boolean; game: boolean; tufts: boolean; grassRange: number; grassDensity: number; trees: boolean; surfaces: number; outlines: boolean; scale: number; shading: number };

/**
 * The terrain as a 3D landscape you can fly around: the same height data and the same sun as the map, draped with the
 * aerial and, live, with the design's surfaces and outlines. It is a view, not an editor; editing stays on the 2D map.
 */
export default function Terrain3D({ terrain, extent, active, cameraRef, controlsRef, contour, slope, relief, onRelief, hasDesign }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [opts, setOpts] = useState<Options>(() => ({ aerial: true, game: terrain.renderer.hasSurfaces, tufts: true, grassRange: TUFT_RANGE, grassDensity: 1, trees: true, surfaces: terrain.renderer.hasSurfaces ? 0 : 0.5, outlines: true, scale: 1, shading: 1 }));
  const [counts, setCounts] = useState({ tufts: 0, tuftsAll: 0, trees: 0 });
  const latest = useRef({ terrain, extent, active, opts, contour, slope, relief, hasDesign });
  latest.current = { terrain, extent, active, opts, contour, slope, relief, hasDesign };
  const frame = useRef(0);
  const drape = useRef<{ fill: HTMLCanvasElement; lines: HTMLCanvasElement; key: string } | null>(null);
  const designVersion = useRef(0);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const { terrain, active, opts, contour, slope, relief, hasDesign } = latest.current;
    if (!canvas || !active || !canvas.clientWidth || !canvas.clientHeight) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const cam = cameraRef.current;
    const ground = (x: number, z: number) => (terrain.ground(x, z) ?? 0) * opts.scale;
    const { viewProj, eye } = matricesOf(cam, w / h, ground);
    const meshes = meshLevels(cam);

    // the design is painted for a square of ground sized to the camera, so it stays sharp close up; repainted when that
    // square moves or the design changes
    const rect = drapeWindow(cam);
    if (hasDesign) {
      const key = `${rect.x},${rect.z},${rect.w},${designVersion.current}`;
      if (!drape.current) {
        const make = () => Object.assign(document.createElement("canvas"), { width: DRAPE_PIXELS, height: DRAPE_PIXELS });
        drape.current = { fill: make(), lines: make(), key: "" };
      }
      if (drape.current.key !== key) {
        drape.current.key = key;
        paintDrape(drape.current.fill.getContext("2d")!, drape.current.lines.getContext("2d")!, designStore.getState().doc, rect, DRAPE_PIXELS);
        terrain.renderer.setDrape(drape.current.fill, drape.current.lines, rect);
      }
    }
    try {
      const out = terrain.renderer.render3d([w, h], {
        viewProj, meshes, scale: opts.scale, relief, shading: opts.shading, aerial: opts.aerial, game: opts.game, tufts: opts.tufts, tuftRange: opts.grassRange, tuftDensity: opts.grassDensity, trees: opts.trees, eye, target: [cam.x, cam.z],
        fill: hasDesign ? opts.surfaces : 0, lines: hasDesign && opts.outlines ? 1 : 0, contour, slope,
      });
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(out, 0, 0);
      const s = terrain.renderer.sceneryStats;
      setCounts((c) => (c.tufts === s.tufts && c.tuftsAll === s.tuftsAll && c.trees === s.trees ? c : { tufts: s.tufts, tuftsAll: s.tuftsAll, trees: s.trees }));
    } catch (e) {
      console.error(e);
    }
  }, [cameraRef]);

  const request = useCallback(() => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      draw();
    });
  }, [draw]);

  // redraw when anything that shows changes
  useEffect(request, [request, active, opts, contour, slope, relief, hasDesign, terrain]);

  // the design changing repaints the drape
  useEffect(() => {
    if (!hasDesign) return;
    return designStore.subscribe(() => {
      designVersion.current += 1;
      if (latest.current.active) request();
    });
  }, [hasDesign, request]);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const observer = new ResizeObserver(request);
    observer.observe(canvas);
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      cameraRef.current = zoom(cameraRef.current, Math.exp(-e.deltaY * 0.0015));
      request();
    };
    canvas.addEventListener("wheel", wheel, { passive: false });
    return () => {
      observer.disconnect();
      canvas.removeEventListener("wheel", wheel);
      cancelAnimationFrame(frame.current);
      frame.current = 0;
    };
  }, [cameraRef, request]);

  useEffect(() => {
    controlsRef.current = {
      zoom: (f) => {
        cameraRef.current = zoom(cameraRef.current, f);
        request();
      },
      nudge: (x, y) => {
        cameraRef.current = nudge(cameraRef.current, x, y);
        request();
      },
      fit: () => {
        const e = latest.current.extent;
        cameraRef.current = cameraFor(e.x + e.w / 2, e.z + e.h / 2, Math.max(e.h, e.w * 0.6), cameraRef.current);
        request();
      },
    };
    return () => {
      controlsRef.current = null;
    };
  }, [cameraRef, controlsRef, request]);

  // free the GPU and the canvases when the scene goes
  useEffect(
    () => () => {
      terrain.renderer.setDrape(null, null, null);
      drape.current = null;
    },
    [terrain],
  );

  const drag = useRef<{ x: number; y: number; mode: "orbit" | "pan" } | null>(null);
  const down = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, mode: e.button === 0 && !e.shiftKey && !e.ctrlKey ? "orbit" : "pan" };
  };
  const move = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    d.x = e.clientX;
    d.y = e.clientY;
    cameraRef.current = d.mode === "orbit" ? orbit(cameraRef.current, dx, dy) : pan(cameraRef.current, dx, dy, e.currentTarget.clientHeight);
    request();
  };
  const up = () => (drag.current = null);

  const set = (p: Partial<Options>) => setOpts((o) => ({ ...o, ...p }));
  return (
    <div className="view3d" hidden={!active}>
      <canvas ref={canvasRef} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onContextMenu={(e) => e.preventDefault()} />
      <div className="v3-panel">
        {terrain.renderer.hasSurfaces && (
          <label className="check" title="Draw the ground as the game will: mown stripes on the fairways, short greens, grain from the game's grass texture">
            <input type="checkbox" checked={opts.game} onChange={(e) => set({ game: e.target.checked })} /> Game look
          </label>
        )}
        {terrain.aerial && !opts.game && (
          <label className="check"><input type="checkbox" checked={opts.aerial} onChange={(e) => set({ aerial: e.target.checked })} /> Aerial</label>
        )}
        {terrain.renderer.hasSurfaces && (
          <label className="check" title="Standing grass in the rough near the camera">
            <input type="checkbox" checked={opts.tufts} onChange={(e) => set({ tufts: e.target.checked })} /> Rough grass
          </label>
        )}
        {terrain.renderer.hasSurfaces && opts.tufts && (
          <>
            <label title="How far from where you are looking the grass grows. Further costs more.">
              Grass range {Math.round(opts.grassRange)} m
              <input type="range" min={10} max={300} step={10} value={opts.grassRange} onChange={(e) => set({ grassRange: Number(e.target.value) })} />
            </label>
            <label title="How many tufts to the square metre, as a multiple of the default. More costs more.">
              Grass density ×{opts.grassDensity}
              <input type="range" min={0.25} max={5} step={0.25} value={opts.grassDensity} onChange={(e) => set({ grassDensity: Number(e.target.value) })} />
            </label>
            <div className="hint" title="Grass instances sent to the GPU this frame: the tiles of the patch that are in view, out of the whole patch. Those not on rough or woods are dropped there.">
              {counts.tufts.toLocaleString()} instances of {counts.tuftsAll.toLocaleString()}
            </div>
          </>
        )}
        <label className="check" title={terrain.treeInfo?.preview ? "This bundle has no trees yet, so these are scattered over the woods surface to show how it will look" : "The bundle's trees"}>
          <input type="checkbox" checked={opts.trees} onChange={(e) => set({ trees: e.target.checked })} /> Trees{terrain.treeInfo?.preview ? " (preview)" : ""}
        </label>
        {hasDesign && (
          <>
            <label>
              Surfaces {Math.round(opts.surfaces * 100)}%
              <input type="range" min={0} max={1} step={0.05} value={opts.surfaces} onChange={(e) => set({ surfaces: Number(e.target.value) })} />
            </label>
            <label className="check"><input type="checkbox" checked={opts.outlines} onChange={(e) => set({ outlines: e.target.checked })} /> Outlines and routes</label>
          </>
        )}
        <label title="How strongly the relief is shaded. Hollows go darker and crests lighter, which is what shows gentle contours.">
          Shading {Math.round(opts.shading * 100)}%
          <input type="range" min={0} max={1.5} step={0.05} value={opts.shading} onChange={(e) => set({ shading: Number(e.target.value) })} />
        </label>
        <label title="Exaggerates the slopes for the shading only, as on the map. The ground itself keeps its shape.">
          Relief ×{relief}
          <input type="range" min={1} max={10} step={0.5} value={relief} onChange={(e) => onRelief(Number(e.target.value))} />
        </label>
        <label title="Stretches the ground itself upward.">
          Height ×{opts.scale}
          <input type="range" min={1} max={5} step={0.5} value={opts.scale} onChange={(e) => set({ scale: Number(e.target.value) })} />
        </label>
        <p className="muted">Drag to orbit, right-drag to pan, wheel to zoom. <kbd>3</kbd> returns to the 2D map.</p>
      </div>
    </div>
  );
}
