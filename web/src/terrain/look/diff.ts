import type { Look } from "../../core/api/api";

/**
 * What a change of look makes the renderer redo. Anything not named here is a uniform, read again every frame, so it costs one
 * redraw and nothing else (the surfaces, tufts, sky, tree light, shadow strength, tint and distance, the grass numbers).
 */
export type LookChange = {
  /** The sun moved or its shadows' edge changed: the ground's sun lighting is baked again. */
  sunBake: boolean;
  /** The relief's smoothing changed: the slope texture is baked again. */
  relief: boolean;
  /** A tree model changed, in shape or in colour: the models are rebuilt from the look. */
  treeModels: boolean;
  /** A tree's shape changed, so what it hides of the sky and the sun is different: both are baked again. */
  treeShape: boolean;
  /** The number of tree kinds or their heights changed, so the trees must be grouped (or scattered) again by whoever sets them. */
  treeLayout: boolean;
  /** The grass image is a different file. */
  grassTile: boolean;
};

export const NO_CHANGE: Readonly<LookChange> = { sunBake: false, relief: false, treeModels: false, treeShape: false, treeLayout: false, grassTile: false };

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

/** A tree kind without what only colours it: the shape that hides the sky and casts a shadow. */
const shapeOf = (kind: Look["trees"]["kinds"][number]) => kind.parts.map((p) => ({ ...p, color: undefined, ...(p.shape === "frustum" ? { shade: undefined } : {}) })); // JSON leaves out what is undefined

/** Compare two looks and say what the renderer has to redo to go from `prev` to `next`. Pure. */
export function diffLook(prev: Look, next: Look): LookChange {
  const kinds = (l: Look) => l.trees.kinds;
  const treeModels = !same(kinds(prev), kinds(next));
  return {
    sunBake: !same(prev.sun, next.sun) || prev.shadows?.softness !== next.shadows?.softness,
    relief: prev.relief?.smoothing !== next.relief?.smoothing,
    treeModels,
    treeShape: treeModels && !same(kinds(prev).map(shapeOf), kinds(next).map(shapeOf)),
    treeLayout: kinds(prev).length !== kinds(next).length || !same(kinds(prev).map((k) => k.height), kinds(next).map((k) => k.height)),
    grassTile: prev.grass.tile !== next.grass.tile,
  };
}

/** Whether applying `change` runs a bake (slow enough that the panel says so), rather than only redrawing. */
export const bakes = (c: LookChange) => c.sunBake || c.relief || c.treeShape;
