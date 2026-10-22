import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  // Manual UX captures must not enter normal CI discovery or reshuffle E2E shards.
  testIgnore: process.env.PFM_UX_EVIDENCE === "1" ? [] : ["**/ux-evidence.spec.ts"],
  // Four independent runners provide concurrency. One worker per runner bounds
  // contention with next dev and real browser Workers. #207 measured ~1.17 GB
  // post-run Node heap; browser peak remains unmeasured.
  fullyParallel: Boolean(process.env.CI),
  ...(process.env.CI ? { workers: 1 } : {}),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: process.env.CI ? "retain-on-failure" : "off",
    screenshot: "only-on-failure",
    ...devices["Desktop Chrome"],
    ...(process.env.CI ? {} : { channel: "chrome" as const }),
  },
  webServer: {
    command: "node node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 3100",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
