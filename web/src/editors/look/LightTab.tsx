import Section from "../../ui/Section";
import { FieldList, ResetButton, type Editing } from "./FieldView";
import { RELIEF_FIELDS, SHADOW_FIELDS, TREE_LIGHT_FIELDS } from "./lookSchema";

/** Shadows, how the slope shades the ground, and the light on the trees. */
export default function LightTab({ editing }: { editing: Editing }) {
  return (
    <>
      <Section title="Shadows" actions={<ResetButton label="Shadows" fields={SHADOW_FIELDS} base={["shadows"]} editing={editing} />}>
        <FieldList fields={SHADOW_FIELDS} base={["shadows"]} noun="Shadow" editing={editing} />
      </Section>
      <Section title="Relief and shading" actions={<ResetButton label="Relief" fields={RELIEF_FIELDS} base={["relief"]} editing={editing} />}>
        <FieldList fields={RELIEF_FIELDS} base={["relief"]} noun="Relief" editing={editing} />
      </Section>
      <Section title="Light on the trees" actions={<ResetButton label="Tree light" fields={TREE_LIGHT_FIELDS} base={["trees"]} editing={editing} />}>
        <FieldList fields={TREE_LIGHT_FIELDS} base={["trees"]} noun="Tree" editing={editing} />
      </Section>
    </>
  );
}
