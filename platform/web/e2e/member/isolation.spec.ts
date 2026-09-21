import { expect, test, type Browser } from "@playwright/test";
import { freshMember } from "../fixtures/accounts";
import { expectMemberDashboard, memberApi, memberSignIn, open, signUpMember } from "../fixtures/helpers";

/* Two members, two browsers: everything one member writes — a tracker
   result, a mood, a diary meal, a request, a profile change — is invisible to
   the other, through the screens and through the API. Histories never mix. */

async function signedUp(browser: Browser, member: ReturnType<typeof freshMember>) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signUpMember(page, member);
  return { context, page };
}

test.describe("Multiple members stay isolated", () => {
  test("member A's data never appears for member B", async ({ browser }) => {
    const a = freshMember("iso");
    const b = freshMember("iso");
    const A = await signedUp(browser, a);
    const B = await signedUp(browser, b);
    try {
      // A: a Simple Quiz result, a mood, a diary meal, a Join Beta request, a name change.
      await open(A.page, "/app/progress/simple-quiz");
      await expect(A.page.locator(".quiz-row").first()).toBeVisible();
      for (const row of await A.page.locator(".quiz-row").all()) await row.getByRole("button", { name: "No", exact: true }).click();
      await A.page.getByRole("button", { name: "Submit Quiz" }).click();
      await expect(A.page.locator("#simpleResultScore")).toHaveText("8 No / 0 Yes");

      await open(A.page, "/app/mood");
      await A.page.getByRole("button", { name: "Log Your Mood Today" }).click();
      await A.page.locator('.emoji-btn[data-mood="happy"]').click();
      await A.page.locator("#noteText").fill("Private to A");
      await A.page.getByRole("button", { name: "Save Mood" }).click();
      await expect(A.page.getByTestId("mood-day-detail")).toContainText("Private to A");

      await open(A.page, "/app/food-diary");
      await A.page.locator("#fdxWhat").fill("A's private breakfast");
      await A.page.locator("#fdxTime").fill("08:15");
      await A.page.getByRole("button", { name: "Add Entry" }).click();
      await expect(A.page.getByTestId("diary-meals")).toContainText("A's private breakfast");

      await open(A.page, "/app");
      await A.page.getByTestId("beta-join").click();
      await expect(A.page.getByTestId("beta-status")).toContainText(/Beta request sent/);

      await open(A.page, "/app/settings");
      await A.page.getByTestId("settings-first-name").fill("Alpha");
      await A.page.getByTestId("settings-save").click();
      await expect(A.page.getByTestId("settings-profile-note")).toHaveText("Profile saved.");

      // B sees none of it — screens…
      await open(B.page, "/app");
      await expectMemberDashboard(B.page);
      await expect(B.page.getByRole("heading", { name: `Welcome back ${b.firstName}` })).toBeVisible();
      await expect(B.page.getByTestId("mood-card")).toContainText("not logged yet");
      await expect(B.page.getByTestId("beta-join")).toBeVisible();
      await open(B.page, "/app/mood");
      await expect(B.page.getByTestId("mood-logged")).toHaveText("0");
      await expect(B.page.getByTestId("mood-day-detail")).not.toContainText("Private to A");
      await open(B.page, "/app/food-diary");
      await expect(B.page.getByTestId("diary-meals")).not.toContainText("private breakfast");
      await expect(B.page.getByText("No entries for the day")).toBeVisible();
      await open(B.page, "/app/settings");
      await expect(B.page.getByTestId("settings-first-name")).toHaveValue(b.firstName);

      // …and the API, which is the source of truth.
      const bQuiz = await memberApi<{ history: unknown[] }>(B.page, "/api/v1/members/me/simple-quiz");
      const bMood = await memberApi<{ entries: unknown[] }>(B.page, "/api/v1/members/me/mood");
      const bRequests = await memberApi<unknown[]>(B.page, "/api/v1/members/me/requests");
      expect(bQuiz.history).toHaveLength(0);
      expect(bMood.entries).toHaveLength(0);
      expect(bRequests).toHaveLength(0);
      const aQuiz = await memberApi<{ history: unknown[] }>(A.page, "/api/v1/members/me/simple-quiz");
      expect(aQuiz.history).toHaveLength(1);

      // B cannot address A's rows by id.
      const today = await A.page.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; });
      const aMeal = (await memberApi<{ meals: { id: string }[] }>(A.page, `/api/v1/members/me/food-diary?date=${today}`)).meals[0];
      const forbidden = await B.page.evaluate(async ({ api, id }) => {
        const response = await fetch(`${api}/api/v1/members/me/food-diary/${id}`, { method: "DELETE", credentials: "include" });
        return response.status;
      }, { api: process.env.E2E_API_URL ?? "http://localhost:8001", id: aMeal.id });
      expect(forbidden).toBe(404);
    } finally {
      await A.context.close();
      await B.context.close();
    }
  });

  test("signing in as a different member in the same browser swaps every screen to that member", async ({ page }) => {
    const first = freshMember("iso");
    await signUpMember(page, first);
    await open(page, "/app/settings");
    await expect(page.getByTestId("settings-email")).toHaveValue(first.email);
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/$/);

    await memberSignIn(page, "maya.demo@demo.veye.test", "MayaDemo!2026-local");
    await expectMemberDashboard(page);
    await expect(page.getByRole("heading", { name: "Welcome back Maya" })).toBeVisible();
    await open(page, "/app/settings");
    await expect(page.getByTestId("settings-email")).toHaveValue("maya.demo@demo.veye.test");
    await expect(page.getByTestId("topbar-avatar")).toHaveText("M");
  });
});
