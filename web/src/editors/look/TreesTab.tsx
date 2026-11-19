import { ArrowDown, ArrowUp, Copy, Trash2 } from "lucide-react";
import Section from "../../ui/Section";
import { duplicateTreeKind, moveTreeKind, removeTreeKind } from "../../model/design/forest";
import { addPart, duplicatePart, MAX_KINDS, MAX_PARTS, movePart, removePart } from "../../model/look/trees";
import { FieldList, type Editing } from "./FieldView";
import { BLOB_FIELDS, FRUSTUM_FIELDS, TREE_KIND_FIELDS } from "./lookSchema";

type Props = { editing: Editing; kind: number; onKind: (index: number) => void };

/** The tree models: pick one, change its parts. A part is a cone or a faceted ball; the models are 1 unit tall and scaled to each tree. */
export default function TreesTab({ editing, kind, onKind }: Props) {
  const { look, change } = editing;
  if (!look) return null;
  const kinds = look.trees.kinds;
  const k = Math.min(kind, kinds.length - 1);
  const current = kinds[k];
  const base = ["trees", "kinds", k];
  const name = current.name;

  return (
    <>
      <div className="chips" role="tablist" aria-label="Tree model">
        {kinds.map((t, i) => (
          <button key={i} type="button" role="tab" aria-selected={i === k} className={i === k ? "chip on" : "chip"} onClick={() => onKind(i)}>
            {t.name}
          </button>
        ))}
      </div>
      <div className="row-buttons">
        <button type="button" disabled={kinds.length >= MAX_KINDS} title={kinds.length >= MAX_KINDS ? `At most ${MAX_KINDS} tree models` : `Add a copy of ${name}`} onClick={() => { const made = duplicateTreeKind(k); editing.finish(); if (made !== null) onKind(made); }}>
          <Copy size={14} /> Copy model
        </button>
        <button type="button" disabled={k === 0} title="Move earlier. Placed trees keep their model" onClick={() => { moveTreeKind(k, k - 1); editing.finish(); onKind(k - 1); }}>
          <ArrowUp size={14} />
        </button>
        <button type="button" disabled={k === kinds.length - 1} title="Move later" onClick={() => { moveTreeKind(k, k + 1); editing.finish(); onKind(k + 1); }}>
          <ArrowDown size={14} />
        </button>
        <button type="button" disabled={kinds.length <= 1} title={kinds.length <= 1 ? "There must be at least one tree model" : `Remove ${name}`} onClick={() => { removeTreeKind(k); editing.finish(); }}>
          <Trash2 size={14} />
        </button>
      </div>

      <Section title="Model">
        <FieldList fields={TREE_KIND_FIELDS} base={base} noun={name} editing={editing} />
      </Section>

      {current.parts.map((part, j) => {
        const fields = part.shape === "frustum" ? FRUSTUM_FIELDS : BLOB_FIELDS;
        const title = `${j + 1}. ${part.shape === "frustum" ? "Cone" : "Ball"}`;
        return (
          <Section
            key={j}
            title={title}
            defaultOpen={false}
            actions={
              <>
                <button type="button" className="icon" disabled={j === 0} title="Move earlier" aria-label={`Move ${title} earlier`} onClick={() => change(`Move ${name} part`, (l) => void movePart(l, k, j, j - 1))}>
                  <ArrowUp size={13} />
                </button>
                <button type="button" className="icon" disabled={j === current.parts.length - 1} title="Move later" aria-label={`Move ${title} later`} onClick={() => change(`Move ${name} part`, (l) => void movePart(l, k, j, j + 1))}>
                  <ArrowDown size={13} />
                </button>
                <button type="button" className="icon" disabled={current.parts.length >= MAX_PARTS} title="Copy this part" aria-label={`Copy ${title}`} onClick={() => change(`Copy ${name} part`, (l) => void duplicatePart(l, k, j))}>
                  <Copy size={13} />
                </button>
                <button type="button" className="icon" disabled={current.parts.length <= 1} title="Remove this part" aria-label={`Remove ${title}`} onClick={() => change(`Remove ${name} part`, (l) => void removePart(l, k, j))}>
                  <Trash2 size={13} />
                </button>
              </>
            }
          >
            <FieldList fields={fields} base={[...base, "parts", j]} noun={`${name} part ${j + 1}`} editing={editing} />
          </Section>
        );
      })}

      <div className="row-buttons">
        <button type="button" disabled={current.parts.length >= MAX_PARTS} onClick={() => change(`Add a cone to ${name}`, (l) => void addPart(l, k, "frustum"))}>
          Add a cone
        </button>
        <button type="button" disabled={current.parts.length >= MAX_PARTS} onClick={() => change(`Add a ball to ${name}`, (l) => void addPart(l, k, "blob"))}>
          Add a ball
        </button>
      </div>
    </>
  );
}
