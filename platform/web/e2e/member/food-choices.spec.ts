import { expect, test } from "@playwright/test";
import { freshMember } from "../fixtures/accounts";
import { expectMemberDashboard, expectNoHorizontalOverflow, open, signUpMember } from "../fixtures/helpers";

/* Food Choices as a member uses it: the HOW TO meal builder asks one thing at
   a time in the client's order, states the clock times it works out, refuses a
   food from the wrong list, and keeps the finished day across a reload. Then
   the four checklists, where a food the member writes in is kept as they wrote
   it and gains no tier or amount.

   The figures asserted here are the client's own, from `AI Chatbot Training.docx`:
   an hour after waking (p0287), five hours to the next meal (p0300), the
   per-food portions (p0497-p0534), and bedtime within four hours of a meal
   ending the day (p0316). */

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

  test("the section is a working screen, not a holding screen", async ({ page }) => {
    await open(page, "/app/food-choices");
    await expect(page.getByRole("heading", { name: "Food Choices", level: 1 })).toBeVisible();
    await expect(page.getByTestId("holding-screen")).toHaveCount(0);
    await expect(page.getByRole("tab", { name: "Build a meal" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "My food lists" })).toBeVisible();
  });

  test("the HOW TO builds a day one question at a time and does the arithmetic", async ({ page }) => {
    await open(page, "/app/food-choices");

    // The lists give amounts for a woman and for a man, so the plan asks.
    await page.getByRole("button", { name: "Woman", exact: true }).click();
    await page.getByRole("button", { name: "Start" }).click();

    // p0285: the first question is what time they get up.
    await expect(page.getByTestId("fc-ask")).toContainText("What time do you get up");
    await page.locator("#fcx-time").fill("07:00");
    await page.getByRole("button", { name: "Continue" }).click();

    // p0287/p0289: the eating time is stated before anything else is asked.
    await expect(page.getByTestId("fc-notes")).toContainText("8:00 am");
    await expect(page.getByTestId("fc-notes")).toContainText("within an hour of getting up");
    await expect(page.getByTestId("fc-ask")).toContainText("snack");

    await page.getByRole("button", { name: "A meal (5 hours)" }).click();

    // p0267/p0277: protein first, on its own, and the legume warning is said.
    await expect(page.getByTestId("fc-ask")).toContainText("What protein");
    await expect(page.getByTestId("fc-notes")).toContainText("not proteins");

    // p0255: a legume offered as the protein is refused, with the reason.
    await page.getByRole("button", { name: "Fish", exact: true }).click();
    await page.getByRole("button", { name: "Continue" }).click();

    // p0271: carbohydrate next.
    await expect(page.getByTestId("fc-ask")).toContainText("carbohydrate");
    await expect(page.getByTestId("fc-notes")).toContainText("Whole grains");
    await page.getByRole("button", { name: "Broccoli", exact: true }).click();
    await page.getByRole("button", { name: "Chickpeas", exact: true }).click();
    await page.getByRole("button", { name: "Continue" }).click();

    // p0275: fat last.
    await expect(page.getByTestId("fc-ask")).toContainText("fat");
    await page.getByRole("button", { name: "Olives", exact: true }).click();
    await page.getByRole("button", { name: "Continue" }).click();

    // p0279: the recap, with each amount as the source states it.
    const recap = page.getByTestId("fc-recap");
    await expect(recap).toContainText("Fish - 5oz");
    await expect(recap).toContainText("Broccoli - unlimited raw or cooked");
    await expect(recap).toContainText("Chickpeas - 1 cup per meal");
    await expect(recap).toContainText("Olives - 9 olives");
    // p0298/p0300: five hours on from an 8am meal.
    await expect(page.getByTestId("fc-notes")).toContainText("1:00 pm");
    await expect(page.getByTestId("fc-day")).toContainText("8:00 am");

    await page.getByRole("button", { name: "Yes, that is right" }).click();
    await page.getByRole("button", { name: "That is everything" }).click();

    // p0316: bedtime within four hours of the meal ends the day.
    await expect(page.getByTestId("fc-ask")).toContainText("What time do you go to bed");
    await page.locator("#fcx-time").fill("11:00");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByTestId("fc-done")).toContainText("within 4 hours");

    // It lives on the server, so a reload shows the same day.
    await page.reload();
    await expect(page.getByTestId("fc-day")).toContainText("8:00 am");
    await expect(page.getByTestId("fc-done")).toContainText("within 4 hours");
    await expect(page.getByRole("button", { name: "Plan another day" })).toBeVisible();
  });

  test("a food from the wrong list is refused with the reason, not silently dropped", async ({ page }) => {
    await open(page, "/app/food-choices");
    await page.getByRole("button", { name: /Plan another day|Start again/ }).click();

    await page.getByRole("button", { name: "Woman", exact: true }).click();
    await page.getByRole("button", { name: "Start" }).click();
    await page.locator("#fcx-time").fill("06:30");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "A snack (2 hours)" }).click();

    // Lentils are a carbohydrate on the client's lists (p0255, p0269).
    await page.locator("#fcx-other").fill("Lentils");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByTestId("fc-ask")).toContainText("What protein");
    await expect(page.getByTestId("fc-notes")).toContainText("not proteins");

    // A snack portion is half a meal portion, said rather than computed (p0463).
    await page.getByRole("button", { name: "Fish", exact: true }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByTestId("fc-recap")).toContainText("Fish - half of 5oz");
    // p0308: a 6:30 start means eating at 7:30, and a snack is two hours.
    await page.getByRole("button", { name: "Broccoli", exact: true }).click();
    await page.getByRole("button", { name: "Chickpeas", exact: true }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Olives", exact: true }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByTestId("fc-day")).toContainText("7:30 am");
    await expect(page.getByTestId("fc-notes")).toContainText("9:30 am");
  });

  test("cheese as the protein is never asked for a fat", async ({ page }) => {
    await open(page, "/app/food-choices");
    await page.getByRole("button", { name: /Plan another day|Start again/ }).click();

    await page.getByRole("button", { name: "Man", exact: true }).click();
    await page.getByRole("button", { name: "Start" }).click();
    await page.locator("#fcx-time").fill("07:00");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "A meal (5 hours)" }).click();

    await page.locator("#fcx-other").fill("Hard cheese or full fat cheese");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Spinach", exact: true }).click();
    await page.getByRole("button", { name: "Lentils", exact: true }).click();
    await page.getByRole("button", { name: "Continue" }).click();

    // p0283: straight to the recap, and the reason is stated.
    await expect(page.getByTestId("fc-ask")).toContainText("Is that ok");
    await expect(page.getByTestId("fc-notes")).toContainText("already contains fat");
    await expect(page.getByTestId("fc-recap")).toContainText("Hard cheese or full fat cheese - 6 oz");
  });

  test("the food lists carry the client's amounts, and a write-in gains nothing", async ({ page }) => {
    await open(page, "/app/food-choices");
    await page.getByRole("tab", { name: "My food lists" }).click();
    // The screen remembers who the last plan was for, so say which is wanted
    // here rather than leaning on the order these tests happen to run in.
    await page.locator("#fcx-sex").selectOption("woman");
    await page.locator("#fcx-occasion").selectOption("meal");

    // The tiers and amounts are the client's, fetched rather than retyped.
    await expect(page.getByText("Super Favorable", { exact: false }).first()).toBeVisible();
    await expect(page.locator(".fcx-food", { hasText: "Fish" }).first()).toContainText("5oz");
    // A food the source gives no amount for says so instead of inventing one.
    await expect(page.locator(".fcx-food", { hasText: "Lemon" }).first()).toContainText("no amount given");

    await page.locator(".fcx-food", { hasText: "Fish" }).first().click();
    const writeIn = page.locator(".fcx-tier", { hasText: "Best choices" }).locator(".fcx-input--inline").first();
    await writeIn.fill("my grandmother's lentil stew");
    await writeIn.press("Enter");
    await page.getByRole("button", { name: "Save my lists" }).click();

    await page.reload();
    await page.getByRole("tab", { name: "My food lists" }).click();
    await expect(page.locator(".fcx-food.is-on", { hasText: "Fish" }).first()).toBeVisible();
    // One chip, in one section: the write-in key names the group as well as
    // the tier, because "best" is a tier on the fat list too.
    await expect(page.locator(".fcx-writein", { hasText: "lentil stew" })).toHaveCount(1);
    // The write-in is the member's words and carries no tier or amount.
    await expect(page.locator(".fcx-writein", { hasText: "lentil stew" })).not.toContainText("cup");
  });

  test("the lists tab fits a phone", async ({ page }) => {
    // responsive.spec.ts sweeps the page as it first loads; the lists tab is
    // the dense half and is only reached by a click, so it is measured here.
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, "/app/food-choices");
    await page.getByRole("tab", { name: "My food lists" }).click();
    await expect(page.locator(".fcx-foods").first()).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test("the amounts change with who they are for", async ({ page }) => {
    await open(page, "/app/food-choices");
    await page.getByRole("tab", { name: "My food lists" }).click();
    await page.locator("#fcx-sex").selectOption("woman");
    await expect(page.locator(".fcx-food", { hasText: "Fish" }).first()).toContainText("5oz");
    await page.locator("#fcx-sex").selectOption("man");
    await expect(page.locator(".fcx-food", { hasText: "Fish" }).first()).toContainText("7oz");
    await page.locator("#fcx-occasion").selectOption("snack");
    await expect(page.locator(".fcx-food", { hasText: "Fish" }).first()).toContainText("half of 7oz");
  });
});
