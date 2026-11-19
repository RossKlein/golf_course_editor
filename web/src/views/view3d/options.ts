import type { Viewer } from "../../scene/editorState/editorState";

/**
 * What the 3D view's panel sets. Grass range and density and the shadow quality are the viewer's settings, not part of the course's
 * look. They are kept in the editor's saved state (scene/editorState), so they are there when the bundle is opened again.
 */
export type Options = Viewer;
