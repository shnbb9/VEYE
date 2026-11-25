import { expect, test, type Page } from "@playwright/test";
import { freshMember } from "../fixtures/accounts";
import { expectMemberDashboard, memberApi, open, signUpMember } from "../fixtures/helpers";

/* The Health Number inside the dashboard, as the approved prototype draws it
   (build/dashboard.html, view quiz-health; owner's choice 14 Nov 2026): the
   dashboard and My Progress open the eleven-step wizard here instead of
   sending the member to the public onboarding quiz, the wizard goes straight
   to the result, and the result keeps the dated history and the trend note.

   The expected numbers are worked by hand from the API's tables
   (app/assessments/service.py, HealthNumbers.xlsx):
     meditate No +0.5, tired Yes +0.5, gain weight Yes +1.0, abdomen Yes +0.5,
     enough sleep No +1.5; no other plans, light activity, sleeps well and
     6 hours score 0. Tired = Yes: 4.0, Moderately Good Health, Food (3 high
     Food answers vs 2 Lifestyle). Tired = No: 3.5, Relatively Good Health. */

type History = { latest: { displayed_score: number; status: string } | null; history: { displayed_score: number }[] };
const HISTORY = "/api/v1/members/me/health-number";

const next = (page: Page) => page.locator("#wizardNext");

async function step(page: Page, label: string, title: string) {
  await expect(page.locator("#wizardProgressLabel")).toHaveText(label);
  await expect(page.locator("#wizardQuestion")).toHaveText(title);
  await expect(next(page)).toBeDisabled();
}

async function pick(page: Page, option: string) {
  await page.locator("#wizardOptions .wizard-option", { hasText: new RegExp(`^${option.replace(/[()]/g, "\\$&")}$`) }).click();
}

/** A tick box is drawn only where more than one answer may be chosen (owner,
 *  15 Nov 2026): a single-choice answer is a plain button. The box is the
 *  option's ::after, so its computed content says whether one is drawn. */
async function expectTickBoxes(page: Page, drawn: boolean) {
  const boxes = await page.locator("#wizardOptions .wizard-option").evaluateAll((options) =>
    options.map((option) => getComputedStyle(option, "::after").content !== "none" || getComputedStyle(option, "::before").content !== "none"));
  expect(boxes.length).toBeGreaterThan(0);
  expect(boxes, drawn ? "a multi-choice question ticks every option" : "a single-choice question draws no tick box").toEqual(boxes.map(() => drawn));
}

async function answerEverything(page: Page, tired: "Yes" | "No") {
  await step(page, "1/11", "What are your goals?");
  await expectTickBoxes(page, true);
  await pick(page, "Lose Body Fat");
  await next(page).click();

  await step(page, "2/11", "Have you tried other food plans?");
  await pick(page, "Keto");
  await pick(page, "No other plans");                    // stands alone (XLSX R23)
  await expect(page.locator(".wizard-option.selected")).toHaveText(["No other plans"]);
  await next(page).click();

  await step(page, "3/11", "Select your activity level");
  await expectTickBoxes(page, false);
  await pick(page, "Light (I work, I walk some)");
  await next(page).click();

  for (const [label, title, answer] of [
    ["4/11", "Do you meditate?", "No"],
    ["5/11", "Are you tired or do you have poor mental focus during the day?", tired],
    ["6/11", "Do you gain weight quickly?", "Yes"],
    ["7/11", "Is most of your excess weight (if any) around your abdomen?", "Yes"],
    ["8/11", "Do you feel you get enough sleep?", "No"],
    ["9/11", "Do you sleep well?", "Yes"],
  ] as const) {
    await step(page, label, title);
    // The prototype lists No before Yes on the retake.
    await expect(page.locator("#wizardOptions .wizard-option")).toHaveText(["No", "Yes"]);
    await expectTickBoxes(page, false);
    await pick(page, answer);
    await next(page).click();
  }

  await step(page, "10/11", "How many hours do you sleep per night?");
  await page.locator("#wizardNumericInput").fill("30");
  await expect(next(page)).toBeDisabled();               // the API takes 0-24
  await page.locator("#wizardNumericInput").fill("6");
  await next(page).click();

  await step(page, "11/11", "What is your dietary preference?");
  await expect(next(page)).toHaveText("Finish");
  await pick(page, "Other");
  await expect(page.locator("#wizardOtherInput")).toBeVisible();
  await expect(next(page)).toBeDisabled();               // Other needs its words
  await page.locator("#wizardOtherInput").fill("Fish on weekdays");
  await next(page).click();
}

test.describe.serial("the Health Number inside the dashboard", () => {
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

  test("the first take starts from the dashboard, asks eleven questions and goes straight to the result", async ({ page }) => {
    await page.getByRole("link", { name: "Take the assessment", exact: true }).click();
    await expect(page).toHaveURL(/\/app\/progress\/health-number\?from=dashboard&start=1$/);
    await expect(page.locator("#wizardStepWrap")).toBeVisible();
    await expect(page.locator("#wizardPrev")).toBeDisabled();

    // The back arrow returns to where the member came from.
    await page.locator("#healthQuizBack").click();
    await expect(page).toHaveURL(/\/app$/);
    await page.getByRole("link", { name: "Take the assessment", exact: true }).click();

    await answerEverything(page, "Yes");
    // Q12 is asked at onboarding only (client, 20 Aug 2026).
    await expect(page.getByText("How did you find out about Veye?")).toHaveCount(0);

    await expect(page.locator("#wizardResultWrap")).toBeVisible();
    await expect(page.locator("#wizardStepWrap")).toBeHidden();
    await expect(page.locator("#healthNumberValue")).toHaveText("4.0");
    await expect(page.locator("#healthResultStatus")).toHaveText("Moderately Good Health");
    await expect(page.locator("#healthResultStatus")).toHaveClass(/color-moderate/);
    await expect(page.locator("#healthResultDesc")).toContainText("your food choices are putting your health at risk");
    await expect(page.locator("#hnHistoryList .hn-history-item")).toHaveCount(1);
    await expect(page.locator("#hnTrendNote")).toHaveText("This is your first recorded result. Retake the quiz over time and your trend will appear here.");

    const saved = await memberApi<History>(page, HISTORY);
    expect(saved.history.map((item) => item.displayed_score)).toEqual([4]);
    expect(saved.latest?.status).toBe("Moderately Good Health");

    // A reload opens on the saved result, not on the wizard again.
    await expect(page).toHaveURL(/\/app\/progress\/health-number\?from=dashboard$/);
    await page.reload();
    await expect(page.locator("#wizardResultWrap")).toBeVisible();
    await expect(page.locator("#healthNumberValue")).toHaveText("4.0");
  });

  test("a retake adds a dated entry and the trend says which way it moved", async ({ page }) => {
    await open(page, "/app/progress/health-number");
    await expect(page.locator("#wizardResultWrap")).toBeVisible();
    await page.getByRole("button", { name: "Re-take quiz" }).click();
    await expect(page.locator("#wizardStepWrap")).toBeVisible();

    // Previous keeps what was answered.
    await pick(page, "Lose Body Fat");
    await next(page).click();
    await page.locator("#wizardPrev").click();
    await expect(page.locator(".wizard-option.selected")).toHaveText(["Lose Body Fat"]);
    await expect(page.locator("#wizardPrev")).toBeDisabled();
    await page.locator("#wizardOptions .wizard-option", { hasText: /^Lose Body Fat$/ }).click(); // untick, so the helper's first pick ticks it again

    await answerEverything(page, "No");
    await expect(page.locator("#healthNumberValue")).toHaveText("3.5");
    await expect(page.locator("#healthResultStatus")).toHaveText("Relatively Good Health");
    await expect(page.locator("#hnHistoryList .hn-history-num")).toHaveText(["3.5 / 10", "4.0 / 10"]);
    await expect(page.locator("#hnTrendNote")).toHaveText(
      "You are improving — congratulations. Your number moved from 4.0 to 3.5, and lower is better on this scale.");
    const saved = await memberApi<History>(page, HISTORY);
    expect(saved.history.map((item) => item.displayed_score)).toEqual([3.5, 4]);
  });

  test("My Progress and the dashboard open the same screen, never the public quiz", async ({ page }) => {
    await open(page, "/app/progress");
    const card = page.locator(".hn-card");
    await expect(card.locator(".hn-card__num")).toHaveText("3.5");
    await card.getByRole("link", { name: "History" }).click();
    await expect(page).toHaveURL(/\/app\/progress\/health-number$/);
    await expect(page.locator("#wizardResultWrap")).toBeVisible();
    // The sidebar stays on the screen the member came from, as in the prototype.
    await expect(page.locator(".sidebar-nav .nav-link.active")).toHaveAttribute("href", "/app/progress");
    await page.getByRole("button", { name: "Back to Progress" }).click();
    await expect(page).toHaveURL(/\/app\/progress$/);

    await page.locator(".hn-card").getByRole("link", { name: /Retake/ }).click();
    await expect(page).toHaveURL(/\/app\/progress\/health-number\?start=1$/);
    await expect(page.locator("#wizardProgressLabel")).toHaveText("1/11");
    await page.locator("#healthQuizBack").click();
    await expect(page).toHaveURL(/\/app\/progress$/);

    await open(page, "/app");
    await page.locator(".health-badge-block").click();
    await expect(page).toHaveURL(/\/app\/progress\/health-number\?from=dashboard$/);
    await expect(page.locator("#wizardResultWrap")).toBeVisible();
    await expect(page.locator("#healthNumberValue")).toHaveText("3.5");
    await expect(page.locator(".sidebar-nav .nav-link.active")).toHaveAttribute("href", "/app");
    await open(page, "/app");
    await expect(page.getByRole("link", { name: /Retake the assessment/ })).toHaveAttribute("href", "/app/progress/health-number?from=dashboard&start=1");
  });
});
