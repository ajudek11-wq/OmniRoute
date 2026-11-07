import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  server: { host: true, port: 5173 },
  preview: { host: true, port: 4173 },
  build: { target: "es2020", chunkSizeWarningLimit: 1200 },
  // Self-contained: do not inherit PostCSS config from parent folders.
  css: { postcss: { plugins: [] } },
});
