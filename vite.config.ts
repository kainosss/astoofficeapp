import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The React client is built into dist/client and served by the Worker as static assets.
// `npm run dev:ui` runs Vite with hot reload and proxies /api to `wrangler dev` on port 8787.
export default defineConfig({
  plugins: [react()],
  root: "src/client",
  publicDir: "../../public",
  build: { outDir: "../../dist/client", emptyOutDir: true },
  server: { port: 5173, proxy: { "/api": "http://127.0.0.1:8787" } },
});
