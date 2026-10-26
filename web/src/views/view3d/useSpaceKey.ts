import { useEffect, useRef } from "react";

/** Whether Space is held, as a ref that is always current. Space with the left button pans, as on the map. */
export function useSpaceKey() {
  const down = useRef(false);
  useEffect(() => {
    const key = (isDown: boolean) => (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      const t = e.target as HTMLElement;
      if (["INPUT", "SELECT", "TEXTAREA", "BUTTON"].includes(t.tagName)) return;
      down.current = isDown;
    };
    const kd = key(true), ku = key(false);
    const blur = () => (down.current = false);
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
      window.removeEventListener("blur", blur);
    };
  }, []);
  return down;
}
