import { expect, test, type Page } from "@playwright/test";
import { freshMember } from "../fixtures/accounts";
import { expectMemberDashboard, expectNoHorizontalOverflow, memberApi, open, signUpMember } from "../fixtures/helpers";

/* Food Choices as the approved prototype shows it (owner's choice, 14 Nov
   2026): four illustrated category cards, and for each a checklist of the
   foods the member commonly eats, the category note's "I got it", a food of
   the member's own with a required Best / Fair / Limit label, and "Save
   category choices". The lists are the prototype's (served by the API, which
   takes them from build/dashboard.html); what the member does is kept on the
   server — the prototype kept it in the browser — so it survives a reload and
   belongs to the member's account. */

type Checklist = {
  selections: Record<string, string[]>;
  custom: Record<string, { name: string; tier: string; status: string }[]>;
  gotit: Record<string, boolean>;
};
const CHECKLIST = "/api/v1/members/me/food-choices/checklist";

const row = (page: Page, name: string) => page.locator("#fcFoodGrid .fc-food-row", { has: page.locator(".fc-food-label", { hasText: new RegExp(`^${name.replace(/[()]/g, "\\$&")}$`) }) });

async function openCategory(page: Page, key: string, title: string) {
  await page.locator(`[data-cat-cta="${key}"]`).click();
  await expect(page.locator("#fcDetail")).toBeVisible();
  await expect(page.locator("#fcOverview")).toBeHidden();
  await expect(page.locator("#fcContentTitle")).toHaveText(new RegExp(`^${title}\\s*i$`));
}

test.describe.serial("Food Choices", () => {
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

  test("the four cards open each category's checklist, as in the prototype", async ({ page }) => {
    await open(page, "/app/food-choices");
    await expect(page.getByRole("heading", { name: "Food Choices", level: 1 })).toBeVisible();
    await expect(page.getByTestId("holding-screen")).toHaveCount(0);
    const tiles = page.locator(".fc-card-tile");
    await expect(tiles.locator("h2")).toHaveText(["Proteins", "Fats", "Favorable Carbohydrates", "Unfavorable Carbohydrates"]);
    await expect(tiles.locator(".fc-tile-cta")).toHaveText(["Choose your Proteins", "Choose your Fats", "Choose your Carbs", "Choose your Carbs"]);
    // The prototype's illustrations, loaded rather than broken.
    for (const image of await tiles.locator("img").all()) {
      await expect.poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    }
    // The meal builder is not on this screen any more.
    await expect(page.getByRole("tab", { name: "Build a meal" })).toHaveCount(0);

    await openCategory(page, "proteins", "Proteins");
    await expect(page.locator("#fcInfoText")).toContainText("Proteins help preserve lean mass");
    await expect(page.locator("#fcFoodGrid .fc-food-row")).toHaveCount(32);
    await expect(row(page, "Egg whites").locator(".fc-food-tag")).toHaveText("Best");
    await expect(row(page, "Whole eggs").locator(".fc-food-tag")).toHaveText("Fair");
    await expect(row(page, "Salami").locator(".fc-food-tag")).toHaveText("Limit");

    // The tier note opens and closes from the "i".
    await expect(page.locator("#fcTierInfoPanel")).toBeHidden();
    await page.locator("#fcTierInfoBtn").click();
    await expect(page.locator("#fcTierInfoPanel")).toContainText("BEST protein choices are low in fat");
    await expect(page.locator("#fcTierInfoBtn")).toHaveAttribute("aria-expanded", "true");
    await page.locator("#fcTierInfoBtn").click();
    await expect(page.locator("#fcTierInfoPanel")).toBeHidden();

    await page.getByRole("button", { name: "Back to Food Choices" }).click();
    await expect(page.locator("#fcOverview")).toBeVisible();
    await expect(page.locator("#fcDetail")).toBeHidden();

    await openCategory(page, "fats", "Fats");
    await expect(page.locator("#fcFoodGrid .fc-food-row")).toHaveCount(30);
    await expect(row(page, "Trans fats").locator(".fc-food-tag")).toHaveText("Avoid");
    await page.getByRole("button", { name: "Back to Food Choices" }).click();
    await page.locator('[data-cat-cta="favorable_carbs"]').click();
    await expect(page.locator("#fcContentTitle")).toHaveText(/^Favorable Carbohydrates\s*i$/);
    await expect(row(page, "Spinach").locator(".fc-food-tag")).toHaveText("★★★");
    await expect(row(page, "Kale").locator(".fc-food-tag")).toHaveText("★★");
  });

  test("ticks, I got it and a food of the member's own are kept on the server", async ({ page }) => {
    await open(page, "/app/food-choices");
    await openCategory(page, "proteins", "Proteins");

    await row(page, "Fish").click();
    await row(page, "Egg whites").click();
    await expect(row(page, "Fish")).toHaveClass(/checked/);
    await expect(row(page, "Fish")).toHaveAttribute("aria-checked", "true");
    await page.getByRole("button", { name: "I got it" }).click();
    await expect(page.locator("#fcGotIt")).toHaveText("Got it ✓");
    await expect(page.locator("#fcGotIt")).toHaveClass(/done/);

    // The label is required, as the client asked (Functional Edits 260825).
    await page.locator("#fcCustomInput").fill("Bison burger");
    await page.locator("#fcCustomAdd").click();
    await expect(page.locator("#fcCustomHint")).toBeVisible();
    await expect(page.locator("#fcCustomList .fc-custom-chip")).toHaveCount(0);
    await page.locator('.fc-tier-btn[data-fc-tier="fair"]').click();
    await expect(page.locator("#fcCustomHint")).toBeHidden();
    await expect(page.locator('.fc-tier-btn[data-fc-tier="fair"]')).toHaveClass(/selected/);
    await page.locator("#fcCustomAdd").click();
    const chip = page.locator("#fcCustomList .fc-custom-chip", { hasText: "Bison burger" });
    await expect(chip).toContainText("Fair");
    await expect(chip.locator(".fc-pending")).toHaveText("Pending Review");
    await expect(page.locator("#fcCustomNote")).toHaveText("“Bison burger” was added to your list and is ready to use.");
    // The prototype's note said a reviewer would see it; nothing here does, so the app does not say so.
    await expect(page.locator("#fcCustomNote")).not.toContainText("review");
    await expect(page.locator("#fcCustomInput")).toHaveValue("");
    await expect(page.locator(".fc-tier-btn.selected")).toHaveCount(0);

    await page.getByRole("button", { name: "Save category choices" }).click();
    await expect(page.locator("#fcSave")).toHaveText("Saved ✓");
    await expect(page.locator("#fcSave")).toHaveText("Save category choices");

    // On the server, not in the browser.
    const saved = await memberApi<Checklist>(page, CHECKLIST);
    expect(saved.selections.proteins.sort()).toEqual(["Egg whites", "Fish"]);
    expect(saved.gotit.proteins).toBe(true);
    expect(saved.custom.proteins).toEqual([{ name: "Bison burger", tier: "fair", status: "pending" }]);
    expect(await page.evaluate(() => window.localStorage.getItem("veye_food_choices"))).toBeNull();

    await page.reload();
    await openCategory(page, "proteins", "Proteins");
    await expect(row(page, "Fish")).toHaveClass(/checked/);
    await expect(row(page, "Egg whites")).toHaveClass(/checked/);
    await expect(row(page, "Salami")).not.toHaveClass(/checked/);
    await expect(page.locator("#fcGotIt")).toHaveText("Got it ✓");
    await expect(page.locator("#fcCustomList .fc-custom-chip", { hasText: "Bison burger" })).toContainText("Pending Review");
  });

  test("unticking and removing are saved too, and each category keeps its own foods", async ({ page }) => {
    await open(page, "/app/food-choices");
    await openCategory(page, "proteins", "Proteins");
    await row(page, "Fish").click();
    await expect(row(page, "Fish")).not.toHaveClass(/checked/);
    await page.getByRole("button", { name: "Remove Bison burger" }).click();
    await expect(page.locator("#fcCustomList .fc-custom-chip")).toHaveCount(0);
    await page.getByRole("button", { name: "Got it ✓" }).click();
    await expect(page.locator("#fcGotIt")).toHaveText("I got it");

    // Enter adds, as in the prototype; the food belongs to the open category.
    await page.getByRole("button", { name: "Back to Food Choices" }).click();
    await openCategory(page, "fats", "Fats");
    await page.locator('.fc-tier-btn[data-fc-tier="limit"]').click();
    await page.locator("#fcCustomInput").fill("Ghee");
    await page.locator("#fcCustomInput").press("Enter");
    await expect(page.locator("#fcCustomList .fc-custom-chip", { hasText: "Ghee" })).toContainText("Limit");
    await page.getByRole("button", { name: "Back to Food Choices" }).click();
    await openCategory(page, "proteins", "Proteins");
    await expect(page.locator("#fcCustomList .fc-custom-chip")).toHaveCount(0);

    await expect.poll(async () => {
      const saved = await memberApi<Checklist>(page, CHECKLIST);
      return JSON.stringify([saved.selections.proteins, saved.custom.proteins, saved.gotit.proteins, saved.custom.fats]);
    }).toBe(JSON.stringify([["Egg whites"], [], false, [{ name: "Ghee", tier: "limit", status: "pending" }]]));

    await page.reload();
    await openCategory(page, "proteins", "Proteins");
    await expect(row(page, "Fish")).not.toHaveClass(/checked/);
    await expect(row(page, "Egg whites")).toHaveClass(/checked/);
    await expect(page.locator("#fcGotIt")).toHaveText("I got it");
  });

  test("a food row is a checkbox a keyboard can tick", async ({ page }) => {
    await open(page, "/app/food-choices");
    await openCategory(page, "fats", "Fats");
    const olives = page.getByRole("checkbox", { name: /^Olives/ });
    await olives.focus();
    await page.keyboard.press("Space");
    await expect(olives).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Space");
    await expect(olives).toHaveAttribute("aria-checked", "false");
  });

  test("a save that fails is said, and Save sends it again", async ({ page }) => {
    await open(page, "/app/food-choices");
    await openCategory(page, "fats", "Fats");
    await page.route("**/food-choices/checklist", async (route) => {
      if (route.request().method() === "PUT") return route.fulfill({ status: 503, contentType: "application/json", body: '{"detail":"Service unavailable."}' });
      return route.fallback();
    });
    await row(page, "Avocado").click();
    await expect(page.locator("#veyeToast")).toHaveText("Your food choices could not be saved. Please try again.");
    await page.unroute("**/food-choices/checklist");
    await page.getByRole("button", { name: "Save category choices" }).click();
    await expect(page.locator("#fcSave")).toHaveText("Saved ✓");
    const saved = await memberApi<Checklist>(page, CHECKLIST);
    expect(saved.selections.fats).toContain("Avocado");
  });

  test("the checklist fits a phone", async ({ page }) => {
    // responsive.spec.ts sweeps the page as it first loads; the checklist is
    // reached by a click, so it is measured here.
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, "/app/food-choices");
    await expectNoHorizontalOverflow(page);
    await openCategory(page, "favorable_carbs", "Favorable Carbohydrates");
    await expect(page.locator("#fcFoodGrid .fc-food-row")).toHaveCount(50);
    await expectNoHorizontalOverflow(page);
  });
});
