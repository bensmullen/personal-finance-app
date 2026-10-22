import { defineConfig } from "vitest/config";
import { readFileSync } from "node:fs";

const assigned: unknown = process.env.PFM_UNIT_ASSIGNMENT
  ? JSON.parse(readFileSync(process.env.PFM_UNIT_ASSIGNMENT, "utf8")) : undefined;
if (assigned !== undefined && (!Array.isArray(assigned) || !assigned.length ||
    assigned.some(file => typeof file !== "string" || !file || /[\r\n\\]/u.test(file) ||
      file.startsWith("/") || file.split("/").includes("..")) ||
    new Set(assigned).size !== assigned.length)) throw new Error("Invalid unit assignment");

export default defineConfig({
  test: {
    ...(assigned ? { include: (assigned as string[]).map(file => file.replace(/[?*\[\]{}()!+@]/gu, "\\$&")) } : {}),
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
