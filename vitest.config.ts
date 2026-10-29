import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const srcDir = fileURLToPath(new URL("./src", import.meta.url));
const serverOnlyStub = fileURLToPath(new URL("./tests/stubs/serverOnly.ts", import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      // `server-only` throws unless resolved through the `react-server` export
      // condition, which Next.js provides and vitest does not. Aliasing it to an
      // empty stub lets tests import the real server-marked modules unchanged.
      // Exact-match regex so nothing else can be caught by a prefix match.
      { find: /^server-only$/, replacement: serverOnlyStub },
      { find: /^@$/, replacement: srcDir },
      { find: /^@\//, replacement: `${srcDir}/` },
    ],
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}", "src/**/*.test.{ts,tsx}"],
    css: false,
    restoreMocks: true,
  },
});
