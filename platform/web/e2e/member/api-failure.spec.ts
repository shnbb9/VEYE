import { expect, test, type Page } from "@playwright/test";
import { ADITYA } from "../fixtures/accounts";
import { expectMemberDashboard, memberSignIn, open } from "../fixtures/helpers";

/* What the member app does when the API stops answering.
 *
 * The same sweep as `e2e/admin/api-failure.spec.ts`, which found four console
 * screens left saying "Loading…" for ever because the state the indicator is
 * keyed on never changes on failure. The member app has its own indicators —
 * `.loading-row`, `.history-empty`, a `mode === "loading"` card, a dial that
 * reads "Loading…" — and a member has even less recourse than an
 * administrator: there is nowhere else for them to look.
 *
 * The claim is the one that holds on every screen: it may show content, a
 * stated problem, or an empty state, but it may not still be claiming to load.
 */

const SCREENS = [
  "/app",
  "/app/progress",
  "/app/progress/health-number",
  "/app/progress/health-assessment",
  "/app/progress/simple-quiz",
  "/app/progress/blood-markers",
  "/app/progress/body-composition",
  "/app/mood",
  "/app/food-diary",
  "/app/food-choices",
  "/app/meal-planning",
  "/app/companion",
  "/app/fitness",
  "/app/supplements",
  "/app/mindfulness",
  "/app/resources",
  "/app/settings",
];

/** Fail every API call except the one that answers "who is signed in", so the
 *  portal guard still renders the screen rather than holding its own
 *  "Opening your dashboard…" fallback — which would hide what is being tested. */
async function breakTheApi(page: Page) {
  await page.route("**/api/v1/**", async (route) => {
    if (route.request().url().includes("/api/v1/auth/me")) return route.fallback();
    await route.fulfill({ status: 503, contentType: "application/json", body: '{"detail":"Service unavailable."}' });
  });
}

test.describe("the member app when the API is down", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("no screen is left claiming to load", async ({ page }) => {
    await memberSignIn(page, ADITYA.email, ADITYA.password);
    await expectMemberDashboard(page);
    await breakTheApi(page);

    const stuck: string[] = [];
    for (const path of SCREENS) {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      await expect(page.locator(".main")).toBeVisible();
      // Long enough for every request to fail and every handler to run.
      await page.waitForTimeout(1500);

      // Any visible element whose own text says it is loading. Scoped to the
      // content area so the shell's own chrome is not mistaken for it.
      const saying = page.locator(".content").getByText(/loading/i);
      const count = await saying.count();
      const visible: string[] = [];
      for (let index = 0; index < count; index += 1) {
        if (await saying.nth(index).isVisible()) visible.push((await saying.nth(index).innerText()).trim().slice(0, 60));
      }
      if (visible.length) stuck.push(`${path} — ${visible.join(" | ")}`);
    }

    expect(stuck, "these screens swallow the failure and go on saying they are loading").toEqual([]);
  });

  test("a member is told when their own records could not be read", async ({ page }) => {
    /* A member looking at an empty tracker cannot tell "nothing saved yet"
       from "we could not read it". The Progress screens each have a place to
       say so; this asserts they use it rather than rendering as if the record
       were simply absent. */
    await memberSignIn(page, ADITYA.email, ADITYA.password);
    await expectMemberDashboard(page);
    await breakTheApi(page);

    const silent: string[] = [];
    for (const path of ["/app/progress/health-number", "/app/progress/health-assessment",
                        "/app/progress/simple-quiz", "/app/progress/blood-markers",
                        "/app/progress/body-composition"]) {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      await expect(page.locator(".main")).toBeVisible();
      await page.waitForTimeout(1500);
      const said = await page.locator('[role="alert"], .fdx-err, .errorbar').filter({ visible: true }).count();
      if (said === 0) silent.push(path);
    }
    expect(silent, "the record could not be read and the screen said nothing").toEqual([]);
  });
});
