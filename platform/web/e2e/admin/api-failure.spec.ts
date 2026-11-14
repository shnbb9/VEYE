import { expect, test, type Page } from "@playwright/test";
import { ADMIN } from "../fixtures/accounts";
import { adminSignIn, expectAdminHome, open } from "../fixtures/helpers";

/* What every screen does when the API stops answering.
 *
 * Twenty-odd places in the console load something with
 * `.catch(() => setThing(null))`. Most are deliberate: a secondary counter
 * that degrades to nothing, with a comment saying so. The problem is the ones
 * where the swallowed error leaves a `<p class="loading-row">Loading…</p>` on
 * screen for ever, because the state it is keyed on never changes. An
 * administrator then sees a screen that looks like it is still working.
 *
 * Auditing twenty catch handlers by eye would prove nothing about the
 * twenty-first, so this forces every API call to fail and visits each screen.
 * The claim is the one that holds everywhere: a screen may show content, an
 * error, or an empty state, but it may not still be claiming to load.
 */

const SCREENS = [
  "/admin",
  "/admin/members",
  "/admin/assessments",
  "/admin/care",
  "/admin/requests",
  "/admin/content",
  "/admin/insights",
  "/admin/settings",
  "/admin/companion/conversations",
  "/admin/companion/feedback",
  "/admin/companion/knowledge-sources",
  "/admin/companion/settings",
  "/admin/companion/settings/guided-experiences",
  "/admin/companion/settings/advanced/ai-monitoring",
  "/admin/companion/settings/advanced/audit",
  "/admin/companion/settings/advanced/provider-status",
  "/admin/companion/settings/advanced/retrieval-diagnostics",
  "/admin/companion/settings/advanced/safety-analytics",
];

/** Fail every API call except the one that answers "who is signed in", so the
 *  portal guard still lets the screen render rather than redirecting away. */
async function breakTheApi(page: Page) {
  await page.route("**/api/v1/**", async (route) => {
    if (route.request().url().includes("/api/v1/auth/me")) return route.fallback();
    await route.fulfill({ status: 503, contentType: "application/json", body: '{"detail":"Service unavailable."}' });
  });
}

test.describe("the console when the API is down", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("no screen is left claiming to load", async ({ page }) => {
    await open(page, "/admin/login");
    await adminSignIn(page, ADMIN.email, ADMIN.password);
    await expectAdminHome(page);

    await breakTheApi(page);

    const stuck: string[] = [];
    for (const path of SCREENS) {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      await expect(page.locator("#main-content")).toBeVisible();
      // Give every request time to fail and every handler time to run.
      await page.waitForTimeout(1200);

      const loading = page.locator(".loading-row");
      const count = await loading.count();
      let visible = 0;
      for (let index = 0; index < count; index += 1) {
        if (await loading.nth(index).isVisible()) visible += 1;
      }
      if (visible > 0) {
        const texts = await loading.allInnerTexts();
        stuck.push(`${path} — ${visible} loading row(s) still shown: ${texts.join(" | ").slice(0, 100)}`);
      }
    }

    expect(stuck, "these screens swallow the failure and go on saying they are loading").toEqual([]);
  });

  test("the screens that do report the failure say so visibly", async ({ page }) => {
    // Not every element has to announce a failure — a secondary counter may
    // degrade to nothing. But a screen whose MAIN list failed has to say so,
    // or the administrator reads an empty list as "there is nothing here".
    await open(page, "/admin/login");
    await adminSignIn(page, ADMIN.email, ADMIN.password);
    await expectAdminHome(page);
    await breakTheApi(page);

    const silent: string[] = [];
    for (const path of ["/admin/members", "/admin/requests", "/admin/content", "/admin/care", "/admin/companion/conversations"]) {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      await expect(page.locator("#main-content")).toBeVisible();
      await page.waitForTimeout(1200);
      const said = await page.locator(".errorbar, .state, .empty-row").filter({ visible: true }).count();
      if (said === 0) silent.push(path);
    }
    expect(silent, "the main list failed to load and the screen said nothing at all").toEqual([]);
  });
});
