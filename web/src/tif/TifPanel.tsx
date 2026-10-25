import { useState } from "react";
import { api, type BakeResult, type TifView } from "../api/api";
import ReportView from "../report/ReportView";
import { useFormatter } from "../units/useUnits";

type Props = { view: TifView; onBaked: (bundle: string) => void };

/** "augusta/course_stack.tif" -> "augusta"; "uploads/Pebble Beach.tif" -> "pebble-beach" */
function slugFor(path: string): string {
  const parts = path.split("/");
  const file = parts[parts.length - 1].replace(/\.tiff?$/i, "");
  const base = file === "course_stack" && parts.length > 1 ? parts[parts.length - 2] : file;
  return base.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "course";
}

const titleFor = (slug: string) => slug.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

export default function TifPanel({ view, onBaked }: Props) {
  const fmt = useFormatter();
  const slug = slugFor(view.path);
  const [name, setName] = useState(titleFor(slug));
  const [out, setOut] = useState(`bundles/${slug}`);
  const [replace, setReplace] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<BakeResult | null>(null);

  const bake = async () => {
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const res = await api.bake({ stack: view.path, out, name, replace });
      setResult(res);
      onBaked(res.bundle);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const bands = view.descriptions.map((d, i) => d ?? `band ${i + 1}`).join(", ");
  return (
    <>
      <table className="info">
        <tbody>
          <tr><td>Size</td><td>{view.width} x {view.height} px</td></tr>
          <tr><td>Bands</td><td>{view.count} ({view.dtypes[0]}): {bands}</td></tr>
          <tr><td>CRS</td><td>{view.crs ?? "none"}</td></tr>
          <tr><td>Pixel</td><td>{(view.resX / view.decimation).toFixed(2)} x {(view.resZ / view.decimation).toFixed(2)} m</td></tr>
          {view.decimation > 1 && <tr><td>Shown at</td><td>1/{view.decimation} resolution</td></tr>}
          <tr><td>Layers</td><td>{[view.rgb && "imagery", view.elevation && "elevation"].filter(Boolean).join(", ")}</td></tr>
          {view.elevation && <tr><td>Elevation</td><td>{fmt.height(view.elevation.hMin)} to {fmt.height(view.elevation.hMax)}</td></tr>}
        </tbody>
      </table>

      <h2>Bake bundle</h2>
      {view.bakeable ? (
        <div className="form">
          <label>Course name <input type="text" value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label>Bundle folder <input type="text" value={out} onChange={(e) => setOut(e.target.value)} /></label>
          <label className="check">
            <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} /> Replace an existing bundle (keeps its editor state)
          </label>
          <button className="primary" type="button" disabled={busy || !name.trim() || !out.trim()} onClick={bake}>
            {busy ? "Baking…" : "Bake"}
          </button>
          {error && <p className="error">{error}</p>}
          {result && (
            <>
              <p>
                Baked <a href={`#bundle=${encodeURIComponent(result.bundle)}`}>{result.bundle}</a>
              </p>
              <ReportView report={result.report} />
            </>
          )}
        </div>
      ) : (
        <p className="muted">
          Baking needs a projected raster in metres with an elevation band, such as a course_stack.tif.
        </p>
      )}
    </>
  );
}
