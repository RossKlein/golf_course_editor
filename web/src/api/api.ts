// Typed client for the course maker server. Types come from the pydantic models through the OpenAPI schema:
//   python -m course_maker openapi   then   npm run types
import type { components } from "./schema";

type Schemas = components["schemas"];
export type Index = Schemas["Index"];
export type TifEntry = Schemas["TifEntry"];
export type BundleEntry = Schemas["BundleEntry"];
export type TifView = Schemas["TifView"];
export type Course = Schemas["Course"];
export type Report = Schemas["Report"];
export type AerialMeta = Schemas["AerialMeta"];
export type HeightBase = Schemas["HeightBase"];
export type BakeRequest = Schemas["BakeRequest"];
export type BakeResult = Schemas["BakeResult"];
// FastAPI emits separate input/output schemas where fields have defaults. The output form has every field present,
// and a complete object also satisfies the input form, so it is used both ways.
export type EditorState = Schemas["EditorState-Output"];
export type EditorResponse = Schemas["EditorResponse"];
export type Viewport = Schemas["Viewport"];
export type LayerPref = Schemas["LayerPref"];
export type Region = Schemas["Region-Output"];
export type BoundsArea = Schemas["BoundsArea-Output"];
export type Layout = Schemas["Layout-Output"];
export type DesignHole = Schemas["DesignHole-Output"];
export type DesignDoc = Schemas["DesignDoc"];
export type BuildStatus = Schemas["BuildStatus"];

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      message = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
    } catch {
      // not JSON: keep the status text
    }
    throw new ApiError(message, res.status);
  }
  return (await res.json()) as T;
}

const q = encodeURIComponent;

async function put(url: string, body: unknown, keepalive = false) {
  const res = await fetch(url, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), keepalive });
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const j = await res.json();
      message = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail).slice(0, 300);
    } catch {
      // keep the status text
    }
    throw new ApiError(message, res.status);
  }
}

/** A bundle file, served exactly as the game will download it. */
export const fileUrl = (bundle: string, file: string) =>
  `/files/${[...bundle.split("/"), ...file.split("/")].map(q).join("/")}`;

export const heightBaseUrl = (bundle: string) => `/api/bundle/design/height/base.png?path=${q(bundle)}&t=${Date.now()}`;
export const tifRgbUrl = (path: string) => `/api/tif/rgb.jpg?path=${q(path)}`;
export const tifElevationUrl = (path: string) => `/api/tif/elevation.png?path=${q(path)}`;

export const api = {
  index: () => request<Index>("/api/index"),
  tif: (path: string) => request<TifView>(`/api/tif?path=${q(path)}`),
  course: (bundle: string) => request<Course>(fileUrl(bundle, "course.json")),
  validate: (bundle: string) => request<Report>(`/api/bundle/validate?path=${q(bundle)}`),
  /** The bundle's aerial placement, or null when its source stack is unknown. */
  aerial: async (bundle: string) => {
    try {
      return await request<AerialMeta>(`/api/bundle/aerial?path=${q(bundle)}`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return null;
      throw e;
    }
  },
  editor: (bundle: string) => request<EditorResponse>(`/api/bundle/editor?path=${q(bundle)}`),
  /** Save the editor state. keepalive lets the request finish while the page is closing. */
  saveEditor: async (bundle: string, state: EditorState, keepalive = false) => {
    const res = await fetch(`/api/bundle/editor?path=${q(bundle)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state),
      keepalive,
    });
    if (!res.ok) throw new ApiError(`${res.status} ${await res.text()}`, res.status);
  },
  /** The pristine baked heights, which sculpting is an offset from. */
  heightBase: (bundle: string) => request<HeightBase>(`/api/bundle/design/height/base?path=${q(bundle)}`),
  /** The sculpting offsets, or an empty array when nothing was sculpted. */
  heightDelta: async (bundle: string) => {
    const res = await fetch(`/api/bundle/design/height?path=${q(bundle)}`, { cache: "no-store" });
    if (!res.ok) throw new ApiError(`${res.status} ${await res.text()}`, res.status);
    return new Uint8Array(await res.arrayBuffer());
  },
  saveHeightDelta: async (bundle: string, bytes: Uint8Array, keepalive = false) => {
    const res = await fetch(`/api/bundle/design/height?path=${q(bundle)}`, { method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: bytes as BodyInit, keepalive: keepalive && bytes.length < 60000 });
    if (!res.ok) throw new ApiError(`${res.status} ${await res.text()}`, res.status);
  },
  design: (bundle: string) => request<DesignDoc>(`/api/bundle/design?path=${q(bundle)}`),
  saveRegions: (bundle: string, regions: Region[], keepalive = false) => put(`/api/bundle/design/regions?path=${q(bundle)}`, { regions }, keepalive),
  saveLayout: (bundle: string, layout: Layout, keepalive = false) => put(`/api/bundle/design/layout?path=${q(bundle)}`, layout, keepalive),
  saveBounds: (bundle: string, areas: BoundsArea[], keepalive = false) => put(`/api/bundle/design/bounds?path=${q(bundle)}`, { areas }, keepalive),
  buildStatus: (bundle: string) => request<BuildStatus>(`/api/bundle/build?path=${q(bundle)}`),
  buildNow: (bundle: string) => request<BuildStatus>(`/api/bundle/build?path=${q(bundle)}`, { method: "POST" }),
  bake: (req: BakeRequest) =>
    request<BakeResult>("/api/bake", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    }),
  upload: (file: File) => request<TifEntry>(`/api/tifs/upload?name=${q(file.name)}`, { method: "PUT", body: file }),
};
