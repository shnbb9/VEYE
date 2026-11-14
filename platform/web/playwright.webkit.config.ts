import { devices } from "@playwright/test";
import base from "./playwright.config";

/* The same suite in WebKit (Safari's engine), for a second-browser pass:
     npx playwright test -c playwright.webkit.config.ts e2e/public/saved-result.spec.ts …
   Run it AFTER a Chromium run, never alongside one: both use the same local
   database and the same global settings (retention, sharing mode). It reuses
   the production build the Chromium run made (`npm run e2e` builds it). */
export default {
  ...base,
  projects: [{ name: "webkit", use: { ...devices["Desktop Safari"], viewport: { width: 1440, height: 900 } } }],
};
