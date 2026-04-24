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
    env: {
      // The OpenAI SDK throws at construction time if apiKey is empty.
      // intent.ts uses it pointed at DeepSeek — a dummy value satisfies the
      // SDK in the test environment without making any real API calls.
      DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY ?? "test-key",
    },
  },
});
