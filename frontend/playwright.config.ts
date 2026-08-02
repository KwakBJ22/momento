import { defineConfig, devices } from "@playwright/test";

// Smoke tests run MANUALLY against a deployed URL — there is no CI. They exist to
// catch what the source-regex unit tests cannot: a blank screen, dead CSS, or a
// route that 500s in the real browser after a deploy.
//
// Default target is production; override for a Vercel Preview or local run:
//   SMOKE_BASE_URL=https://<preview>.vercel.app npm run test:smoke
//   SMOKE_BASE_URL=http://localhost:5173        npm run test:smoke
const baseURL = process.env.SMOKE_BASE_URL || "https://momento-ashen-rho.vercel.app";

export default defineConfig({
  testDir: "./tests-e2e",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
