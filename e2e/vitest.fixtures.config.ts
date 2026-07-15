import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["e2e/fixtures/**/*.test.ts"],
    testTimeout: 5_000,
    hookTimeout: 5_000,
    pool: "forks",
    maxWorkers: 1,
  },
});
