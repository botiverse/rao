import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

export default defineConfig({
  main: {
    // Dependencies (including @botiverse/oar, which is ESM-only) stay external
    // and are loaded by Electron's Node at runtime instead of being bundled.
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { "@shared": resolve("src/shared") },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      // The preload runs in a sandboxed renderer and must be CommonJS.
      rollupOptions: { output: { format: "cjs" } },
    },
    resolve: {
      alias: { "@shared": resolve("src/shared") },
    },
  },
  renderer: {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": resolve("src/renderer/src"),
        "@shared": resolve("src/shared"),
      },
    },
  },
});
