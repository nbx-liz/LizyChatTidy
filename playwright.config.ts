import { defineConfig } from "@playwright/test";

// Chrome integration tests (P-0008). The suite loads the built extension from
// dist/, so run `pnpm build` first (the `test:e2e` script does).
export default defineConfig({
  testDir: "tests/e2e",
  // Each test launches its own browser with an empty profile.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env["CI"],
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env["CI"] ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    trace: "retain-on-failure",
  },
});
