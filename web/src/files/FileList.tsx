import { useRef } from "react";
import type { Index } from "../core/api/api";
import { hashFor, type Selection } from "../selection/selection";
import { setUnits, useUnits } from "../ui/useUnits";
import type { Units } from "../core/units/units";

type Props = {
  index: Index | null;
  error: string;
  selection: Selection | null;
  onRescan: () => void;
  onUpload: (files: File[]) => void;
};

const mb = (bytes: number) => `${(bytes / 1e6).toFixed(1)} MB`;

function Entry({ kind, path, title, detail, active }: Selection & { title: string; detail: string; active: boolean }) {
  return (
    <li>
      <a href={hashFor({ kind, path })} className={active ? "active" : undefined}>
        {title}
        <small>{detail}</small>
      </a>
    </li>
  );
}

/** The indexed data folder: bundles and GeoTIFFs, plus rescan and upload. */
export default function FileList({ index, error, selection, onRescan, onUpload }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const units = useUnits();
  const is = (kind: Selection["kind"], path: string) => selection?.kind === kind && selection.path === path;
  return (
    <nav className="files">
      <header>
        <h1>Course Maker</h1>
        <div className="buttons">
          <button type="button" onClick={onRescan} title="Scan the data folder again">Rescan</button>
          <button type="button" onClick={() => input.current?.click()} title="Copy GeoTIFFs into uploads/">
            Load TIF…
          </button>
          <input
            ref={input}
            type="file"
            accept=".tif,.tiff"
            multiple
            hidden
            onChange={(e) => {
              onUpload(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />
        </div>
        <div className="units" role="group" aria-label="Display units">
          {(["us", "metric"] as Units[]).map((u) => (
            <button
              key={u}
              type="button"
              className={units === u ? "on" : undefined}
              aria-pressed={units === u}
              title={u === "us" ? "Yards for distances, feet for heights" : "Metres"}
              onClick={() => setUnits(u)}
            >
              {u === "us" ? "US (yd, ft)" : "Metric (m)"}
            </button>
          ))}
        </div>
        <p className="muted">{error || index?.root || "Indexing…"}</p>
      </header>
      <h2>Bundles</h2>
      <ul>
        {index?.bundles.map((b) => (
          <Entry key={b.path} kind="bundle" path={b.path} title={b.name} detail={b.path} active={is("bundle", b.path)} />
        ))}
        {index && !index.bundles.length && <li className="none">None yet. Bake one from a course_stack.tif.</li>}
      </ul>
      <h2>GeoTIFFs</h2>
      <ul>
        {index?.tifs.map((t) => {
          const slash = t.path.lastIndexOf("/");
          const folder = slash >= 0 ? t.path.slice(0, slash) : ".";
          return (
            <Entry
              key={t.path}
              kind="tif"
              path={t.path}
              title={t.path.slice(slash + 1)}
              detail={`${folder} · ${mb(t.size)}`}
              active={is("tif", t.path)}
            />
          );
        })}
        {index && !index.tifs.length && <li className="none">No .tif files in the data folder.</li>}
      </ul>
    </nav>
  );
}
