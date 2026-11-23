import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // One in-memory MongoDB for the run; each file gets its own database.
    globalSetup: ["tests/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 180_000,
  },
});
