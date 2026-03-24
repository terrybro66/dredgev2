import path from "path";
import { defineConfig } from "vitest/config";
import "dotenv/config";

export default defineConfig({
  resolve: {
    alias: {
      "@mocks": path.resolve(__dirname, "src/__mocks__"),
    },
  },
  test: {
    environment: "node",
    setupFiles: ["./src/__mocks__/setup.ts"],
    exclude: ["**/dist/**", "**/node_modules/**"],
  },
});
