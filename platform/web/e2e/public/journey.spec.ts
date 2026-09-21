import { expect, test } from "@playwright/test";
import { freshMember } from "../fixtures/accounts";
import { answerOnboarding, expectMemberDashboard, expectNoHorizontalOverflow, linkFrom, memberApi, open, portalSessions, toPath, waitForMail } from "../fixtures/helpers";

/* The new-member journey exactly as a visitor takes it: homepage → Get Started
   → the 12-question assessment → the result gate → Sign Up (the assessment
   answers travel to the account) → Mailpit verification → dashboard showing
   the same Health Number → the public Help page's FAQ and Ask a Question. */

test.describe("Public → new member journey", () => {
  test("homepage → Get Started → assessment → sign up → verify → dashboard", async ({ page }) => {
    const member = freshMember("journey");
    const consoleErrors: string[] = [];
    page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });

    await open(page, "/");
    await expect(page.getByRole("link", { name: "Get Started" })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.getByRole("link", { name: "Get Started" }).click();
    await expect(page).toHaveURL(/\/onboarding/);

    await answerOnboarding(page);
    // Visitor: the approved email gate, then the number, then Sign Up.
    await expect(page.getByRole("heading", { name: "Your Health Number is Ready" })).toBeVisible();
    await page.getByLabel("Email Address").fill(member.email);
    await page.getByRole("button", { name: "View My Health Number" }).click();
    await expect(page.getByRole("heading", { name: "Your Health Number" })).toBeVisible();
    const shown = (await page.locator(".result__ring b").textContent())?.trim();
    expect(shown).toMatch(/^\d+(\.\d)?$/);
    // Seeing the number grants nothing: no session exists yet.
    expect((await portalSessions(page)).member).toBeNull();

    await page.getByRole("button", { name: "Sign Up" }).click();
    await expect(page).toHaveURL(/\/signup/);
    await expect(page.getByLabel("Email", { exact: true })).toHaveValue(member.email); // prefilled from the gate
    await expect(page.getByText("Your Health Number from the assessment will be saved to this account.")).toBeVisible();
    await page.getByLabel("First name").fill(member.firstName);
    await page.getByLabel("Last name").fill(member.lastName);
    await page.getByPlaceholder("Enter your password").fill(member.password);
    await page.getByPlaceholder("Confirm your password").fill(member.password);
    await page.getByRole("button", { name: "Sign Up" }).click();
    await expect(page).toHaveURL(/\/app(\?|$)/);

    // The assessment taken as a visitor is now the member's stored Health Number.
    const saved = await memberApi<{ latest: { displayed_score: string | number } | null; history: unknown[] }>(page, "/api/v1/members/me/health-number");
    expect(saved.history).toHaveLength(1);
    expect(Number(saved.latest?.displayed_score).toFixed(1)).toBe(Number(shown).toFixed(1));
    await expectMemberDashboard(page);
    await expect(page.locator(".health-num strong")).toHaveText(Number(shown).toFixed(1));

    // Verification by email (Mailpit), single use.
    const mail = await waitForMail(member.email, "Verify your Veye email address");
    await open(page, toPath(linkFrom(mail.text, "verify-email")));
    await expect(page.getByText("Your email address is verified.")).toBeVisible();
    await open(page, "/app/settings");
    await expect(page.locator('input[value="Verified"]')).toBeVisible();

    expect(consoleErrors.filter((text) => !/hmr|favicon/i.test(text))).toEqual([]);
  });

  test("public Help page: FAQ comes from published content and Ask a Question reaches the inbox", async ({ page }) => {
    await open(page, "/help");
    await expect(page.locator('.faq[data-source="published"]')).toHaveCount(1);
    await expect(page.locator(".faq__item")).toHaveCount(22);
    await page.getByRole("button", { name: "Technical Issues" }).click();
    await expect(page.locator(".help__cat")).toHaveText("Technical Issues");
    await expect(page.locator('.faq__item[data-cat="technical"]:not([hidden])').first()).toBeVisible();

    await page.getByRole("button", { name: "Ask a Question" }).click();
    const stamp = Date.now().toString(36);
    await page.locator("#helpAskInput").fill(`E2E question ${stamp}: where do I update a blood marker?`);
    await page.locator("#helpAskEmail").fill(`journey.${stamp}@demo.veye.test`);
    await page.locator("#helpAskSubmit").click();
    await expect(page.locator("#helpAskDone")).toContainText("your question has been received");
    await expect(page.locator("#helpAskInput")).toHaveValue("");
  });
});
