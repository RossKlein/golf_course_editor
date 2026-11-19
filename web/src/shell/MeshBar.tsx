import { Crop, Mountain, RotateCcw, Scissors, Undo2 } from "lucide-react";
import { useEffect, useState } from "react";
import { api, type EditorState } from "../core/api/api";
import { reloadWith } from "../editors/heightmap/cropNotice";
import { MESH_TOOLS } from "../editors/heightmap/tools";
import { Hint } from "../ui/Hint";

type Props = {
  editor: EditorState;
  patch: (p: Partial<EditorState>) => void;
  /** The open bundle, for the crops it can take back. */
  bundle: string;
  /** Put the terrain back to what was baked. */
  onRestoreAll: () => void;
  /** Save what the editor has not, before the server rewrites the files. */
  save: () => Promise<void>;
  say: (text: string) => void;
};

const ICONS: Record<string, typeof Crop> = { crop: Crop, cut: Scissors, island: Mountain };

/**
 * The second bar of the Heightmap editor, attached under the first: what changes the shape of the map, where the brushes change the
 * ground in it. Crop makes the map smaller; Cut and Island take ground away altogether (a void); Restore puts the terrain back to what
 * was baked; Undo crop brings back the map as it was.
 */
export default function MeshBar({ editor, patch, bundle, onRestoreAll, save, say }: Props) {
  const [crops, setCrops] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let cancelled = false;
    api.crops(bundle).then((r) => !cancelled && setCrops(r.crops), () => undefined);
    return () => {
      cancelled = true;
    };
  }, [bundle]);

  const undoCrop = async () => {
    const ok = window.confirm("Bring back the map as it was before the last crop?\n\nThe design comes back as it was then too, so anything you changed since the crop is lost.");
    if (!ok) return;
    setBusy(true);
    try {
      await save();
      await api.undoCrop(bundle);
      reloadWith("The last crop is taken back: the map and the design are as they were before it.");
    } catch (e) {
      say(`Could not take the crop back: ${(e as Error).message}`);
      setBusy(false);
    }
  };

  return (
    <div className="sub-bar mesh-bar">
      <span className="group-label">Map shape</span>
      <div className="group" role="group" aria-label="Map shape tools">
        {MESH_TOOLS.map((t) => {
          const Icon = ICONS[t.id];
          return (
            <Hint key={t.id} label={t.hint} keys={[t.key]}>
              <button type="button" className={editor.tool === t.id ? "on" : undefined} aria-pressed={editor.tool === t.id} onClick={() => patch({ tool: t.id })}>
                {Icon && <Icon size={14} />} {t.label}
              </button>
            </Hint>
          );
        })}
      </div>
      <div className="group" role="group" aria-label="Restore">
        <Hint label="Take every sculpting edit away, so the whole map is the terrain that was baked. One undo step, so Ctrl+Z puts it back">
          <button type="button" onClick={onRestoreAll}><RotateCcw size={14} /> Restore original</button>
        </Hint>
        <Hint label={crops.length ? "Bring back the map and design as they were before the last crop (the last five are kept)" : "No crop to take back"}>
          <button type="button" disabled={!crops.length || busy} onClick={() => void undoCrop()}><Undo2 size={14} /> Undo crop{crops.length > 1 ? ` (${crops.length})` : ""}</button>
        </Hint>
      </div>
    </div>
  );
}
