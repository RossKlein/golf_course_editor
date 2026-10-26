import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import type { Rect } from "../../core/geometry/coords";
import type { GroundTool } from "../../scene/groundTool";
import type { TerrainSource } from "../../scene/scene";
import { drapeWindow, matricesOf, meshLevels, type Camera } from "../../terrain/camera/camera";
import { defaultOptions, type Options } from "./options";
import OptionsPanel, { type SceneryCounts } from "./OptionsPanel";
import { useCameraControls, type Controls3d } from "./useCameraControls";
import { useDrape } from "./useDrape";
import { useGroundTool } from "./useGroundTool";
import { useSpaceKey } from "./useSpaceKey";

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
  /** A tool that works on the ground under the pointer, such as a sculpting brush. While there is one, the left button is its. */
  tool?: GroundTool;
};

/** How long after a stroke the grass, trees and shadows stay out, so a run of short strokes does not make them flicker. */
const LEAN_HOLD_MS = 300;
/** How often the frame timing line updates. */
const TIMING_EVERY_MS = 500;

/**
 * The terrain as a 3D landscape you can fly around: the same height data and the same sun as the map, draped with the
 * aerial and, live, with the design's surfaces and outlines. A tool can work on it (the sculpting brush): the view finds
 * the ground under the pointer for it and draws its ring, and while a stroke goes it draws only the ground.
 */
export default function Terrain3D({ terrain, extent, active, cameraRef, controlsRef, contour, slope, relief, onRelief, hasDesign, tool }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cursorRef = useRef<HTMLCanvasElement>(null);
  const [opts, setOpts] = useState<Options>(() => defaultOptions(terrain.renderer.hasSurfaces));
  const [counts, setCounts] = useState<SceneryCounts>({ tufts: 0, tuftsAll: 0, trees: 0, shadowSlices: 0, shadowTrees: 0 });
  const [timing, setTiming] = useState<{ perSecond: number; ms: number } | null>(null);
  const latest = useRef({ terrain, active, opts, contour, slope, relief, hasDesign });
  latest.current = { terrain, active, opts, contour, slope, relief, hasDesign };
  const extentRef = useRef(extent);
  extentRef.current = extent;
  const frame = useRef(0);
  const paintDrape = useRef<(rect: Rect) => void>(() => {});
  const paintCursor = useRef<() => void>(() => {});
  const lean = useRef(false); // a stroke is going, or just was
  const leanTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const clock = useRef({ frames: 0, ms: 0, since: 0 });

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const { terrain, active, opts, contour, slope, relief, hasDesign } = latest.current;
    if (!canvas || !active || !canvas.clientWidth || !canvas.clientHeight) return;
    const started = performance.now();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const cam = cameraRef.current;
    const ground = (x: number, z: number) => (terrain.ground(x, z) ?? 0) * opts.scale;
    const { viewProj, eye } = matricesOf(cam, w / h, ground);
    paintDrape.current(drapeWindow(cam));
    const bare = lean.current && opts.leanStrokes; // just the ground, while sculpting
    try {
      const out = terrain.renderer.render3d([w, h], {
        viewProj, meshes: meshLevels(cam), scale: opts.scale, relief, shading: opts.shading, aerial: opts.aerial, game: opts.game, tufts: opts.tufts && !bare, tuftRange: opts.grassRange, tuftDensity: opts.grassDensity, trees: opts.trees && !bare, shadows: bare ? "off" : opts.shadows, eye, target: [cam.x, cam.z],
        fill: hasDesign ? opts.surfaces : 0, lines: hasDesign && opts.outlines ? 1 : 0, contour, slope,
      });
      canvas.getContext("2d")!.drawImage(out, 0, 0);
      const s = terrain.renderer.sceneryStats;
      setCounts((c) => (c.tufts === s.tufts && c.tuftsAll === s.tuftsAll && c.trees === s.trees && c.shadowSlices === s.shadowSlices && c.shadowTrees === s.shadowTrees ? c : { tufts: s.tufts, tuftsAll: s.tuftsAll, trees: s.trees, shadowSlices: s.shadowSlices, shadowTrees: s.shadowTrees }));
    } catch (e) {
      console.error(e);
    }
    paintCursor.current();

    const now = performance.now(), c = clock.current;
    if (!c.since) c.since = started;
    c.frames++;
    c.ms += now - started;
    if (now - c.since >= TIMING_EVERY_MS) {
      setTiming({ perSecond: (c.frames * 1000) / (now - c.since), ms: c.ms / c.frames });
      clock.current = { frames: 0, ms: 0, since: now };
    }
  }, [cameraRef]);

  const request = useCallback(() => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      draw();
    });
  }, [draw]);

  const onStroke = useCallback(
    (going: boolean) => {
      clearTimeout(leanTimer.current);
      if (going) {
        lean.current = true;
        request();
        return;
      }
      leanTimer.current = setTimeout(() => {
        lean.current = false;
        request();
      }, LEAN_HOLD_MS);
    },
    [request],
  );

  paintDrape.current = useDrape(terrain, hasDesign, useCallback(() => latest.current.active, []), request);
  const space = useSpaceKey();
  const camera = useCameraControls({ canvasRef, cameraRef, controlsRef, extentRef, request, tool: !!tool, space });
  const ground = useGroundTool({ canvasRef, cursorRef, cameraRef, read: () => ({ terrain: latest.current.terrain, scale: latest.current.opts.scale }), tool, space, onStroke });
  paintCursor.current = ground.paint;

  // redraw when anything that shows changes, including the heights (a brush stamp, an undo)
  useEffect(request, [request, active, opts, contour, slope, relief, hasDesign, terrain]);
  useEffect(() => terrain.watch(request), [terrain, request]);
  useEffect(() => ground.paint(), [tool, active]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(
    () => () => {
      cancelAnimationFrame(frame.current);
      frame.current = 0;
      clearTimeout(leanTimer.current);
    },
    [],
  );

  const set = (p: Partial<Options>) => setOpts((o) => ({ ...o, ...p }));
  return (
    <div className="view3d" hidden={!active}>
      <canvas
        ref={canvasRef}
        className={tool ? "sculpt" : undefined}
        onPointerDown={(e) => {
          if (!ground.down(e)) camera.onPointerDown(e);
        }}
        onPointerMove={(e) => {
          ground.move(e);
          camera.onPointerMove(e);
        }}
        onPointerUp={() => {
          ground.up();
          camera.onPointerUp();
        }}
        onPointerCancel={() => {
          ground.up();
          camera.onPointerCancel();
        }}
        onPointerLeave={ground.leave}
        onMouseDown={(e) => e.button === 1 && e.preventDefault()}
        onContextMenu={(e) => e.preventDefault()}
      />
      <canvas ref={cursorRef} className="v3-cursor" />
      <OptionsPanel terrain={terrain} opts={opts} set={set} counts={counts} relief={relief} onRelief={onRelief} hasDesign={hasDesign} sculpting={!!tool} timing={timing} />
    </div>
  );
}
