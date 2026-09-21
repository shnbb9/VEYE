import { expect, test } from "@playwright/test";
import { ADITYA, ADMIN } from "../fixtures/accounts";
import { adminSignIn, expectAdminHome, portalSessions, open } from "../fixtures/helpers";

/* The production admin console through its own portal: sign-in/out, Home,
   Members, Member 360, Assessments, Care Studio, Content, Insights and
   Companion → Settings → Guided Experiences. Data is the seeded local set. */

test.describe("Admin console", () => {
  test.beforeEach(async ({ page }) => {
    await adminSignIn(page, ADMIN.email, ADMIN.password);
    await expectAdminHome(page);
  });

  test("admin sign-in opens the console and sign-out ends only the admin session", async ({ page }) => {
    const sessions = await portalSessions(page);
    expect(sessions.admin?.email).toBe(ADMIN.email);
    expect(sessions.member).toBeNull();
    await expect(page.getByText("Administrator")).toBeVisible();
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/admin\/login\?flash=signed-out/);
    await expect(page.getByText("You are signed out of the admin console.")).toBeVisible();
    expect((await portalSessions(page)).admin).toBeNull();
    await open(page, "/admin/members");
    await expect(page).toHaveURL(/\/admin\/login\?next=%2Fadmin%2Fmembers/);
  });

  test("Home shows database-backed figures", async ({ page }) => {
    await expect(page.getByText("Members", { exact: true }).first()).toBeVisible();
    const kpis = page.locator(".kpis--quad .kpi__value");
    await expect(kpis).toHaveCount(4);
    for (let i = 0; i < 4; i++) await expect(kpis.nth(i)).toHaveText(/^\d+$/);
    await expect(page.getByRole("heading", { name: "Progress trackers" })).toBeVisible();
    await expect(page.locator(".bars .bar")).toHaveCount(5);
    await expect(page.getByRole("heading", { name: "What has been happening" })).toBeVisible();
  });

  test("Members: search, filter and open Member 360 with read-only results", async ({ page }) => {
    await page.getByRole("link", { name: "Members" }).first().click();
    await expect(page).toHaveURL(/\/admin\/members/);
    const table = page.getByTestId("members-table");
    await expect(table).toBeVisible();
    // Seeded members are found by search: the unfiltered list pages at 25 and
    // grows with every E2E sign-up, so "page 1" is not a stable place to look.
    await page.getByLabel("Search members").fill("jordan");
    await expect(table.getByText("jordan.dual@demo.veye.test")).toBeVisible();
    await page.getByLabel("Search members").fill(ADMIN.email);
    await expect(page.getByText("No members match those filters")).toBeVisible(); // admin-only account is not a member

    await page.getByLabel("Search members").fill("maya");
    await expect(table.locator("tbody tr")).toHaveCount(1);
    await expect(table.getByText("maya.demo@demo.veye.test")).toBeVisible();
    // Aditya has a Health Number, so "not started" plus his name matches nobody — deterministic whatever else exists.
    await page.getByLabel("Search members").fill("aditya");
    await page.getByLabel("Onboarding status").selectOption("not_started");
    await expect(page.getByText("No members match those filters")).toBeVisible();
    await page.getByRole("button", { name: "Clear all filters" }).click();

    await table.locator("tr", { hasText: ADITYA.email }).getByRole("link", { name: /^Open/ }).click();
    await expect(page).toHaveURL(/\/admin\/members\/[0-9a-f-]{36}/);
    await expect(page.getByRole("heading", { name: "Aditya Demo" })).toBeVisible();
    await expect(page.locator(".arc__val")).toHaveText(/^\d\.\d$/);
    await page.getByRole("link", { name: "Assessments" }).nth(1).click();
    await expect(page.getByTestId("m360-health-assessment")).toContainText("2 results");
    await expect(page.getByTestId("m360-health-assessment")).toContainText("Moderate Inflammation");
    await expect(page.getByTestId("m360-simple-quiz")).toContainText("2 results");
    await expect(page.getByTestId("m360-blood-markers")).toContainText("System managed");
    // nothing on the page edits a stored result
    await expect(page.getByRole("button", { name: /edit|recalculate|change/i })).toHaveCount(0);
    await page.getByRole("link", { name: "Companion" }).nth(1).click();
    await expect(page.getByRole("heading", { name: "Guided experiences" })).toBeVisible();
  });

  test("Assessments: five system-managed instruments and their results", async ({ page }) => {
    await open(page, "/admin/assessments");
    const instruments = page.getByTestId("instruments").locator(".instr");
    await expect(instruments).toHaveCount(5);
    await expect(page.getByTestId("instruments")).toContainText("System managed");
    await expect(page.getByTestId("instruments")).toContainText("health-assessment-2026-08-25-v2");
    await instruments.filter({ hasText: "Simple Quiz" }).click();
    await expect(page).toHaveURL(/\/admin\/assessments\/simple_quiz/);
    const rows = page.getByTestId("attempts-table").locator("tbody tr");
    await expect(rows.first()).toBeVisible();
    await expect(page.getByTestId("attempts-table")).toContainText("simple-quiz-2026-08-20-v1");
    await page.getByLabel("Search by member").fill("maya");
    await expect(rows).toHaveCount(1);
  });

  test("Care Studio: create a draft, publish it, and members see it", async ({ page }) => {
    await open(page, "/admin/care?kind=fitness");
    const table = page.getByTestId("care-table");
    await expect(table).toContainText("Interested in Martial Arts and Boxing?");
    const title = `E2E mobility warm-up ${Date.now().toString(36)}`;
    await page.getByRole("button", { name: /New fitnes/ }).click();
    await page.getByLabel("Title").fill(title);
    await page.getByLabel("Content type").selectOption("video");
    await page.getByLabel("YouTube address").fill("https://youtu.be/XLlHJ5-vHWw");
    await page.getByLabel("Description").fill("Five minutes before any session.");
    await page.getByTestId("care-save").click();
    const row = table.locator("tr", { hasText: title });
    await expect(row).toContainText("Draft");
    await row.getByRole("button", { name: "Publish", exact: true }).click();
    await expect(row).toContainText("Published");
    await row.getByRole("button", { name: "Archive" }).click();
    await expect(row).toContainText("Archived");
    await expect(row.getByRole("button", { name: "Restore to draft" })).toBeVisible();
  });

  test("Content: the approved FAQ is published and a new entry follows the lifecycle", async ({ page }) => {
    await open(page, "/admin/content?group=help_faq");
    await expect(page.getByTestId("content-table").first()).toContainText("What is Veye?");
    const key = `e2e_entry_${Date.now().toString(36)}`;
    await page.getByRole("button", { name: "New entry" }).click();
    await page.getByLabel("Question").fill("Who is Sprout?");
    await page.getByLabel("Key").fill(key);
    await page.getByLabel("Category").fill("Using the Platform");
    await page.getByLabel("Answer").fill("Sprout is the Veye Companion.");
    await page.getByTestId("content-save").click();
    const row = page.locator("tr", { hasText: key });
    await expect(row).toContainText("Draft");
    await row.getByRole("button", { name: "Publish", exact: true }).click();
    await expect(row).toContainText("Published");
    await row.getByRole("button", { name: "Unpublish" }).click();
    await expect(row).toContainText("Draft");
    await row.getByRole("button", { name: "Archive" }).click();
    await expect(row).toContainText("Archived");
  });

  test("Insights are real aggregates", async ({ page }) => {
    await open(page, "/admin/insights");
    await expect(page.getByRole("heading", { name: "New members by month" })).toBeVisible();
    await expect(page.locator(".kpis--quad .kpi__value").first()).toHaveText(/^\d+$/);
    await expect(page.getByRole("heading", { name: "Guided experiences" })).toBeVisible();
    await expect(page.getByText(/Generated .* from the local database/)).toBeVisible();
  });

  test("Companion → Settings → Guided Experiences lists both flows with preview", async ({ page }) => {
    await open(page, "/admin/companion/settings/guided-experiences");
    await expect(page.getByRole("heading", { name: "First-Time User" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Progress Tracker Guide" })).toBeVisible();
    await expect(page.getByText("Active").first()).toBeVisible();
    await page.getByRole("button", { name: "Preview" }).first().click();
    await expect(page.getByRole("heading", { name: /^Preview — / })).toBeVisible();
    await expect(page.locator("#flowPreview")).toContainText(/WHY TO|Blood Test Markers/);
  });
});
