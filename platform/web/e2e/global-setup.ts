import type { FullConfig } from "@playwright/test";
import { API_URL, MAILPIT_URL } from "./fixtures/accounts";

/* Before any test: confirm the local stack is up (web, API, Mailpit) and warm
   every route the suite visits so the development server has compiled them.
   The Docker web service is `next dev`; its first compile of a route can take
   many seconds and spikes memory, which is not what the tests should measure. */

const ROUTES = [
  "/", "/login", "/signup", "/onboarding", "/verify-email", "/reset-password",
  "/app", "/app/progress", "/app/progress/body-composition", "/app/progress/blood-markers",
  "/app/progress/health-assessment", "/app/progress/simple-quiz", "/app/companion", "/app/settings",
  "/app/mood", "/app/food-diary", "/help",
  "/admin/login", "/admin", "/admin/members", "/admin/assessments", "/admin/assessments/simple_quiz",
  "/admin/care", "/admin/content", "/admin/insights", "/admin/requests", "/admin/settings", "/admin/companion/conversations",
  "/admin/companion/settings", "/admin/companion/settings/guided-experiences",
];

async function fetchOk(url: string, label: string, timeoutMs = 60_000): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: "manual" });
    if (response.status >= 500) throw new Error(`${label} answered ${response.status}`);
  } finally {
    clearTimeout(timer);
  }
}

export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = (config.projects[0]?.use.baseURL as string | undefined) ?? "http://localhost:3002";
  const checks: [string, string][] = [[`${API_URL}/health`, "API"], [`${MAILPIT_URL}/api/v1/info`, "Mailpit"], [`${baseURL}/login`, "web"]];
  for (const [url, label] of checks) {
    try {
      await fetchOk(url, label, 30_000);
    } catch (reason) {
      throw new Error(`The local VEYE stack is not reachable (${label} at ${url}). Start it with platform/scripts/local-up.ps1 -Mail. ${String(reason)}`);
    }
  }
  // Warm sequentially: parallel first compiles compete for the dev server's memory.
  for (const route of ROUTES) {
    try {
      await fetchOk(`${baseURL}${route}`, route, 90_000);
    } catch (reason) {
      console.warn(`[e2e] warm-up of ${route} did not complete: ${String(reason)}`);
    }
  }
}
