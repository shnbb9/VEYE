import { expect, test, type Page } from "@playwright/test";
import { ADITYA } from "../fixtures/accounts";

/* What each screen does before React is listening.
 *
 * Every form in this application is handled in React: `onSubmit` calls
 * `preventDefault()` and talks to the API. None of them declared a `method`,
 * and HTML's default is GET — so a submit that landed BEFORE hydration was
 * performed by the browser itself, with every field in the query string.
 * Measured against the development server, which is this project's documented
 * demo and test mode:
 *
 *   /admin/login     → /admin/login?email=…&password=…
 *   /login           → /login?email=…&password=…&remember=on
 *   /signup          → /signup?password=…&confirm=
 *   /reset-password  → /reset-password?password=…&confirm=   (token dropped)
 *
 * The address bar, the browser's on-disk history, the next request's `Referer`
 * and every access log in front of the application.
 *
 * In the production build only ONE of those four reaches a visitor that way.
 * `/login`, `/admin/login` and `/reset-password` read the query string, which
 * puts them behind a `<Suspense fallback={null}>`, so their prerendered HTML
 * holds no form at all — and no content either. `/signup` does not, so its
 * form is server-rendered and the chosen password did reach the URL.
 *
 * This spec asserts both halves of that, per page and whichever way the page
 * renders, so it keeps guarding if a Suspense boundary ever moves:
 *
 *   a server-rendered form   → declares POST, and a submit puts nothing in the URL
 *   no server-rendered form  → the <noscript> note says why the page is empty
 *
 * tests/form-method.test.js covers all 16 forms statically, whatever renders. */

const SECRET = "NotARealPassword!123";

type Case = { name: string; path: string; fields: Record<string, string>; button: string };

const CASES: Case[] = [
  { name: "member sign-in", path: "/login", fields: { 'input[name="email"]': ADITYA.email, 'input[name="password"]': SECRET }, button: "Login" },
  { name: "console sign-in", path: "/admin/login", fields: { "#admin-email": "probe.admin@demo.veye.test", "#admin-password": SECRET }, button: "Sign in" },
  { name: "sign-up", path: "/signup", fields: { 'input[name="password"]': SECRET }, button: "Sign Up" },
  { name: "password reset", path: "/reset-password?token=probe-token", fields: { 'input[name="password"]': SECRET }, button: "Save new password" },
];

async function serverRenderedForms(page: Page) {
  return page.locator("form").count();
}

test.describe("a form submitted before hydration", () => {
  test.use({ javaScriptEnabled: false });

  for (const c of CASES) {
    test(`${c.name}: a server-rendered form POSTs, and an empty page says why`, async ({ page }) => {
      await page.goto(c.path, { waitUntil: "domcontentloaded" });
      const forms = await serverRenderedForms(page);

      if (forms === 0) {
        // Nothing to submit before hydration — but also nothing to read. The
        // prerendered HTML is the shell and the script tags, so without the
        // bundle a visitor saw the tab title and a blank page.
        await expect(page.locator(".noscript-note"), `${c.name}: renders no form AND no explanation without JavaScript`).toBeVisible();
        await expect(page.locator(".noscript-note")).toContainText(/JavaScript/i);
        expect(page.url(), `${c.name}: the URL changed without a form`).toContain(c.path.split("?")[0]);
        return;
      }

      const form = page.locator("form").first();
      await expect(form, `${c.name}: a form with no method submits as a GET`).toHaveAttribute("method", /^post$/i);

      for (const [selector, value] of Object.entries(c.fields)) await page.fill(selector, value);
      await page.getByRole("button", { name: c.button, exact: true }).first().click();
      // Give a navigation, if one is going to happen, time to land.
      await page.waitForTimeout(1000);

      const url = page.url();
      expect(url, `${c.name}: the password reached the URL`).not.toContain(SECRET);
      expect(url, `${c.name}: the password reached the URL, percent-encoded`).not.toContain(encodeURIComponent(SECRET));
      expect(decodeURIComponent(url), `${c.name}: the password reached the URL`).not.toContain(SECRET);
      // A GET submission replaces the whole query string, so anything the link
      // carried — a reset token, for one — went with it.
      for (const [key, value] of new URL(c.path, "http://x").searchParams) {
        expect(new URL(url).searchParams.get(key), `${c.name}: the submit dropped ?${key} from the link`).toBe(value);
      }
    });
  }

  test("the sign-up form is the one a visitor can really submit unhydrated", async ({ page }) => {
    // Named explicitly so the asymmetry is on the record rather than implied:
    // this page does not read the query string, so it is not behind a Suspense
    // boundary and its form is in the prerendered HTML.
    await page.goto("/signup", { waitUntil: "domcontentloaded" });
    expect(await serverRenderedForms(page)).toBeGreaterThan(0);
    await expect(page.locator("form").first()).toHaveAttribute("method", /^post$/i);
  });

  test("every screen a visitor can land on cold explains an empty page", async ({ page }) => {
    for (const path of ["/login", "/admin/login", "/reset-password", "/verify-email", "/confirm-email", "/onboarding", "/app"]) {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      await expect(page.locator(".noscript-note"), `${path}: no <noscript> explanation`).toBeVisible();
    }
  });
});
