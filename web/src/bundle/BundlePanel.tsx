import type { BundleData } from "./bundleScene";

type Props = { data: BundleData; hole: number; onHole: (hole: number) => void };

export default function BundlePanel({ data, hole, onHole }: Props) {
  const { course } = data;
  return (
    <>
      <label>
        Bounds for hole
        <select value={hole} disabled={!course.holes.length} onChange={(e) => onHole(Number(e.target.value))}>
          {course.holes.length ? (
            course.holes.map((h) => (
              <option key={h.number} value={h.number}>Hole {h.number} (par {h.par})</option>
            ))
          ) : (
            <option value={1}>(no holes yet)</option>
          )}
        </select>
      </label>
      <p className="muted">{course.attribution}</p>
    </>
  );
}
