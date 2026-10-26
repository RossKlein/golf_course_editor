import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import type { Rect } from "../../core/geometry/coords";
import type { TerrainSource } from "../../scene/scene";
import { drapeWindow, matricesOf, meshLevels, type Camera } from "../../terrain/camera/camera";
import { defaultOptions, type Options } from "./options";
import OptionsPanel, { type SceneryCounts } from "./OptionsPanel";
import { useCameraControls, type Controls3d } from "./useCameraControls";
import { useDrape } from "./useDrape";

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

/**
 * The terrain as a 3D landscape you can fly around: the same height data and the same sun as the map, draped with the
 * aerial and, live, with the design's surfaces and outlines. It is a view, not an editor; editing stays on the 2D map.
 */
export default function Terrain3D({ terrain, extent, active, cameraRef, controlsRef, contour, slope, relief, onRelief, hasDesign }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [opts, setOpts] = useState<Options>(() => defaultOptions(terrain.renderer.hasSurfaces));
  const [counts, setCounts] = useState<SceneryCounts>({ tufts: 0, tuftsAll: 0, trees: 0 });
  const latest = useRef({ terrain, active, opts, contour, slope, relief, hasDesign });
  latest.current = { terrain, active, opts, contour, slope, relief, hasDesign };
  const extentRef = useRef(extent);
  extentRef.current = extent;
  const frame = useRef(0);
  const paintDrape = useRef<(rect: Rect) => void>(() => {});

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
    paintDrape.current(drapeWindow(cam));
    try {
      const out = terrain.renderer.render3d([w, h], {
        viewProj, meshes: meshLevels(cam), scale: opts.scale, relief, shading: opts.shading, aerial: opts.aerial, game: opts.game, tufts: opts.tufts, tuftRange: opts.grassRange, tuftDensity: opts.grassDensity, trees: opts.trees, eye, target: [cam.x, cam.z],
        fill: hasDesign ? opts.surfaces : 0, lines: hasDesign && opts.outlines ? 1 : 0, contour, slope,
      });
      canvas.getContext("2d")!.drawImage(out, 0, 0);
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

  paintDrape.current = useDrape(terrain, hasDesign, useCallback(() => latest.current.active, []), request);
  const pointer = useCameraControls({ canvasRef, cameraRef, controlsRef, extentRef, request });

  // redraw when anything that shows changes
  useEffect(request, [request, active, opts, contour, slope, relief, hasDesign, terrain]);
  useEffect(
    () => () => {
      cancelAnimationFrame(frame.current);
      frame.current = 0;
    },
    [],
  );

  const set = (p: Partial<Options>) => setOpts((o) => ({ ...o, ...p }));
  return (
    <div className="view3d" hidden={!active}>
      <canvas ref={canvasRef} {...pointer} onContextMenu={(e) => e.preventDefault()} />
      <OptionsPanel terrain={terrain} opts={opts} set={set} counts={counts} relief={relief} onRelief={onRelief} hasDesign={hasDesign} />
    </div>
  );
}
