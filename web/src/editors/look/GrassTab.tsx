import Section from "../../ui/Section";
import { FieldList, ResetButton, type Editing } from "./FieldView";
import { GRASS_EDGE_FIELDS, GRASS_FIELDS, TUFT_FIELDS } from "./lookSchema";

/** The grass texture and the standing grass. */
export default function GrassTab({ editing }: { editing: Editing }) {
  return (
    <>
      <Section title="Grass texture and edges" actions={<ResetButton label="Grass" fields={GRASS_FIELDS} base={["grass"]} editing={editing} />}>
        <FieldList fields={GRASS_FIELDS} base={["grass"]} noun="Grass" editing={editing} />
      </Section>
      <Section title="Steps between surfaces" actions={<ResetButton label="Steps" fields={GRASS_EDGE_FIELDS} base={["grass"]} editing={editing} />}>
        <p className="muted">Each surface's grass height is set on Surfaces. Where two meet, the ground steps from one height to the other.</p>
        <FieldList fields={GRASS_EDGE_FIELDS} base={["grass"]} noun="Step" editing={editing} />
      </Section>
      <Section title="Standing grass (tufts)" actions={<ResetButton label="Tufts" fields={TUFT_FIELDS} base={["tufts"]} editing={editing} />}>
        <p className="muted">Where it grows, and how tall, is set on each surface (Surfaces, "Standing grass").</p>
        <FieldList fields={TUFT_FIELDS} base={["tufts"]} noun="Tufts" editing={editing} />
      </Section>
    </>
  );
}
