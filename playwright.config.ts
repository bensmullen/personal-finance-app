import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  // Keep local runs predictable, but let independent tests within the single
  // E2E spec file use multiple workers in CI to reduce wall-clock time.
  fullyParallel: Boolean(process.env.CI),
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
