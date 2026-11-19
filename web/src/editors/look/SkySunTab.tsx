import Section from "../../ui/Section";
import { FieldList, ResetButton, type Editing } from "./FieldView";
import { SKY_FIELDS, SUN_FIELDS, SUN_RAW_FIELDS } from "./lookSchema";

/** The sky's colour and where the sun is. */
export default function SkySunTab({ editing }: { editing: Editing }) {
  return (
    <>
      <Section title="Sky" actions={<ResetButton label="Sky" fields={SKY_FIELDS} base={[]} editing={editing} />}>
        <FieldList fields={SKY_FIELDS} base={[]} noun="Sky" editing={editing} />
      </Section>
      <Section title="Sun" actions={<ResetButton label="Sun" fields={SUN_FIELDS} base={["sun"]} editing={editing} />}>
        <FieldList fields={SUN_FIELDS} base={["sun"]} noun="Sun" editing={editing} />
      </Section>
      <Section title="Sun, exact numbers" defaultOpen={false}>
        <FieldList fields={SUN_RAW_FIELDS} base={["sun"]} noun="Sun" editing={editing} />
      </Section>
    </>
  );
}
