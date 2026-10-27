import type { TerrainSource } from "../../scene/scene";
import { SHADOW_QUALITIES } from "../../terrain/passes/shadow/shadow";
import type { Options } from "./options";

/** What the renderer sent last frame, for the cost line under the grass sliders. */
export type SceneryCounts = { tufts: number; tuftsAll: number; trees: number; shadowSlices: number; shadowTrees: number };

type Props = {
  terrain: TerrainSource;
  opts: Options;
  set: (patch: Partial<Options>) => void;
  counts: SceneryCounts;
  /** The relief exaggeration shared with the map's hillshade, and a way to change it. */
  relief: number;
  onRelief: (value: number) => void;
  /** Whether the bundle's design can be drawn over the ground. */
  hasDesign: boolean;
  /** A brush is out, so the left button sculpts. */
  sculpting: boolean;
  /** How the last frames went: draws a second and milliseconds a draw, or null before there are any. */
  timing: { perSecond: number; ms: number } | null;
};

/** The sliders and switches over the 3D view. */
export default function OptionsPanel({ terrain, opts, set, counts, relief, onRelief, hasDesign, sculpting, timing }: Props) {
  return (
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
      <label title="The sun's shadows. Off: flat light. Low and High: the ground, grass and its occlusion by trees and hills are baked once, so they look the same and cost almost nothing per frame. The setting changes how trees shade each other: one map (Low) or three with soft edges (High).">
        Shadows
        <select value={opts.shadows} onChange={(e) => set({ shadows: e.target.value as Options["shadows"] })}>
          {SHADOW_QUALITIES.map((q) => <option key={q} value={q}>{q === "off" ? "Off" : q === "low" ? "Low" : "High"}</option>)}
        </select>
      </label>
      {opts.shadows !== "off" && (
        <div className="hint" title="What the shadow maps cost this frame: how many maps were drawn, and how many trees were sent into them.">
          {counts.shadowSlices} {counts.shadowSlices === 1 ? "map" : "maps"}, {counts.shadowTrees.toLocaleString()} trees drawn
        </div>
      )}
      <label title="How strongly the slope shows in the sun's light: 0% is flat light, 100% is as lit. Only the sun's light is shaded by the slope; the sky's is not. Relief below makes the slope look steeper.">
        Shading {Math.round(opts.shading * 100)}%
        <input type="range" min={0} max={1.5} step={0.05} value={opts.shading} onChange={(e) => set({ shading: Number(e.target.value) })} />
      </label>
      <label title="Exaggerates the slopes for the shading only, as on the map, so gentle ground shows. 1 is the true slope. The ground itself keeps its shape; Height stretches it.">
        Relief ×{relief}
        <input type="range" min={1} max={10} step={0.5} value={relief} onChange={(e) => onRelief(Number(e.target.value))} />
      </label>
      <label title="Stretches the ground itself upward.">
        Height ×{opts.scale}
        <input type="range" min={1} max={5} step={0.5} value={opts.scale} onChange={(e) => set({ scale: Number(e.target.value) })} />
      </label>
      {sculpting && (
        <label className="check" title="While you hold the brush down, draw only the ground, so it keeps up with the brush. The grass, trees and shadows come back a moment after you let go.">
          <input type="checkbox" checked={opts.leanStrokes} onChange={(e) => set({ leanStrokes: e.target.checked })} /> Ground only while sculpting
        </label>
      )}
      {timing && (
        <div className="hint" title="How fast the last frames were drawn. Frames are only drawn when something changes, so this is the pace while you moved or sculpted.">
          {Math.round(timing.perSecond)} frames/s, {timing.ms.toFixed(1)} ms a frame
        </div>
      )}
      <p className="muted">
        {sculpting ? (
          <>Left-drag sculpts, right-drag orbits, middle-drag or <kbd>Space</kbd>-drag pans, wheel zooms. <kbd>3</kbd> returns to the 2D map.</>
        ) : (
          <>Drag to orbit, right-drag to pan, wheel to zoom. <kbd>3</kbd> returns to the 2D map.</>
        )}
      </p>
    </div>
  );
}
