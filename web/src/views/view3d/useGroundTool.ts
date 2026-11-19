import { useEffect, useRef, type MutableRefObject, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import type { Pt } from "../../core/geometry/coords";
import type { GroundTool } from "../../scene/groundTool";
import type { TerrainSource } from "../../scene/scene";
import { matricesOf, type Camera } from "../../terrain/camera/camera";
import { ndcOf, pickGround, pickPlane, rayThrough } from "../../terrain/camera/pick";
import { paintCross, paintRing } from "./ring";

/** The colour of the places a tool marks besides its own ring. */
const MARK = "#ffd24a";

type Args = {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  /** A canvas laid over the picture that only this draws on, so moving the cursor costs no 3D frame. */
  cursorRef: RefObject<HTMLCanvasElement | null>;
  cameraRef: MutableRefObject<Camera>;
  /** The ground and the vertical exaggeration the picture is drawn with, read whenever they are needed. */
  read: () => { terrain: TerrainSource; scale: number };
  tool: GroundTool | undefined;
  space: RefObject<boolean>;
  /** A stroke began or ended, so the picture can draw less while it goes. */
  onStroke: (going: boolean) => void;
};

/** How far along a line of sight to look for the ground, in camera distances. */
const REACH = 8;

/**
 * Lets a tool work on the 3D ground: finds the point of ground under the pointer, tells the tool when the primary button
 * goes down and up, and draws its ring over the picture. The CPU's copy of the heights only catches up when a stroke
 * ends, so a stroke is held to the level of the ground where it began instead of chasing the surface it is raising.
 * `down` says whether it took the event; otherwise the camera has it.
 */
export function useGroundTool({ canvasRef, cursorRef, cameraRef, read, tool, space, onStroke }: Args) {
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const screen = useRef<[number, number] | null>(null); // the pointer, in CSS pixels from the picture's corner
  const level = useRef<number | null>(null); // the stroke's height, while one is going
  const going = useRef(false);

  const view = () => {
    const { terrain, scale } = read();
    const canvas = canvasRef.current!;
    const cam = cameraRef.current;
    const heightAt = (x: number, z: number) => {
      const h = terrain.ground(x, z);
      return h === null ? null : h * scale;
    };
    // the same camera the picture was drawn with
    const m = matricesOf(cam, canvas.clientWidth / canvas.clientHeight, (x, z) => heightAt(x, z) ?? 0);
    return { viewProj: m.viewProj, heightAt, cam, canvas, terrain, scale };
  };

  const groundAt = (): Pt | null => {
    const s = screen.current, canvas = canvasRef.current;
    if (!s || !canvas || !canvas.clientWidth || !canvas.clientHeight) return null;
    const v = view();
    const [nx, ny] = ndcOf(s[0], s[1], canvas.clientWidth, canvas.clientHeight);
    const ray = rayThrough(v.viewProj, nx, ny);
    if (!ray) return null;
    const reach = v.cam.distance * REACH;
    return level.current === null ? pickGround(ray, v.heightAt, reach) : pickPlane(ray, level.current, reach);
  };

  const paint = () => {
    const cursor = cursorRef.current, canvas = canvasRef.current;
    if (!cursor || !canvas) return;
    if (cursor.width !== canvas.width || cursor.height !== canvas.height) {
      cursor.width = canvas.width;
      cursor.height = canvas.height;
    }
    const ctx = cursor.getContext("2d")!;
    ctx.clearRect(0, 0, cursor.width, cursor.height);
    const t = toolRef.current;
    if (!t || !canvas.clientWidth) return;
    const at = groundAt();
    const v = view();
    const picture = { viewProj: v.viewProj, width: cursor.width, height: cursor.height };
    const scale = canvas.width / canvas.clientWidth;
    for (const m of t.marks?.(at) ?? []) {
      paintRing(ctx, picture, m.at, m.ring, v.heightAt, scale, MARK);
      paintCross(ctx, picture, m.at, v.heightAt, scale, MARK);
    }
    if (at) paintRing(ctx, picture, at, t.ring, v.heightAt, scale);
  };

  const finish = () => {
    if (!going.current) return;
    going.current = false;
    level.current = null;
    toolRef.current?.end();
    onStroke(false);
    paint(); // a mark that followed the pointer goes back to where it was picked
  };

  // a tool taken away mid-stroke ends the stroke
  useEffect(() => {
    if (!tool) finish();
  }, [tool]);
  useEffect(() => finish, []);

  const pointerAt = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    screen.current = [e.clientX - r.left, e.clientY - r.top];
  };

  return {
    paint,
    down: (e: ReactPointerEvent<HTMLCanvasElement>): boolean => {
      const t = toolRef.current;
      if (!t || e.button !== 0 || space.current) return false;
      pointerAt(e);
      level.current = null;
      const at = groundAt();
      if (at) {
        const v = view();
        level.current = (v.terrain.ground(at[0], at[1]) ?? 0) * v.scale;
        e.currentTarget.setPointerCapture(e.pointerId);
        going.current = true;
        onStroke(true);
        t.begin(groundAt, e.shiftKey, e.ctrlKey);
        paint(); // a source just picked shows at once, with the pointer standing still
      }
      return true;
    },
    move: (e: ReactPointerEvent<HTMLCanvasElement>) => {
      pointerAt(e);
      if (going.current) toolRef.current?.shift(e.shiftKey);
      paint();
    },
    up: finish,
    leave: () => {
      if (going.current) return;
      screen.current = null;
      paint();
    },
  };
}
