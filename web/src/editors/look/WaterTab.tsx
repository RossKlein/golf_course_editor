import { useState, useSyncExternalStore } from "react";
import type { TerrainSource } from "../../scene/scene";
import Section from "../../ui/Section";
import SliderField from "../../ui/SliderField";
import { FieldList, type Editing } from "./FieldView";
import type { Field } from "./lookSchema";
const fields: Field[] = [
  { kind: "color", prop: "bedColor", label: "Lake bed" },
  { kind: "color", prop: "tint", label: "Water tint (deep)" },
  { kind: "color", prop: "shallow", label: "Shallow water" },
  {
    kind: "slider",
    prop: "clarity",
    label: "Clarity (m)",
    min: 0.1,
    max: 10,
    step: 0.05,
  },
  {
    kind: "slider",
    prop: "ripples",
    label: "Ripples",
    min: 0,
    max: 0.05,
    step: 0.001,
  },
];
export default function WaterTab({
  editing,
  terrain,
}: {
  editing: Editing;
  terrain: TerrainSource;
}) {
  const mesh = useSyncExternalStore(
    terrain.watch,
    () => terrain.renderer.waterData,
  );
  const [selected, setSelected] = useState("");
  const lake = mesh?.lakes.find((l) => l.id === selected) ?? mesh?.lakes[0];
  const settings = lake ? editing.look?.water.lakes[lake.id] : undefined;
  const change = (prop: string, value: unknown, finish = true) => {
    if (!lake) return;
    editing.set("Lake " + prop, ["water", "lakes", lake.id], {
      anchor: lake.anchor,
      level: null,
      offset: 0,
      curvature: 0,
      excess: 0,
      ...settings,
      [prop]: value,
    });
    if (finish) editing.finish();
  };
  return (
    <>
      <Section title="Water appearance">
        <FieldList
          fields={fields}
          base={["water"]}
          noun="Water"
          editing={editing}
        />
      </Section>
      <Section title="Lake surface">
        <p className="muted">
          Flat by default. Raise or lower the surface to meet the banks;
          shoreline following adds gentle curvature. The shore is cut where the
          ground meets the water, limited to the painted outline plus the
          water beyond it. Changes are saved with the course and exported as a
          water mesh.
        </p>
        <label>
          Lake{" "}
          <select
            value={lake?.id ?? ""}
            onChange={(e) => setSelected(e.target.value)}
          >
            {mesh?.lakes.map((l, i) => (
              <option key={l.id} value={l.id}>
                Lake {i + 1} ({l.anchor.map((v) => v.toFixed(0)).join(", ")} m)
              </option>
            ))}
          </select>
        </label>
        {!lake ? (
          <p>No water regions in this course.</p>
        ) : (
          <>
            <p className="muted">
              Estimated elevation: {lake.estimatedLevel.toFixed(2)} m. Surface:{" "}
              {lake.level.toFixed(2)} m.
            </p>
            <label>
              Fixed elevation (m; blank uses estimate)
              <input
                key={lake.id + ":" + (settings?.level ?? "auto")}
                type="number"
                step="0.05"
                defaultValue={settings?.level ?? ""}
                onBlur={(e) => {
                  const value = e.currentTarget.value;
                  if (!value) change("level", null);
                  else if (Number.isFinite(Number(value)))
                    change("level", Number(value));
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
              />
            </label>
            <SliderField
              label="Height offset (m)"
              value={settings?.offset ?? 0}
              min={-10}
              max={10}
              step={0.05}
              onStart={() => editing.start("Lake height")}
              onFinish={editing.finish}
              onChange={(v) => change("offset", v, false)}
            />
            <SliderField
              label="Water beyond the outline (m)"
              title="How far past the painted outline the water may spread, where the ground is lower than the water. The shore is where the ground meets the water, cut into the mesh with many vertices along it: it stays at the ground where the ground is higher, so lower the height to let the banks stand above the water, and raise this to let the water reach them. At 0 the water stops at the outline."
              value={settings?.excess ?? 0}
              min={0}
              max={10}
              step={0.1}
              onStart={() => editing.start("Lake excess")}
              onFinish={editing.finish}
              onChange={(v) => change("excess", v, false)}
            />
            <SliderField
              label="Shoreline following"
              value={settings?.curvature ?? 0}
              min={0}
              max={1}
              step={0.01}
              onStart={() => editing.start("Lake curvature")}
              onFinish={editing.finish}
              onChange={(v) => change("curvature", v, false)}
            />
            <button
              onClick={() =>
                editing.change("Reset lake", (look) => {
                  delete look.water.lakes[lake.id];
                })
              }
            >
              Reset this lake
            </button>
          </>
        )}
        {Object.keys(editing.look?.water.lakes ?? {})
          .filter((id) => !mesh?.lakes.some((l) => l.id === id))
          .map((id) => (
            <p key={id}>
              Unmatched saved lake: {id}{" "}
              <button
                onClick={() =>
                  editing.change("Remove lake override", (look) => {
                    delete look.water.lakes[id];
                  })
                }
              >
                Remove settings
              </button>
            </p>
          ))}
      </Section>
    </>
  );
}
