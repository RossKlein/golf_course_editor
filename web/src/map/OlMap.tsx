import { useEffect, useRef, useState } from "react";
import Map from "ol/Map";
import View from "ol/View";
import { defaults as defaultInteractions } from "ol/interaction/defaults";
import DragPan from "ol/interaction/DragPan";
import MouseWheelZoom from "ol/interaction/MouseWheelZoom";
import type { Viewport } from "../api/api";
import { scaleBar, type Units } from "../units/units";
import { fromMap, projection } from "./coords";
import type { LayerState, Params, Scene } from "./scene";
import { applyViewport, fitRect, sameViewport, viewportOf } from "./view";

type Props = {
  scene: Scene | null;
  layerState: LayerState;
  params: Params;
  units: Units;
  /** Where to put the view when the scene changes; null fits the course. */
  initialViewport: Viewport | null;
  /** Called after the user pans or zooms (not for the initial placement). */
  onViewChange: (viewport: Viewport) => void;
  onHover: (point: { x: number; z: number } | null) => void;
  /** Gives the map to the shell and editors, which add their own layers and interactions. Null on unmount. */
  onMap: (map: Map | null) => void;
  /** A plain left-drag pans in viewing tools; drawing tools turn it off. Middle or right drag, or space+drag, always pan. */
  leftDragPans: boolean;
};

function ScaleBar({ map, units }: { map: Map | null; units: Units }) {
  const [res, setRes] = useState<number | null>(null);
  useEffect(() => {
    if (!map) return;
    const view = map.getView();
    const update = () => setRes(view.getResolution() ?? null);
    update();
    view.on("change:resolution", update);
    return () => view.un("change:resolution", update);
  }, [map]);
  if (!res) return null;
  const bar = scaleBar(units, 1 / res);
  return (
    <div className="scale-bar" style={{ width: bar.metres / res }}>
      <span>{bar.label}</span>
    </div>
  );
}

/** The OpenLayers map. It shows a scene's layers; editors attach to it through `onMap`. */
export default function OlMap({ scene, layerState, params, units, initialViewport, onViewChange, onHover, onMap, leftDragPans }: Props) {
  const target = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<Map | null>(null);
  const latest = useRef({ scene, layerState, params, initialViewport, onViewChange, onHover, leftDragPans });
  latest.current = { scene, layerState, params, initialViewport, onViewChange, onHover, leftDragPans };
  const spaceDown = useRef(false);
  const lastApplied = useRef<Viewport | null>(null);

  // create the map once
  useEffect(() => {
    const el = target.current!;
    const view = new View({ projection, center: [0, 0], resolution: 2, minResolution: 0.01, maxResolution: 60, constrainResolution: false });
    const m = new Map({
      target: el,
      view,
      controls: [],
      interactions: defaultInteractions({ dragPan: false, mouseWheelZoom: false, doubleClickZoom: false, keyboard: false, altShiftDragRotate: false, pinchRotate: false, shiftDragZoom: false }).extend([
        new DragPan({
          condition: (e) => {
            const b = (e.originalEvent as MouseEvent).button;
            return b === 1 || b === 2 || (b === 0 && (spaceDown.current || latest.current.leftDragPans));
          },
        }),
        new MouseWheelZoom({ constrainResolution: false, duration: 60 }),
      ]),
    });
    const vp = m.getViewport() as HTMLElement;
    const noMenu = (e: Event) => e.preventDefault();
    const noAutoscroll = (e: MouseEvent) => e.button === 1 && e.preventDefault();
    vp.addEventListener("contextmenu", noMenu);
    vp.addEventListener("mousedown", noAutoscroll);
    const move = (e: { coordinate: number[]; dragging: boolean }) => {
      const [x, z] = fromMap(e.coordinate as [number, number]);
      latest.current.onHover({ x, z });
    };
    m.on("pointermove", move);
    const leave = () => latest.current.onHover(null);
    vp.addEventListener("pointerleave", leave);
    m.on("moveend", () => {
      const v = viewportOf(m);
      if (v && !(lastApplied.current && sameViewport(v, lastApplied.current))) {
        lastApplied.current = v;
        latest.current.onViewChange(v);
      }
    });
    const key = (down: boolean) => (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      const t = e.target as HTMLElement;
      if (["INPUT", "SELECT", "TEXTAREA", "BUTTON"].includes(t.tagName)) return;
      spaceDown.current = down;
      m.set("spacePan", down); // lets a drawing tool know the primary button is panning
      vp.style.cursor = down ? "grab" : "";
      if (down) e.preventDefault();
    };
    const kd = key(true), ku = key(false);
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);
    const observer = new ResizeObserver(() => m.updateSize());
    observer.observe(el);
    setMap(m);
    onMap(m);
    return () => {
      observer.disconnect();
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
      vp.removeEventListener("contextmenu", noMenu);
      vp.removeEventListener("mousedown", noAutoscroll);
      vp.removeEventListener("pointerleave", leave);
      onMap(null);
      m.setTarget(undefined);
      setMap(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // show a scene's layers; place the view
  useEffect(() => {
    if (!map || !scene) return;
    const layers = map.getLayers();
    scene.layers.forEach((l, i) => {
      const s = latest.current.layerState[l.id];
      l.olLayer.setVisible(s ? s.visible : l.visible);
      l.olLayer.setOpacity(s ? s.opacity : l.opacity);
      l.olLayer.setZIndex(i);
      layers.push(l.olLayer);
    });
    map.updateSize();
    const saved = latest.current.initialViewport;
    if (saved) applyViewport(map, saved);
    else fitRect(map, scene.extent);
    lastApplied.current = viewportOf(map);
    return () => {
      scene.layers.forEach((l) => {
        layers.remove(l.olLayer);
        l.dispose?.();
      });
    };
  }, [map, scene]);

  // layer visibility and opacity
  useEffect(() => {
    if (!scene) return;
    for (const l of scene.layers) {
      const s = layerState[l.id];
      if (!s) continue;
      l.olLayer.setVisible(s.visible);
      l.olLayer.setOpacity(s.opacity);
    }
  }, [scene, layerState]);

  // exaggeration, selected hole
  useEffect(() => {
    scene?.layers.forEach((l) => l.onParams?.(params));
  }, [scene, params]);

  return (
    <div className="map-root">
      <div ref={target} className="map" />
      <ScaleBar map={map} units={units} />
    </div>
  );
}

export { fitRect };
