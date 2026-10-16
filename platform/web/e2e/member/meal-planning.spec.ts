import { expect, test, type Page } from "@playwright/test";
import { freshMember } from "../fixtures/accounts";
import { expectMemberDashboard, memberApi, memberSignIn, open, signUpMember } from "../fixtures/helpers";

/* Meal Planning as the approved prototype runs it (build/dashboard.html,
   #view-your-days and its three dialogs), on the member's account: the empty
   state, Create a day, the client's sample days, Assign to date / Use today,
   View/Edit (which clears the assignment, as the prototype does), Duplicate,
   Delete, the Companion planning that is honestly in development, the
   dialogs' keyboard behaviour, and everything surviving a reload. */

function localKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

async function card(page: Page, name: string) {
  return page.locator(".day-card").filter({ has: page.getByRole("heading", { name, exact: true }) });
}

test.describe.serial("Meal Planning", () => {
  const member = freshMember("e2e");

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await signUpMember(page, member);
    await page.close();
  });

  test.beforeEach(async ({ page }) => {
    await memberSignIn(page, member.email, member.password);
    await expectMemberDashboard(page);
  });

  test("empty state, create a day, validation, sample days and the Companion stays in development", async ({ page }) => {
    await open(page, "/app/meal-planning");
    await expect(page.getByRole("heading", { name: "Meal Planning", level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Create your first day" })).toBeVisible();
    await expect(page.locator("#daysListTitle")).toBeHidden();
    // the prototype's Teachers type: it has no 700 face, so its bold buttons render at 600
    await expect(page.locator("#daysCreateBtn")).toHaveCSS("font-weight", "600");

    // The Companion planning is in development: an honest notice, nothing generated.
    await page.locator("#daysBotBtn").click();
    await expect(page.locator("#veyeToast")).toHaveText("Personalised planning with the Veye Companion is in development — coming in a later phase.");

    // Create a day: the dialog opens with the default meals and focus in "Day name".
    await page.locator("#daysCreateBtn").click();
    const dialog = page.locator("#dayModal");
    await expect(dialog).toHaveClass(/open/);
    await expect(page.locator("#dayModalTitle")).toHaveText("Create a day");
    await expect(page.locator("#dayName")).toBeFocused();
    await expect(page.locator("#dayMealsList .day-meal-row")).toHaveCount(3);

    // An unnamed day is refused with the prototype's message.
    const messages: string[] = [];
    page.on("dialog", (d) => { messages.push(d.message()); void d.accept(); });
    await page.locator("#daySaveBtn").click();
    await expect.poll(() => messages).toContain("Please give this day a name.");

    // AI-assisted is "In development": it shows the guided prompts instead of "Describe your day".
    await page.locator('.day-mode-opt[data-mode="ai"]').click();
    await expect(page.locator("#dayAiTips")).toBeVisible();
    await expect(page.locator("#dayDescribeField")).toBeHidden();
    await page.locator('.day-mode-opt[data-mode="manual"]').click();
    await expect(page.locator("#dayDescribeField")).toBeVisible();

    await page.locator("#dayName").fill("Regular work day");
    await page.locator("#dayNotes").fill("Office days");
    await page.locator("#daySaveBtn").click();
    await expect(dialog).not.toHaveClass(/open/);
    await expect(page.locator("#veyeToast")).toHaveText("Day created");
    const regular = await card(page, "Regular work day");
    await expect(regular.locator(".day-status")).toHaveText("Not assigned");
    await expect(regular.locator(".day-summary")).toHaveText("3 meals — Breakfast 07:00, Lunch 12:30, Dinner 18:30");
    await expect(page.locator("#daysListTitle")).toBeVisible();
    await expect(page.locator("#daysEmpty")).toBeHidden();

    // A sample day with two options: type -> option -> preview -> copy.
    await page.locator("#daysSampleBtn").click();
    await expect(page.locator("#sampleModal")).toHaveClass(/open/);
    await page.locator('#sampleTypeGrid [data-sample-type="4"]').click();
    await expect(page.locator("#sampleOptionSub")).toHaveText("Weekend day with morning exercise has 2 options.");
    await page.locator('#sampleOptionGrid [data-sample-opt="1"]').click();
    await expect(page.locator("#samplePreviewTitle")).toHaveText("Weekend day with morning exercise — Option 2");
    await expect(page.locator("#sampleSchedule li").first()).toContainText("7:00 AM");
    await page.locator("#sampleCopyBtn").click();
    await expect(page.locator("#veyeToast")).toHaveText("Sample day copied — open View/Edit to make it yours");
    const sample = await card(page, "Weekend day with morning exercise — Option 2");
    await expect(sample.locator(".day-notes")).toHaveText("Veye sample day — change the times and the foods as desired.");
    // newest first
    await expect(page.locator(".day-card h4").first()).toHaveText("Weekend day with morning exercise — Option 2");
  });

  test("assign, use today, edit clears the assignment, duplicate, delete; Escape returns focus; all persists", async ({ page }) => {
    await open(page, "/app/meal-planning");
    const regular = await card(page, "Regular work day");
    await expect(regular).toBeVisible();

    // Assign to date.
    await regular.getByRole("button", { name: "Assign to date" }).click();
    await expect(page.locator("#assignTitle")).toHaveText("Assign to date: Regular work day");
    await expect(page.locator("#assignDate")).toBeFocused();
    await page.locator("#assignDate").fill("2026-11-02");
    await page.locator("#assignConfirm").click();
    await expect(page.locator("#veyeToast")).toHaveText("Day assigned to 2026-11-02");
    await expect(regular.locator(".day-status")).toHaveText("Assigned on 2026-11-02");
    await expect(regular.getByRole("button", { name: "Assign to date" })).toBeFocused();   // focus lands back on the card

    // Use today.
    const sample = await card(page, "Weekend day with morning exercise — Option 2");
    await sample.getByRole("button", { name: "Use today" }).click();
    await expect(sample.locator(".day-status")).toHaveText(`Assigned on ${localKey()}`);

    // Escape closes only the dialog and returns focus to its opener.
    const edit = regular.getByRole("button", { name: "View or edit Regular work day" });
    await edit.click();
    await expect(page.locator("#dayModalTitle")).toHaveText("Edit day");
    await expect(page.locator("#daySaveBtn")).toHaveText("Save changes");
    await expect(page.locator("#dayName")).toHaveValue("Regular work day");
    await page.keyboard.press("Escape");
    await expect(page.locator("#dayModal")).not.toHaveClass(/open/);
    await expect(edit).toBeFocused();

    // View/Edit: add a meal and save — the prototype clears the assignment on save.
    await edit.click();
    await page.locator("#dayAddMeal").click();
    const added = page.locator("#dayMealsList .day-meal-row").last();
    await expect(added.locator(".dm-type")).toHaveValue("Snack");
    await added.locator(".dm-name").fill("Afternoon snack");
    await added.locator(".dm-time").fill("15:30");
    await page.locator("#daySaveBtn").click();
    await expect(page.locator("#veyeToast")).toHaveText("Day updated");
    await expect(regular.locator(".day-status")).toHaveText("Not assigned");
    await expect(regular.locator(".day-summary")).toHaveText("4 meals — Breakfast 07:00, Lunch 12:30, Afternoon snack 15:30, Dinner 18:30");

    // Duplicate, then delete the copy (confirmed).
    await regular.getByRole("button", { name: "Duplicate" }).click();
    await expect(page.locator("#veyeToast")).toHaveText("Template duplicated");
    const copy = await card(page, "Regular work day (copy)");
    await expect(copy.locator(".day-status")).toHaveText("Not assigned");
    page.once("dialog", (d) => { expect(d.message()).toBe("Delete this day?"); void d.accept(); });
    await copy.getByRole("button", { name: "Delete" }).click();
    await expect(copy).toHaveCount(0);

    // Everything is on the server: a reload and the API agree.
    await open(page, "/app/meal-planning");
    await expect(page.locator(".day-card")).toHaveCount(2);
    const stored = await memberApi<{ days: { name: string; assigned_date: string | null }[] }>(page, "/api/v1/members/me/meal-plans/days");
    expect(stored.days.map((d) => [d.name, d.assigned_date])).toEqual([
      ["Weekend day with morning exercise — Option 2", localKey()],
      ["Regular work day", null],
    ]);

    // Continue to Food Diary goes to the diary.
    await page.locator("#daysContinue").click();
    await expect(page).toHaveURL(/\/app\/food-diary$/);
    await expect(page.getByRole("heading", { name: "Food Diary" })).toBeVisible();
  });
});
