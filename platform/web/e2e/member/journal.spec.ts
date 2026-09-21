import { expect, test } from "@playwright/test";
import { freshMember } from "../fixtures/accounts";
import { expectMemberDashboard, memberApi, open, signUpMember } from "../fixtures/helpers";

/* Mood Tracker and Food Diary as a member uses them: log, edit, remove; the
   header figures follow the client's Balance formula; the dashboard Mood card
   reflects the latest entry; everything survives a reload because it lives on
   the server. */

test.describe.serial("Mood Tracker and Food Diary", () => {
  const member = freshMember("e2e");

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await signUpMember(page, member);
    await page.close();
  });

  test.beforeEach(async ({ page }) => {
    await open(page, "/login");
    await page.getByLabel("Your Email").fill(member.email);
    await page.getByPlaceholder("Your Password").fill(member.password);
    await page.getByRole("button", { name: "Login" }).click();
    await expectMemberDashboard(page);
  });

  test("moods: one per day, note editing, Balance score, dashboard card", async ({ page }) => {
    await open(page, "/app/mood");
    await expect(page.getByTestId("mood-logged")).toHaveText("0");
    await expect(page.getByTestId("mood-balance")).toHaveText("—");

    // Today: stressed → note → save.
    await page.getByRole("button", { name: "Log Your Mood Today" }).click();
    await page.locator('.emoji-btn[data-mood="stressed"]').click();
    await page.locator("#noteText").fill("Long day");
    await page.getByRole("button", { name: "Save Mood" }).click();
    await expect(page.getByTestId("mood-day-detail")).toContainText("You felt Stressed");
    await expect(page.getByTestId("mood-streak")).toHaveText("1");
    await expect(page.getByTestId("mood-balance")).toHaveText("0%"); // stressed = 0

    // Change today's mood to calm (same day → replaced, not added) and edit the note.
    await page.getByRole("button", { name: "Change mood" }).click();
    await page.locator('.emoji-btn[data-mood="calm"]').click();
    await page.getByRole("button", { name: "Save Mood" }).click();
    await expect(page.getByTestId("mood-day-detail")).toContainText("You felt Calm");
    await expect(page.getByTestId("mood-logged")).toHaveText("1");
    await expect(page.getByTestId("mood-balance")).toHaveText("100%");
    await page.getByRole("button", { name: "Edit text" }).click();
    await page.locator("#noteText").fill("Good walk");
    await page.getByRole("button", { name: "Save Mood" }).click();
    await expect(page.getByTestId("mood-day-detail")).toContainText("Good walk");

    // Yesterday: neutral (logged from the calendar) → Balance (100 + 50) / 2 = 75, streak 2.
    const yesterday = await page.evaluate(() => { const d = new Date(); d.setDate(d.getDate() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; });
    const cell = page.locator(`.cal-day[data-date="${yesterday}"]`);
    if (await cell.count() === 0) await page.getByRole("button", { name: "Previous month" }).click(); // month boundary
    await page.locator(`.cal-day[data-date="${yesterday}"]`).click();
    await page.getByTestId("mood-day-detail").getByRole("button", { name: /Log mood for/ }).click();
    await page.locator('.emoji-btn[data-mood="neutral"]').click();
    await page.getByRole("button", { name: "Save Mood" }).click();
    await expect(page.getByTestId("mood-day-detail")).toContainText("You felt Neutral");
    await expect(page.getByTestId("mood-balance")).toHaveText("75%");
    await expect(page.getByTestId("mood-streak")).toHaveText("2");

    // Server truth and the dashboard card.
    const stored = await memberApi<{ entries: { mood: string; note: string }[]; stats: { balance_score: number; day_streak: number } }>(page, `/api/v1/members/me/mood?today=${await page.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; })}`);
    expect(stored.entries.map((e) => e.mood)).toEqual(["calm", "neutral"]);
    expect(stored.stats.balance_score).toBe(75);
    await open(page, "/app");
    await expect(page.getByTestId("mood-card")).toContainText("Calm");
    await expect(page.getByTestId("mood-card")).not.toContainText("not logged yet");

    // Remove yesterday's entry → streak 1, Balance 100.
    await open(page, "/app/mood");
    if (await page.locator(`.cal-day[data-date="${yesterday}"]`).count() === 0) await page.getByRole("button", { name: "Previous month" }).click();
    await page.locator(`.cal-day[data-date="${yesterday}"]`).click();
    await page.getByRole("button", { name: "Remove" }).click();
    await expect(page.getByTestId("mood-day-detail")).toContainText("Nothing logged for this day");
    await expect(page.getByTestId("mood-balance")).toHaveText("100%");
  });

  test("food diary: add, edit and remove meals; the day reloads from the server; no invented nutrition figures", async ({ page }) => {
    await open(page, "/app/food-diary");
    await expect(page.getByText("No entries for the day")).toBeVisible();

    // Required time is enforced.
    await page.locator("#fdxWhat").fill("Greek yoghurt with walnuts");
    await page.getByRole("button", { name: "Add Entry" }).click();
    await expect(page.locator("#fdxErr")).toContainText("time you ate");

    await page.locator("#fdxTime").fill("07:40");
    await page.getByRole("button", { name: "Hungry", exact: true }).click();
    await page.getByRole("button", { name: "Relaxed", exact: true }).click();
    await page.locator("#fdxNotes").fill("Before the school run");
    await page.getByRole("button", { name: "Add Entry" }).click();
    const meals = page.getByTestId("diary-meals");
    await expect(meals.locator(".fdx-meal")).toHaveCount(1);
    await expect(meals).toContainText("Greek yoghurt with walnuts");
    await expect(meals).toContainText("Hungry");
    await expect(meals).toContainText("Relaxed");
    await expect(page.locator("#fdxSummary")).toContainText("1 meal logged");
    // the prototype's placeholder macro chips never appear
    await expect(page.locator(".fdx-meal-macros")).toHaveCount(0);
    await expect(page.getByText(/kcal/)).toHaveCount(0);

    await page.locator("#fdxWhat").fill("Baked salmon, broccoli and quinoa");
    await page.locator("#fdxTime").fill("19:10");
    await page.getByRole("button", { name: "Add Entry" }).click();
    await expect(meals.locator(".fdx-meal")).toHaveCount(2);
    // in time order
    await expect(meals.locator(".fdx-meal-time").first()).toHaveText("07:40");

    // Edit the first meal.
    await meals.locator(".fdx-meal").first().getByRole("button", { name: "Edit" }).click();
    await expect(page.getByRole("heading", { name: "Edit this meal" })).toBeVisible();
    await page.locator("#fdxWhat").fill("Greek yoghurt with walnuts and blueberries");
    await page.getByRole("button", { name: "Update Entry" }).click();
    await expect(meals).toContainText("blueberries");

    // Reload: the day comes back from the server, history lists it.
    await open(page, "/app/food-diary");
    await expect(meals.locator(".fdx-meal")).toHaveCount(2);
    await page.getByRole("button", { name: /^History/ }).click();
    await expect(page.locator(".fdx-hist-row")).toHaveCount(1);
    await expect(page.locator(".fdx-hist-row").first()).toContainText("2 meals");

    // Remove one.
    await meals.locator(".fdx-meal").last().getByRole("button", { name: "Remove" }).click();
    await expect(meals.locator(".fdx-meal")).toHaveCount(1);
    const stored = await memberApi<{ meals: { description: string; feelings: string[] }[] }>(page, `/api/v1/members/me/food-diary?date=${await page.locator("#fdxDate").inputValue()}`);
    expect(stored.meals).toHaveLength(1);
    expect(stored.meals[0].feelings).toEqual(["Hungry", "Relaxed"]);
  });
});
