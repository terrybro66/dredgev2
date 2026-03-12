import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@dredge/schemas": new URL("./src/index.ts", import.meta.url).pathname,
    },
  },
  test: {
    include: ["src/__tests__/**/*.test.ts"],
    exclude: ["dist/**"],
  },
});
