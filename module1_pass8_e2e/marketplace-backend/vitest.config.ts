import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./tests/setup/env.ts"],
    clearMocks: true,
    restoreMocks: true,
    mockReset: true,
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 20_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/server.ts", "src/database/check.ts"],
    },
  },
});
