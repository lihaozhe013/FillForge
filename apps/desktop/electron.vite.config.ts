import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

const workspacePackages = [
  "@docufill/core",
  "@docufill/docx",
  "@docufill/extraction",
  "@docufill/runs",
  "@docufill/schema",
  "@docufill/templates",
];

export default defineConfig({
  main: {
    // Workspace packages are TypeScript source; they must be bundled, not
    // left as runtime requires pointing at .ts files.
    plugins: [externalizeDepsPlugin({ exclude: workspacePackages })],
    build: {
      rollupOptions: {
        input: { main: resolve(import.meta.dirname, "electron/main.ts") },
      },
    },
  },
  preload: {
    // Sandboxed preload scripts can only require Electron, so every
    // dependency must be bundled into the preload output.
    plugins: [],
    build: {
      rollupOptions: {
        input: { preload: resolve(import.meta.dirname, "electron/preload.ts") },
        output: {
          format: "cjs",
          entryFileNames: "[name].cjs",
        },
      },
    },
  },
  renderer: {
    root: "src",
    plugins: [react()],
    build: {
      rollupOptions: {
        input: resolve(import.meta.dirname, "src/index.html"),
      },
    },
  },
});
