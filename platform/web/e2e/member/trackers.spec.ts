import { expect, test, type Page } from "@playwright/test";
import { freshMember } from "../fixtures/accounts";
import { expectMemberDashboard, open } from "../fixtures/helpers";

/* One fresh member walks every production tracker through the real screens:
   Health Number (onboarding questionnaire), Body Composition, Blood Markers,
   Health Assessment and Simple Quiz. The API's stored history is the oracle
   for what was saved, and the product rule that the Simple Quiz never
   changes the Health Number is asserted directly. */

const member = freshMember("trackers");

async function signUp(page: Page) {
  await open(page, "/signup");
  await page.getByLabel("First name").fill(member.firstName);
  await page.getByLabel("Last name").fill(member.lastName);
  await page.getByLabel("Email", { exact: true }).fill(member.email);
  await page.getByPlaceholder("Enter your password").fill(member.password);
  await page.getByPlaceholder("Confirm your password").fill(member.password);
  await page.getByRole("button", { name: "Sign Up" }).click();
  await expect(page).toHaveURL(/\/(app|onboarding)/);
}

async function history(page: Page, tracker: string) {
  const api = process.env.E2E_API_URL ?? "http://localhost:8001";
  return page.evaluate(async ({ api, tracker }) => {
    const response = await fetch(`${api}/api/v1/members/me/${tracker}`, { credentials: "include" });
    return response.json();
  }, { api, tracker });
}

test.describe.serial("Member trackers", () => {
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await signUp(page);
    await page.close();
  });

  test.beforeEach(async ({ page }) => {
    await open(page, "/login");
    await page.getByLabel("Your Email").fill(member.email);
    await page.getByPlaceholder("Your Password").fill(member.password);
    await page.getByRole("button", { name: "Login" }).click();
    await expect(page).toHaveURL(/\/(app|onboarding)/);
  });

  test("Health Number — the 12-question onboarding stores a result for a signed-in member", async ({ page }) => {
    await open(page, "/onboarding");
    const next = page.getByRole("button", { name: /^Next$/ });
    // goals (checkbox)
    await page.getByRole("button", { name: "Live a Healthier Lifestyle" }).click();
    await next.click();
    // plans (checkbox, exclusive "No other plans")
    await page.getByRole("button", { name: "No other plans" }).click();
    await next.click();
    // activity (radio)
    await page.getByRole("button", { name: /Moderate/ }).click();
    await next.click();
    // four yes/no screens: meditate yes, tired no, gainWeight no, abdomen no
    for (const answer of ["Yes", "No", "No", "No"]) {
      await page.locator(".quiz__options--yn").getByRole("button", { name: answer, exact: true }).click();
      await next.click();
    }
    // sleep: enough yes, well yes, 7 hours
    await page.locator('[data-sleep="enough"]').getByRole("button", { name: "Yes", exact: true }).click();
    await page.locator('[data-sleep="well"]').getByRole("button", { name: "Yes", exact: true }).click();
    await page.getByLabel("Hours of sleep per night").fill("7");
    await next.click();
    // diet, source (radio + other)
    await page.getByRole("button", { name: "No preference" }).click();
    await next.click();
    await page.getByRole("button", { name: "Friends or Family" }).click();
    await next.click();

    await expect(page.getByRole("heading", { name: "Your Health Number" })).toBeVisible();
    await expect(page.locator(".result__ring b")).toHaveText(/^\d+(\.\d)?$/);
    await page.getByRole("link", { name: "Go to dashboard" }).click();
    await expectMemberDashboard(page);

    const saved = await history(page, "health-number");
    expect(saved.history).toHaveLength(1);
    expect(saved.latest.calculation_version).toBeTruthy();
  });

  test("Body Composition — measurements are saved and the result comes from the API", async ({ page }) => {
    await open(page, "/app/progress/body-composition");
    // The figure keeps to its box: where it did not, it lay over the buttons above it.
    const figure = page.locator(".bmi-figure-img");
    await expect.poll(async () => (await figure.evaluate((img: HTMLImageElement) => img.complete)) && (await figure.boundingBox())!.height).toBeGreaterThan(300);
    expect((await figure.boundingBox())!.height).toBeLessThanOrEqual(460.5);
    await page.getByRole("button", { name: "Man", exact: true }).click();
    await page.locator("#bmi_weight").fill("178");
    await page.locator("#bmi_waist").fill("34");
    await page.locator("#bmi_height").fill("70");
    await page.locator("#bmi_fourth").fill("7");
    await page.getByRole("button", { name: "Save Measurements" }).click();
    await expect(page.getByText(/calculation version/)).toBeVisible();
    const saved = await history(page, "body-composition");
    expect(saved.history).toHaveLength(1);
    expect(saved.latest.bmi).toBeGreaterThan(20);
  });

  test("Blood Markers — a lab entry is saved with server-calculated ratios", async ({ page }) => {
    await open(page, "/app/progress/blood-markers");
    await page.getByRole("tab", { name: "New entry" }).click();
    await page.locator("#lab_tg").fill("95");
    await page.locator("#lab_hdl").fill("60");
    await page.locator("#lab_insulin").fill("5");
    await page.locator("#lab_glucose").fill("85");
    await page.locator("#lab_hba1c").fill("5.0");
    // the server preview fills the calculated TG/HDL field while typing
    await expect(page.locator("#lab_tg_hdl")).toHaveValue("1.58");
    await page.getByRole("button", { name: "Save markers" }).click();
    await expect(page.getByRole("heading", { name: "Latest entry summary" })).toBeVisible();
    const saved = await history(page, "blood-markers");
    expect(saved.history).toHaveLength(1);
    expect(saved.latest.tg_hdl).toBeCloseTo(1.58, 2);
  });

  test("Health Assessment — 11 answers produce the stored band, wording and EPA/DHA suggestion; retake adds history", async ({ page }) => {
    await open(page, "/app/progress/health-assessment");
    await expect(page.getByRole("heading", { name: "Health Assessment" })).toBeVisible();
    const rows = page.locator(".assess-row");
    await expect(rows).toHaveCount(11);
    // every middle choice → total 22 → Moderate Inflammation → 7.5g
    for (let i = 0; i < 11; i++) await rows.nth(i).locator(".assess-opt").nth(1).click();
    await expect(page.locator("#assessCounter")).toHaveText("11 / 11 answered");
    await page.getByRole("button", { name: "Submit Assessment" }).click();
    await expect(page.locator("#assessResultScore")).toHaveText("22 / 33");
    await expect(page.locator("#assessResultStatus")).toHaveText("Moderate Inflammation");
    await expect(page.locator("#assessRecEpa")).toHaveText("7.5g");
    await expect(page.locator("#assessResultDesc")).toContainText("On a scale of 11 to 33");

    // Retake with every first (healthiest) choice → 11 → Very Low Inflammation → 2.5g
    await page.getByRole("button", { name: "Re-take" }).click();
    for (let i = 0; i < 11; i++) await page.locator(".assess-row").nth(i).locator(".assess-opt").nth(0).click();
    await page.getByRole("button", { name: "Submit Assessment" }).click();
    await expect(page.locator("#assessResultScore")).toHaveText("11 / 33");
    await expect(page.locator("#assessRecEpa")).toHaveText("2.5g");
    await expect(page.getByRole("heading", { name: "Previous Assessments" })).toBeVisible();
    await expect(page.locator("#assessHistoryList .history-item")).toHaveCount(2);

    const saved = await history(page, "health-assessment");
    expect(saved.history.map((h: { total: number }) => h.total)).toEqual([11, 22]);
    expect(saved.latest.calculation_version).toBe("health-assessment-2026-08-25-v2");
  });

  test("Simple Quiz — the count is saved, history keeps each day's answers, and the Health Number is untouched", async ({ page }) => {
    const before = await history(page, "health-number");
    await open(page, "/app/progress/simple-quiz");
    await expect(page.getByRole("heading", { name: "Simple Quiz" })).toBeVisible();
    const rows = page.locator(".quiz-row");
    await expect(rows).toHaveCount(8);
    for (let i = 0; i < 8; i++) await rows.nth(i).getByRole("button", { name: i < 2 ? "Yes" : "No", exact: true }).click();
    await expect(page.locator("#simpleCounter")).toHaveText("6 No / 2 Yes");
    await page.getByRole("button", { name: "Submit Quiz" }).click();
    await expect(page.locator("#simpleResultScore")).toHaveText("6 No / 2 Yes");
    // a count and nothing more: no status chip, no recommendation block
    await expect(page.locator("#simpleResultStatus")).toHaveCount(0);
    await expect(page.getByText("Supplement Recommendation")).toHaveCount(0);

    await page.getByRole("button", { name: "Re-take quiz" }).click();
    for (let i = 0; i < 8; i++) await page.locator(".quiz-row").nth(i).getByRole("button", { name: "No", exact: true }).click();
    await page.getByRole("button", { name: "Submit Quiz" }).click();
    await expect(page.locator("#simpleResultScore")).toHaveText("8 No / 0 Yes");
    await expect(page.locator("#simpleHistoryList .history-item")).toHaveCount(2);
    await page.locator("#simpleHistoryList .history-row").nth(1).click();
    await expect(page.locator("#simpleHistoryList .history-detail").nth(1)).toContainText("Are you sleepy after meals?");

    const saved = await history(page, "simple-quiz");
    expect(saved.history.map((h: { yes_count: number }) => h.yes_count)).toEqual([0, 2]);
    const after = await history(page, "health-number");
    expect(after).toEqual(before);
  });

  test("My Progress and the dashboard reflect all five trackers", async ({ page }) => {
    await open(page, "/app/progress");
    await expect(page.locator(".module-upd--none")).toHaveCount(0);
    await open(page, "/app");
    await expect(page.getByText("5/5")).toBeVisible();
    // Concept A: five cards, each instrument on its own scale, none at rest.
    const cards = page.getByTestId("tracker-cards");
    await expect(cards.locator(".tracker-card")).toHaveCount(5);
    await expect(cards.locator(".tracker-card--rest")).toHaveCount(0);
    await expect(page.getByTestId("tracker-health-assessment")).toContainText("of 33");
    // Every figure can be read as a table, not only seen.
    const quizCard = page.getByTestId("tracker-simple-quiz");
    await expect(quizCard).toContainText("8 No");
    await quizCard.getByRole("button", { name: /Show table/ }).click();
    await expect(quizCard.locator("tbody tr")).toHaveCount(2);
  });

  test("Fitness shows the published Care Studio recommendations; Supplements and Resources render their approved copy", async ({ page }) => {
    await open(page, "/app/fitness");
    await expect(page.getByRole("heading", { name: "Interested in Martial Arts and Boxing?" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Explore EYR/ })).toHaveAttribute("href", "https://withme.so/EngageYourRage");
    const frames = page.locator(".fit-rec--video iframe");
    await expect(frames).toHaveCount(2);
    await expect(frames.first()).toHaveAttribute("src", /youtube-nocookie\.com\/embed\//);

    await open(page, "/app/supplements");
    await expect(page.getByText("Veye recommends the two most important ones")).toBeVisible();
    await expect(page.getByText("EPA/DHA suggested dosage")).toBeVisible();
    // The prototype's Supplements card: two polyphenol lines (owner, 15 Nov 2026).
    const polyphenols = page.locator(".sup-card__body ul").nth(1).locator("li");
    await expect(polyphenols).toHaveText(["500mg helps reduce oxidative stress", "1000mg helps reduce inflammation"]);
    // The Vitamin Overview waits behind "Other Supplements", as in the prototype.
    const overview = page.getByRole("heading", { name: "Individual vitamin pros and cons" });
    await expect(overview).toBeHidden();
    const other = page.getByTestId("supplements-other");
    await expect(other).toHaveAttribute("aria-expanded", "false");
    await other.click();
    await expect(other).toHaveAttribute("aria-expanded", "true");
    await expect(overview).toBeVisible();
    await expect(page.locator("#supOtherPanel")).toBeFocused();
    await expect(page.locator("#supOtherPanel .sup-provisional").first()).toContainText("pending citation and clinical review");
    await expect(page.locator("#supOtherPanel strong")).toHaveText(["Vitamin D", "Vitamin B12", "Vitamin C", "Vitamin A", "Beta-carotene",
      "Vitamin E", "Zinc", "Boron", "Vitamin K", "Calcium", "Selenium"]);

    await open(page, "/app/resources");
    await expect(page.getByRole("heading", { name: "Blogs" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Coming Soon" })).toHaveCount(4);
  });
});
