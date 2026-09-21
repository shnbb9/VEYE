import { expect, request, type APIRequestContext, type Page } from "@playwright/test";
import { API_URL, MAILPIT_URL } from "./accounts";

/* Shared helpers: portal sign-in through the real screens, Mailpit lookups
   for verification / reset links, and an API context for read-back
   assertions (the API is the source of truth for what was stored). */

/** Navigate and wait until the React tree has hydrated. The session provider
 *  asks the API who is signed in as its first act after hydration, so that
 *  request is a reliable "the page is interactive" signal on every screen
 *  (the dev server compiles on first visit, which can take seconds). */
export async function open(page: Page, path: string) {
  const hydrated = page.waitForResponse((response) => response.url().includes("/api/v1/auth/me"), { timeout: 45_000 });
  await page.goto(path);
  await hydrated;
}

export async function memberSignIn(page: Page, email: string, password: string) {
  await open(page, "/login");
  await page.getByLabel("Your Email").fill(email);
  await page.getByPlaceholder("Your Password").fill(password);
  await page.getByRole("button", { name: "Login" }).click();
}

export async function adminSignIn(page: Page, email: string, password: string) {
  await open(page, "/admin/login");
  await page.getByLabel(/Email address/).fill(email);
  await page.getByLabel(/^Password/).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

export async function expectMemberDashboard(page: Page) {
  await expect(page).toHaveURL(/\/app(\?|$)/);
  await expect(page.getByRole("heading", { name: /Welcome back/i })).toBeVisible();
}

export async function expectAdminHome(page: Page) {
  await expect(page).toHaveURL(/\/admin(\?|$)/);
  await expect(page.getByRole("heading", { name: /Good (morning|afternoon|evening)/ })).toBeVisible();
}

/** The API's own view of both portal sessions in this browser context. */
export async function portalSessions(page: Page): Promise<{ member: { email: string } | null; admin: { email: string } | null }> {
  return page.evaluate(async (api) => {
    const response = await fetch(`${api}/api/v1/auth/me`, { credentials: "include" });
    return response.json();
  }, API_URL);
}

export async function apiContext(): Promise<APIRequestContext> {
  return request.newContext({ baseURL: API_URL });
}

/** Answers the approved 12-question Health Number assessment from the first
 *  screen to the result (moderate, "very good health" profile). */
export async function answerOnboarding(page: Page) {
  const next = page.getByRole("button", { name: /^Next$/ });
  await page.getByRole("button", { name: "Live a Healthier Lifestyle" }).click();
  await next.click();
  await page.getByRole("button", { name: "No other plans" }).click();
  await next.click();
  await page.getByRole("button", { name: /Moderate/ }).click();
  await next.click();
  for (const answer of ["Yes", "No", "No", "No"]) {
    await page.locator(".quiz__options--yn").getByRole("button", { name: answer, exact: true }).click();
    await next.click();
  }
  await page.locator('[data-sleep="enough"]').getByRole("button", { name: "Yes", exact: true }).click();
  await page.locator('[data-sleep="well"]').getByRole("button", { name: "Yes", exact: true }).click();
  await page.getByLabel("Hours of sleep per night").fill("7");
  await next.click();
  await page.getByRole("button", { name: "No preference" }).click();
  await next.click();
  await page.getByRole("button", { name: "Friends or Family" }).click();
  await next.click();
}

/** Signs a fresh member up through the real screen and returns to the caller on /app or /onboarding. */
export async function signUpMember(page: Page, member: { email: string; password: string; firstName: string; lastName: string }) {
  await open(page, "/signup");
  await page.getByLabel("First name").fill(member.firstName);
  await page.getByLabel("Last name").fill(member.lastName);
  await page.getByLabel("Email", { exact: true }).fill(member.email);
  await page.getByPlaceholder("Enter your password").fill(member.password);
  await page.getByPlaceholder("Confirm your password").fill(member.password);
  await page.getByRole("button", { name: "Sign Up" }).click();
  await expect(page).toHaveURL(/\/(app|onboarding)/);
}

/** The signed-in member's own view of a slice, through the API (read-back assertions). */
export async function memberApi<T>(page: Page, path: string): Promise<T> {
  return page.evaluate(async ({ api, path }) => {
    const response = await fetch(`${api}${path}`, { credentials: "include" });
    if (!response.ok) throw new Error(`${path} → ${response.status}`);
    return response.json();
  }, { api: API_URL, path }) as Promise<T>;
}

/** No horizontal page overflow at the current viewport (the acceptance rule for every width). */
export async function expectNoHorizontalOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
}

/* ---- Mailpit ------------------------------------------------------------ */

type MailpitMessage = { ID: string; Subject: string; To: { Address: string }[]; Created: string };

export async function waitForMail(to: string, subjectPart: string, attempts = 20): Promise<{ id: string; text: string }> {
  const mail = await request.newContext({ baseURL: MAILPIT_URL });
  try {
    for (let i = 0; i < attempts; i++) {
      const search = await mail.get(`/api/v1/search?query=${encodeURIComponent(`to:${to}`)}&limit=50`);
      if (search.ok()) {
        const body = (await search.json()) as { messages: MailpitMessage[] };
        const match = body.messages.filter((m) => m.Subject.includes(subjectPart)).sort((a, b) => b.Created.localeCompare(a.Created))[0];
        if (match) {
          const message = await mail.get(`/api/v1/message/${match.ID}`);
          const detail = (await message.json()) as { Text: string };
          return { id: match.ID, text: detail.Text };
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(`No Mailpit message to ${to} with subject containing "${subjectPart}"`);
  } finally {
    await mail.dispose();
  }
}

export function linkFrom(text: string, path: string): string {
  const match = text.match(new RegExp(`https?://[^\\s]+/${path}\\?[^\\s)]+`));
  if (!match) throw new Error(`No ${path} link in email:\n${text}`);
  return match[0];
}

/** Turn an emailed absolute link into a same-origin path for the test browser. */
export function toPath(link: string): string {
  const url = new URL(link);
  return `${url.pathname}${url.search}`;
}
