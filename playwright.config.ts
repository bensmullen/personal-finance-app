import { defineConfig, devices } from "@playwright/test";

const householdProfile = process.env.PFM_HOUSEHOLD_EVIDENCE === "1";
const baseURL = "http://127.0.0.1:3100";

export default defineConfig({
  testDir: "./e2e",
  // The household profile is an exclusive inventory. Keep both manual suites
  // out of ordinary discovery and preserve the existing UX opt-in.
  ...(householdProfile
    ? { testMatch: "**/framework-household-readiness.spec.ts" }
    : { testIgnore: ["**/framework-household-readiness.spec.ts",
        ...(process.env.PFM_UX_EVIDENCE === "1" ? [] : ["**/ux-evidence.spec.ts"])] }),
  // Four independent runners provide concurrency. One worker per runner bounds
  // contention with next dev and real browser Workers. #207 measured ~1.17 GB
  // post-run Node heap; browser peak remains unmeasured.
  fullyParallel: Boolean(process.env.CI),
  ...(process.env.CI ? { workers: 1 } : {}),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    trace: process.env.CI ? "retain-on-failure" : "off",
    screenshot: "only-on-failure",
    ...devices["Desktop Chrome"],
    ...(process.env.CI ? {} : { channel: "chrome" as const }),
  },
  // The manual CI supervisor owns readiness, diagnostics and both process groups.
  ...(householdProfile && process.env.PFM_HOUSEHOLD_SUPERVISED === "1" ? {} : {
    webServer: {
      command: "node node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 3100",
      url: baseURL,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  }),
});
