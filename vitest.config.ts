import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Vitest v3 fork-worker RPC has a fixed ~60s onTaskUpdate timeout; our
    // required 120-month deterministic finance regression takes ~68s on CI.
    // Threads keep that synchronous correctness test without suppressing RPC
    // errors, shortening its horizon, or weakening the test assertion.
    pool: "threads",
    // Browser specifications are owned by Playwright, not Vitest.
    exclude: ["e2e/**", "node_modules/**", ".next/**", "dist/**"],
    // The long-horizon deterministic goldens are CPU-heavy and have explicit
    // per-test budgets; serial files avoid unrelated suite contention.
    fileParallelism: false,
  },
});
