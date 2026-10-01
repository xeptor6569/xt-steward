import { defineConfig, devices } from "@playwright/test";
import { API_URL, WEB_PORT, WEB_URL } from "./e2e/support/stack";

export default defineConfig({
  testDir: "./e2e",
  timeout: 180_000,
  expect: { timeout: 20_000 },
  // The suite tells one continuous story against shared backend state.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  use: {
    baseURL: WEB_URL,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm exec next dev --port ${WEB_PORT}`,
    url: `${WEB_URL}/login`,
    env: {
      NEXT_PUBLIC_STEWARD_API_URL: API_URL,
      STEWARD_API_INTERNAL_URL: API_URL,
    },
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
