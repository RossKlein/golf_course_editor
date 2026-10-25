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
export type BakeRequest = Schemas["BakeRequest"];
export type BakeResult = Schemas["BakeResult"];

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

/** A bundle file, served exactly as the game will download it. */
export const fileUrl = (bundle: string, file: string) =>
  `/files/${[...bundle.split("/"), ...file.split("/")].map(q).join("/")}`;

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
  bake: (req: BakeRequest) =>
    request<BakeResult>("/api/bake", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    }),
  upload: (file: File) => request<TifEntry>(`/api/tifs/upload?name=${q(file.name)}`, { method: "PUT", body: file }),
};
