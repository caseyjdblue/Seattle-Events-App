import { defineConfig } from "vite";

// GitHub Pages project site: https://caseyjdblue.github.io/Seattle-Events-App/
// If the repository is renamed, change this base path to match.
export default defineConfig({
  base: "/Seattle-Events-App/",
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  preview: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: true,
  },
});
