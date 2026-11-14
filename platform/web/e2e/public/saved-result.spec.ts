import { expect, test, type Browser, type Page } from "@playwright/test";
import { ADMIN, API_URL, freshMember } from "../fixtures/accounts";
import { adminSignIn, answerOnboarding, expectAdminHome, linkFrom, memberApi, open, toPath, waitForMail } from "../fixtures/helpers";

/* A visitor saves their result before signing up (architecture V2 §§2–3):
   the owner switches saving on, the gate shows the notice and an unticked
   box, the answers are kept, the console sees metadata only, and the result
   joins an account on another device only after the address is proven —
   without being duplicated. Saving is switched back to Never afterwards, so
   no other spec meets a changed gate. */

async function adminPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await adminSignIn(page, ADMIN.email, ADMIN.password);
  await expectAdminHome(page);
  return page;
}

async function setRetention(page: Page, testId: string) {
  await open(page, "/admin/settings?section=product");
  const card = page.getByTestId("privacy-prospects");
  await expect(card.getByTestId("retention-current")).toBeVisible();
  const option = card.getByTestId(testId);
  if (await option.isChecked()) return;
  await option.check({ force: true });
  await expect(card.getByTestId("retention-impact")).toBeVisible();
  const published = page.waitForResponse((r) => r.url().endsWith("/api/v1/admin/settings/privacy") && r.request().method() === "PUT");
  await card.getByTestId("retention-publish").click();
  expect((await published).status()).toBe(200);
  await expect(card.getByTestId("retention-message")).toContainText("Published as version");
}

async function finishQuiz(page: Page, email: string, save: boolean) {
  await open(page, "/onboarding");
  await answerOnboarding(page);
  await expect(page.getByRole("dialog", { name: "Your Health Number is Ready" })).toBeVisible();
  const consent = page.getByTestId("save-consent");
  await expect(page.getByTestId("save-notice")).toContainText("We will save your quiz answers");
  await expect(page.getByTestId("save-notice").getByRole("link", { name: "Privacy Policy" })).toHaveAttribute("href", "/privacy");
  await expect(consent).not.toBeChecked();
  if (save) await consent.check();
  await page.getByLabel("Email Address").fill(email);
  await page.getByTestId("gate-submit").click();
  await expect(page.getByRole("heading", { name: "Your Health Number" })).toBeVisible();
}

test.describe("saving a result before sign-up", () => {
  test("saved, confirmed and claimed from another device, without a duplicate", async ({ browser }) => {
    const admin = await adminPage(browser);
    const visitor = freshMember("journey");
    try {
      await setRetention(admin, "retention-days30");

      const tab = await (await browser.newContext()).newPage();
      const saved = tab.waitForResponse((r) => r.url().endsWith("/api/v1/prospects/assessment"));
      await finishQuiz(tab, visitor.email, true);
      expect((await saved).status()).toBe(201);
      await expect(tab.getByTestId("saved-status")).toContainText("Saved until");
      await expect(tab.getByTestId("saved-status")).toContainText("We emailed");

      // The console: one row, address masked, no answers and no number on the wire.
      await open(admin, "/admin/members/prospects");
      const listed = admin.waitForResponse((r) => r.url().includes("/api/v1/admin/prospects?") && r.url().includes(encodeURIComponent(visitor.email)));
      await admin.getByTestId("prospects-search").fill(visitor.email);
      const page = await (await listed).json() as { total: number; rows: { status: string; email_masked: string }[] };
      expect(page.total).toBe(1);
      expect(JSON.stringify(page)).not.toMatch(/displayed_score|interpretation|answers/);
      await expect(admin.getByTestId("prospect-row")).toContainText("Unverified prospect");

      // Another device: the emailed link confirms the address and moves the
      // token out of the address bar.
      const mail = await waitForMail(visitor.email, "Confirm your email address for Veye");
      expect(mail.text).not.toMatch(/Health Number is \d/);
      const device = await (await browser.newContext()).newPage();
      await open(device, toPath(linkFrom(mail.text, "saved-result")));
      await expect(device.getByTestId("saved-result-status")).toContainText("saved for");
      await expect.poll(() => device.url()).not.toContain("token=");

      // Sign up there with the same address; verification completes the claim.
      await device.getByTestId("saved-result-signup").click();
      await device.getByLabel("First name").fill(visitor.firstName);
      await device.getByLabel("Last name").fill(visitor.lastName);
      await device.getByLabel("Email", { exact: true }).fill(visitor.email);
      await device.getByPlaceholder("Enter your password").fill(visitor.password);
      await device.getByPlaceholder("Confirm your password").fill(visitor.password);
      await device.getByRole("button", { name: "Sign Up" }).click();
      await expect(device.getByTestId("signup-saved-pending")).toBeVisible();
      const verify = await waitForMail(visitor.email, "Verify your Veye email address");
      await open(device, toPath(linkFrom(verify.text, "verify-email")));
      await expect(device.getByText("Your email address is verified.")).toBeVisible();
      const history = await memberApi<{ history: { completed_at: string }[] }>(device, "/api/v1/members/me/health-number");
      expect(history.history).toHaveLength(1);

      await open(admin, "/admin/members/prospects");
      await admin.getByTestId("prospects-search").fill(visitor.email);
      await expect(admin.getByTestId("prospects-table")).toHaveCount(0); // the address is cleared once claimed
      await admin.getByTestId("prospects-search").fill("");
      await admin.getByTestId("prospects-status").selectOption("claimed");
      await expect(admin.getByTestId("prospect-row").filter({ hasText: visitor.firstName }).first()).toContainText("Registered member");
    } finally {
      await setRetention(admin, "retention-never");
    }
  });

  test("an unticked box shows the number and stores nothing", async ({ browser }) => {
    const admin = await adminPage(browser);
    const visitor = freshMember("journey");
    try {
      await setRetention(admin, "retention-days15");
      const tab = await (await browser.newContext()).newPage();
      let captured = false;
      tab.on("request", (r) => { if (r.url().endsWith("/api/v1/prospects/assessment")) captured = true; });
      await finishQuiz(tab, visitor.email, false);
      await expect(tab.getByTestId("saved-status")).toContainText("Not saved");
      expect(captured, "nothing was sent to the saving route").toBe(false);
      const check = await admin.request.get(`${API_URL}/api/v1/admin/prospects?q=${encodeURIComponent(visitor.email)}`);
      expect((await check.json()).total).toBe(0);
    } finally {
      await setRetention(admin, "retention-never");
    }
  });

  test("with retention at Never the gate is the approved prototype's", async ({ page }) => {
    await open(page, "/onboarding");
    await answerOnboarding(page);
    await expect(page.getByRole("dialog", { name: "Your Health Number is Ready" })).toBeVisible();
    await expect(page.getByTestId("save-notice")).toHaveCount(0);
    await expect(page.getByTestId("save-consent")).toHaveCount(0);
  });
});
