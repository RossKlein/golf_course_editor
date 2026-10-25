import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Group, Panel, Separator, usePanelRef } from "react-resizable-panels";
import { createMap, type Mode, type SpikeMap } from "./map";
import { store } from "./store";
import { runAll } from "./tests";

// Spike harness only: the automated pane resolves Image.decode() only while it is painting frames, and OpenLayers waits
// on it. Wait for the load event instead so image layers finish loading in a hidden pane.
HTMLImageElement.prototype.decode = function (this: HTMLImageElement) {
  return this.complete && this.naturalWidth > 0
    ? Promise.resolve()
    : new Promise<void>((resolve, reject) => {
        this.addEventListener("load", () => resolve(), { once: true });
        this.addEventListener("error", () => reject(new Error("image failed")), { once: true });
      });
};

declare global {
  interface Window {
    spike: { m?: SpikeMap; runAll: typeof runAll; ready: Promise<void>; [k: string]: unknown };
  }
}

function App() {
  const target = useRef<HTMLDivElement>(null);
  const left = usePanelRef();
  const [mode, setMode] = useState<Mode>("none");
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    window.spike = { runAll, left, store, ready: Promise.resolve() } as unknown as Window["spike"];
    const el = target.current!;
    // OpenLayers measures its container once; panels resize and collapse, so keep it in step
    const observer = new ResizeObserver(() => window.spike.m?.map.updateSize());
    observer.observe(el);
    window.spike.ready = createMap(el).then((m) => {
      if (cancelled) return;
      window.spike.m = m;
      m.map.updateSize();
    });
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [left]);

  const choose = (m: Mode) => {
    setMode(m);
    window.spike.m?.setMode(m);
  };

  return (
    <Group orientation="horizontal" style={{ height: "100%" }}>
      <Panel panelRef={left} collapsible collapsedSize={0} minSize={140} defaultSize={220} onResize={() => setCollapsed(left.current?.isCollapsed() ?? false)}>
        <div className="side" id="left-panel">
          <b>Files</b>
          <p>collapsed: {String(collapsed)}</p>
        </div>
      </Panel>
      <Separator style={{ width: 4, background: "#34402f" }} />
      <Panel>
        <div id="map" ref={target} />
      </Panel>
      <Separator style={{ width: 4, background: "#34402f" }} />
      <Panel minSize={160} defaultSize={260}>
        <div className="side">
          <button onClick={() => (left.current?.isCollapsed() ? left.current?.expand() : left.current?.collapse())}>toggle left</button>
          <div>
            {(["none", "draw", "freehand", "modify", "trace"] as Mode[]).map((m) => (
              <button key={m} style={{ fontWeight: mode === m ? 700 : 400 }} onClick={() => choose(m)}>{m}</button>
            ))}
          </div>
          <button onClick={() => store.getState().undo()}>undo</button>
          <button onClick={() => store.getState().redo()}>redo</button>
        </div>
      </Panel>
    </Group>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
