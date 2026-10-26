// Shader source is kept in .glsl files. This resolves what GLSL itself cannot: `#include "name"` pulls in a shared chunk
// (once, wherever it is asked for), and the defines a program is built with are written in just after its #version line, so
// one TypeScript constant can be the single definition of a number the shader needs.

export type Chunks = Record<string, string>;
export type Defines = Record<string, number | string>;

const INCLUDE = /^[ \t]*#include[ \t]+"([^"]+)"[ \t]*$/;

export function preprocess(source: string, chunks: Chunks, defines: Defines = {}): string {
  const done = new Set<string>();
  const expand = (text: string, from: string): string =>
    text
      .split(/\r?\n/)
      .map((line) => {
        const m = INCLUDE.exec(line);
        if (!m) return line;
        const name = m[1];
        if (!(name in chunks)) throw new Error(`shader: ${from} includes "${name}", which does not exist`);
        if (done.has(name)) return "";
        done.add(name);
        return expand(chunks[name], name);
      })
      .join("\n");

  const lines = expand(source, "the program").split("\n");
  const at = lines.findIndex((l) => l.startsWith("#version"));
  if (at < 0) throw new Error("shader: no #version line");
  const defs = Object.entries(defines).map(([name, value]) => `#define ${name} ${value}`);
  lines.splice(at + 1, 0, ...defs);
  return lines.join("\n");
}
