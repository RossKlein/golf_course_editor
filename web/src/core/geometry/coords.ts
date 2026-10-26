// Course coordinates are metres: x east, z south. OpenLayers is y-up, so map coordinates are [x, -z].
export type Pt = [number, number];
export const toMap = ([x, z]: Pt): Pt => [x, -z];
export const fromMap = ([x, y]: Pt): Pt => [x, -y];

export type Rect = { x: number; z: number; w: number; h: number };
