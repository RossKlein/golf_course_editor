import { useEffect, useRef, type MutableRefObject, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import type { Rect } from "../../core/geometry/coords";
import { cameraFor, nudge, orbit, pan, zoom, type Camera } from "../../terrain/camera/camera";

/** What the app can do to the 3D camera from outside (the keyboard). */
export type Controls3d = {
  zoom: (factor: number) => void;
  /** Move by half the view: x to the right, y forward. */
  nudge: (x: number, y: number) => void;
  fit: () => void;
};

type Args = {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  /** The camera. The app sets it when opening the view and reads it when closing. */
  cameraRef: MutableRefObject<Camera>;
  controlsRef: MutableRefObject<Controls3d | null>;
  /** The whole course, for fitting. */
  extentRef: RefObject<Rect>;
  /** Ask for a redraw. */
  request: () => void;
};

/**
 * Pointer, wheel and keyboard control of the camera: drag to orbit, shift- or right-drag to pan, wheel to zoom. Returns the
 * pointer handlers for the canvas; wheel and resize are attached to it here, and `controlsRef` offers zoom, nudge and fit.
 */
export function useCameraControls({ canvasRef, cameraRef, controlsRef, extentRef, request }: Args) {
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
    };
  }, [canvasRef, cameraRef, request]);

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
        const e = extentRef.current!;
        cameraRef.current = cameraFor(e.x + e.w / 2, e.z + e.h / 2, Math.max(e.h, e.w * 0.6), cameraRef.current);
        request();
      },
    };
    return () => {
      controlsRef.current = null;
    };
  }, [cameraRef, controlsRef, extentRef, request]);

  const drag = useRef<{ x: number; y: number; mode: "orbit" | "pan" } | null>(null);
  return {
    onPointerDown: (e: ReactPointerEvent<HTMLCanvasElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = { x: e.clientX, y: e.clientY, mode: e.button === 0 && !e.shiftKey && !e.ctrlKey ? "orbit" : "pan" };
    },
    onPointerMove: (e: ReactPointerEvent<HTMLCanvasElement>) => {
      const d = drag.current;
      if (!d) return;
      const dx = e.clientX - d.x, dy = e.clientY - d.y;
      d.x = e.clientX;
      d.y = e.clientY;
      cameraRef.current = d.mode === "orbit" ? orbit(cameraRef.current, dx, dy) : pan(cameraRef.current, dx, dy, e.currentTarget.clientHeight);
      request();
    },
    onPointerUp: () => {
      drag.current = null;
    },
    onPointerCancel: () => {
      drag.current = null;
    },
  };
}
