import { execFile } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const OUT = resolve(__dirname, "out");
const REGIONS = resolve(OUT, "regions.json");

// Throwaway save/load for the spike: PUT/GET /spike/regions reads and writes out/regions.json.
function saveLoad(): Plugin {
  return {
    name: "spike-save-load",
    configureServer(server) {
      // POST /spike/rasterize runs py/rasterize.py with the repo venv and returns its report
      server.middlewares.use("/spike/rasterize", (_req, res) => {
        const python = resolve(__dirname, "../../.venv/Scripts/python.exe");
        const t = Date.now();
        execFile(python, [resolve(__dirname, "py/rasterize.py")], { cwd: __dirname }, (err, stdout, stderr) => {
          res.setHeader("Content-Type", "application/json");
          const lines = stdout.trim().split(String.fromCharCode(10));
          const report = err && !stdout ? { error: String(stderr || err) } : { ...JSON.parse(lines[lines.length - 1]), ms: Date.now() - t };
          res.end(JSON.stringify(report));
        });
      });
      server.middlewares.use("/spike/regions", (req, res) => {
        if (req.method === "PUT") {
          const chunks: Buffer[] = [];
          req.on("data", (c) => chunks.push(c));
          req.on("end", () => {
            mkdirSync(OUT, { recursive: true });
            writeFileSync(REGIONS, Buffer.concat(chunks));
            res.statusCode = 204;
            res.end();
          });
        } else {
          res.setHeader("Content-Type", "application/json");
          res.end(existsSync(REGIONS) ? readFileSync(REGIONS) : "null");
        }
      });
    },
  };
}

// The course maker server (python -m course_maker serve --port 8766) supplies the bundle and imagery.
const api = "http://127.0.0.1:8766";

export default defineConfig({
  plugins: [react(), saveLoad()],
  server: { host: "127.0.0.1", port: 5199, proxy: { "/api": api, "/files": api } },
});
