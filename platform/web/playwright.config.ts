import { defineConfig, devices } from "@playwright/test";

/* VEYE end-to-end acceptance against the LOCAL Docker stack
   (platform/scripts/local-up.ps1):
     api      http://localhost:8001
     mailpit  http://localhost:8026
     web      a PRODUCTION build of this project served on http://localhost:3013
              for the length of the run. Playwright builds, starts and STOPS
              it; the person's own VEYE runtime (the Docker web service on
              http://localhost:3012) is never touched, so it is still there
              when the suite exits. CORS for 3013 is in the local env file.
              Set E2E_BASE_URL=http://localhost:3012 to run the suite against
              that Docker development server instead (no build, no server).
   The stack seeds the synthetic QA accounts (app/seed/users.py). Tests that
   need a fresh member sign one up with a unique address. Override the API and
   mailbox with E2E_API_URL / E2E_MAILPIT_URL. */

const externalWeb = process.env.E2E_BASE_URL;
const E2E_PORT = 3013;
const baseURL = externalWeb ?? `http://localhost:${E2E_PORT}`;
const apiURL = process.env.E2E_API_URL ?? "http://localhost:8001";

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { open: "never", outputFolder: "test-output/playwright-report" }]],
  outputDir: "test-output/playwright-results",
  webServer: externalWeb ? undefined : {
    // `npm run e2e` builds first (pree2e → e2e/build.mjs); this only serves it.
    command: `npx next start -p ${E2E_PORT}`,
    url: `${baseURL}/login`,
    reuseExistingServer: true,
    timeout: 120_000,
    env: { NEXT_PUBLIC_API_URL: apiURL },
  },
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
});
