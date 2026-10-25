import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In development the FastAPI server (python -m course_maker serve) runs on 8765 and Vite proxies to it.
// In production FastAPI serves the built dist/ itself.
const api = "http://127.0.0.1:8765";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: { "/api": api, "/files": api },
  },
  build: { outDir: "dist" },
});
