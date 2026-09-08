import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Browser specifications are owned by Playwright, not Vitest.
    exclude: ["e2e/**", "node_modules/**", ".next/**", "dist/**"],
    // The long-horizon deterministic goldens are CPU-heavy and have explicit
    // per-test budgets; serial files avoid unrelated suite contention.
    fileParallelism: false,
  },
});
