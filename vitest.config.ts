import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 15_000,
    hookTimeout: 20_000,
    restoreMocks: true
  }
});
