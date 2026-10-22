import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Three builds into one dist/ (P-0004):
// - app:     the management tab (HTML entry, may split chunks)
// - content: the injected content script, one classic IIFE file without imports
// - sw:      the service worker, one classic IIFE file without imports
const SCRIPT_ENTRIES = {
  content: { entry: "src/content/main.ts", fileName: "content.js" },
  sw: { entry: "src/background/sw.ts", fileName: "sw.js" },
} as const;

export default defineConfig(({ mode }) => {
  const test = {
    environment: "node" as const,
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
  };

  if (mode === "content" || mode === "sw") {
    const { entry, fileName } = SCRIPT_ENTRIES[mode];
    return {
      publicDir: false,
      build: {
        outDir: "dist",
        emptyOutDir: false,
        minify: false,
        lib: { entry, formats: ["iife"], name: `lizychattidy_${mode}`, fileName: () => fileName },
      },
      test,
    };
  }

  return {
    plugins: [react()],
    base: "./",
    build: {
      outDir: "dist",
      emptyOutDir: true,
      rolldownOptions: { input: "app.html" },
    },
    test,
  };
});
