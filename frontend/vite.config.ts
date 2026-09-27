import { defineConfig, type Connect, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";

/**
 * Missing offline assets (an unbundled glyph range or DEM tile) must 404.
 * Vite's SPA fallback would otherwise answer with index.html, which MapLibre
 * then tries to decode as protobuf and the map stops loading.
 */
function offline404(root: string): Plugin {
  const guard: Connect.NextHandleFunction = (req, res, next) => {
    const url = decodeURIComponent((req.url ?? "").split("?")[0]);
    if (url.startsWith("/offline/") && !fs.existsSync(path.join(root, url))) {
      res.statusCode = 404;
      res.end();
      return;
    }
    next();
  };
  return {
    name: "offline-404",
    configureServer: (s) => void s.middlewares.use(guard),
    configurePreviewServer: (s) => void s.middlewares.use(guard),
  };
}

export default defineConfig({
  plugins: [react(), offline404(path.resolve(__dirname, "public"))],
  server: { host: true, port: 5173 },
  preview: { host: true, port: 4173 },
  build: {
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks: { maplibre: ["maplibre-gl", "pmtiles", "@protomaps/basemaps"], react: ["react", "react-dom"] },
      },
    },
  },
});
