import { devices } from "@playwright/test";
import base from "./playwright.config";

/* The same suite in Firefox (Gecko). As for WebKit: run it AFTER a Chromium
   run, never alongside one, and it reuses that run's production build:
     npx playwright test -c playwright.firefox.config.ts e2e/auth-isolation.spec.ts …
   Firefox has no fake camera or microphone device, so food-diary-camera is
   Chromium's to prove. */
export default {
  ...base,
  projects: [{ name: "firefox", use: { ...devices["Desktop Firefox"], viewport: { width: 1440, height: 900 } } }],
};
