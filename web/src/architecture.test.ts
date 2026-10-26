import { describe, expect, it } from "vitest";
import allowlist from "./architecture.allowlist.json";

// Enforces the layers in docs/frontend-architecture.md: a file may import only from layers below its own, and the layers
// the game will reuse (core, gfx, terrain) may not use UI packages.
//
// The allowlist holds known violations; it is empty, and an entry should only be added for a deliberate, temporary
// exception. To see the current violations while moving files:
//   VITE_ARCH_PRINT=1 npx vitest run src/architecture.test.ts

const RANK: Record<string, number> = {
  core: 1,
  gfx: 2,
  terrain: 3,
  model: 3, // a sibling of terrain: neither may import the other
  commands: 4,
  scene: 5,
  ui: 6,
  views: 7,
  editors: 8,
  shell: 9,
  app: 10,
};

/** The layers, by folder. */
const RULES: [RegExp, string][] = [
  [/^core\//, "core"],
  [/^gfx\//, "gfx"],
  [/^terrain\//, "terrain"],
  [/^model\//, "model"],
  [/^commands\//, "commands"],
  [/^scene\//, "scene"],
  [/^ui\//, "ui"],
  [/^views\//, "views"],
  [/^editors\//, "editors"],
  [/^shell\//, "shell"],
  [/^app\//, "app"],
  [/^main\.tsx$/, "app"],
];

/** Packages the layers the game will reuse must not depend on. */
const UI_PACKAGES = /^(react|react-dom|ol|radix-ui|lucide-react|tinykeys|react-resizable-panels|zustand|immer)(\/|$)/;
const REUSABLE = new Set(["core", "gfx", "terrain"]);

export function layerOf(path: string): string | null {
  for (const [re, layer] of RULES) if (re.test(path)) return layer;
  return null;
}

const sources = import.meta.glob<string>("./**/*.{ts,tsx}", { query: "?raw", import: "default", eager: true });
const files = Object.entries(sources)
  .map(([key, text]) => [key.slice(2), text] as const)
  .filter(([path]) => !path.startsWith("architecture."));

const IMPORT = /(?:import|export)\s[^"';]*?from\s*["']([^"']+)["']|import\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;

function resolve(from: string, spec: string): string {
  const parts = from.split("/").slice(0, -1);
  for (const seg of spec.split("?")[0].split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== ".") parts.push(seg);
  }
  return parts.join("/");
}

const known = new Set(files.map(([p]) => p));
function withExtension(path: string): string {
  for (const ext of [".ts", ".tsx", ".d.ts", "/index.ts", "/index.tsx", ""]) if (known.has(path + ext)) return path + ext;
  return path;
}

/** Every violation, as "from -> to" for a layering break and "from => package" for a UI package in a reusable layer. */
export function violations(): string[] {
  const out: string[] = [];
  for (const [path, text] of files) {
    const me = layerOf(path);
    if (!me) continue;
    for (const m of text.matchAll(IMPORT)) {
      const spec = m[1] ?? m[2] ?? m[3];
      if (spec.startsWith(".")) {
        const target = withExtension(resolve(path, spec));
        const there = layerOf(target);
        if (!there || there === me) continue;
        if (RANK[there] >= RANK[me]) out.push(`${path} -> ${target}`);
      } else if (REUSABLE.has(me) && UI_PACKAGES.test(spec)) {
        out.push(`${path} => ${spec}`);
      }
    }
  }
  return [...new Set(out)].sort();
}

describe("architecture", () => {
  it("places every file in a layer", () => {
    expect(files.filter(([p]) => !layerOf(p)).map(([p]) => p)).toEqual([]);
  });

  const found = violations();
  if (import.meta.env.VITE_ARCH_PRINT) console.log("ARCH-BEGIN\n" + JSON.stringify(found, null, 2) + "\nARCH-END");

  it("has no import pointing up the layers, beyond the allowlist", () => {
    const allowed = new Set<string>(allowlist);
    expect(found.filter((v) => !allowed.has(v))).toEqual([]);
  });

  it("has a README for every layer", () => {
    const readmes = import.meta.glob<string>("./*/README.md", { query: "?raw", import: "default", eager: true });
    const have = Object.keys(readmes).map((k) => k.split("/")[1]).sort();
    expect(have).toEqual(Object.keys(RANK).sort());
  });

  it("has an allowlist with nothing stale in it, so it only shrinks", () => {
    const now = new Set(found);
    expect((allowlist as string[]).filter((v) => !now.has(v))).toEqual([]);
  });
});
