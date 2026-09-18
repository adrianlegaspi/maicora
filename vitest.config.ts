import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/src/**/*.test.ts", "apps/**/src/**/*.test.ts", "evals/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    // Integration suites share one `maicora_test` database and truncate it
    // between tests, so files must not run concurrently.
    fileParallelism: false,
  },
});
