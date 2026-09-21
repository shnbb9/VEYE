import { expect, test, type Browser, type Page } from "@playwright/test";
import { ADMIN, ADMIN_TWO, ADITYA, freshMember } from "../fixtures/accounts";
import { adminSignIn, expectAdminHome, expectMemberDashboard, memberSignIn, open, portalSessions, signUpMember } from "../fixtures/helpers";

/* Admin ↔ member propagation, both directions:
   - a member's Contact Us / Join Beta and a visitor's Help question land in
     Requests & Inbox, move through the statuses, and show on Member 360;
   - the console's support details, a published daily tip and an edited FAQ
     reach the member dashboard and the public Help page;
   - two administrator accounts have the same plain capability. */

const stamp = Date.now().toString(36);

async function memberBrowser(browser: Browser, email: string, password: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await memberSignIn(page, email, password);
  await expectMemberDashboard(page);
  return page;
}

test.describe.serial("Requests & Inbox and content propagation", () => {
  test("member Contact Us and Join Beta reach the inbox; status moves show back to the member and on Member 360", async ({ browser, page }) => {
    const member = freshMember("e2e");
    const mayaContext = await browser.newContext();
    const maya = await mayaContext.newPage();
    await signUpMember(maya, member);
    await open(maya, "/app");
    await expectMemberDashboard(maya);
    // Contact Us from the dashboard card.
    await maya.getByTestId("contact-us").click();
    await maya.locator("#contactSubject").fill(`E2E contact ${stamp}`);
    await maya.locator("#contactMessage").fill("Is my first Health Number kept when I retake the assessment?");
    await maya.getByTestId("contact-send").click();
    await expect(maya.getByTestId("contact-dialog")).toHaveCount(0);
    // Join Beta (Maya has no seeded request) → the card turns into a status line.
    await maya.getByTestId("beta-join").click();
    await expect(maya.getByTestId("beta-status")).toContainText(/Beta request sent .* New/);

    await adminSignIn(page, ADMIN.email, ADMIN.password);
    await expectAdminHome(page);
    await expect(page.getByTestId("home-requests-open")).toHaveText(/^\d+$/);
    expect(Number(await page.getByTestId("home-requests-open").textContent())).toBeGreaterThanOrEqual(2);

    await page.getByRole("link", { name: "Requests & Inbox" }).first().click();
    await expect(page).toHaveURL(/\/admin\/requests/);
    await page.getByLabel("Search requests").fill(`E2E contact ${stamp}`);
    const row = page.getByTestId("requests-list").locator(".flag").first();
    await expect(row).toContainText(`${member.firstName} ${member.lastName}`);
    await row.click();
    const detail = page.getByTestId("request-detail");
    await expect(detail).toContainText("Is my first Health Number kept");
    await expect(detail).toContainText(member.email);
    await page.getByTestId("request-progress").click();
    await expect(detail.locator(".chip").first()).toHaveText("In progress");
    await page.getByTestId("request-note").fill("Replied by email: yes, every result is kept.");
    await page.getByTestId("request-resolve").click();
    await expect(detail.locator(".chip").first()).toHaveText("Resolved");
    // it moved out of Open and into Resolved
    await page.getByRole("tab", { name: "Resolved" }).click();
    await expect(page.getByTestId("requests-list")).toContainText(`E2E contact ${stamp}`);

    // Member 360 → Requests tab lists it with the new status; the member's own list agrees.
    await page.getByRole("link", { name: "Open Member 360" }).click();
    await expect(page).toHaveURL(/\/admin\/members\/[0-9a-f-]{36}/);
    await page.getByRole("link", { name: "Requests", exact: true }).click();
    await expect(page.getByTestId("m360-requests")).toContainText(`E2E contact ${stamp}`);
    await expect(page.getByTestId("m360-requests")).toContainText("Resolved");
    const mine = await maya.evaluate(async (api) => (await fetch(`${api}/api/v1/members/me/requests`, { credentials: "include" })).json(), process.env.E2E_API_URL ?? "http://localhost:8001") as { subject: string; status: string }[];
    expect(mine.find((r) => r.subject === `E2E contact ${stamp}`)?.status).toBe("resolved");
    // the Join Beta request is still open
    await page.getByRole("link", { name: "Open Requests & Inbox" }).click();
    await page.getByLabel("Kind").selectOption("join_beta");
    await expect(page.getByTestId("requests-list")).toContainText(`${member.firstName} ${member.lastName}`);
    await mayaContext.close();
  });

  test("support details, a published daily tip and an edited FAQ propagate to member and public surfaces", async ({ browser, page }) => {
    await adminSignIn(page, ADMIN.email, ADMIN.password);
    await expectAdminHome(page);

    // Support email (Settings → Product settings).
    await open(page, "/admin/settings?section=product");
    const emailField = page.getByTestId("support-email-input");
    await expect(emailField).toHaveValue(/@/);
    const original = await emailField.inputValue();
    await emailField.fill(`support.${stamp}@veye.test`);
    await page.getByTestId("support-save").click();
    await expect(page.getByTestId("support-saved")).toBeVisible();

    // Daily tip: publish the seeded draft with our own text.
    await open(page, "/admin/content?group=member_copy");
    const tipRow = page.getByTestId("content-table").locator("tr", { hasText: "daily_health_tip" });
    await tipRow.getByRole("button", { name: "Edit" }).click();
    await page.locator("#ce-body").fill(`E2E daily tip ${stamp}: drink a glass of water before each meal.`);
    await page.getByTestId("content-save").click();
    await expect(page.getByTestId("content-table").locator("tr", { hasText: "daily_health_tip" })).toContainText(`E2E daily tip ${stamp}`);
    const publish = page.getByTestId("content-table").locator("tr", { hasText: "daily_health_tip" }).getByRole("button", { name: "Publish", exact: true });
    if (await publish.count()) await publish.click();
    await expect(page.getByTestId("content-table").locator("tr", { hasText: "daily_health_tip" }).locator(".chip")).toHaveText("Published");

    // FAQ: edit one answer.
    await open(page, "/admin/content?group=help_faq");
    const faqRow = page.getByTestId("content-table").locator("tr", { hasText: "what_is_metabolism" });
    await faqRow.getByRole("button", { name: "Edit" }).click();
    const answer = page.locator("#ce-body");
    const originalAnswer = await answer.inputValue();
    await answer.fill(`${originalAnswer.replace(/ \(E2E [a-z0-9]+\)$/, "")} (E2E ${stamp})`);
    await page.getByTestId("content-save").click();
    await expect(page.getByTestId("content-save")).toHaveCount(0); // drawer closed = saved
    // the table truncates long answers; confirm through the editor itself
    await faqRow.getByRole("button", { name: "Edit" }).click();
    await expect(page.locator("#ce-body")).toHaveValue(new RegExp(String.raw`\(E2E ${stamp}\)$`));
    await page.getByRole("button", { name: "Cancel" }).click();

    // Member dashboard shows the new support address and the published tip.
    const aditya = await memberBrowser(browser, ADITYA.email, ADITYA.password);
    await expect(aditya.getByTestId("support-email")).toHaveText(`support.${stamp}@veye.test`);
    await expect(aditya.getByTestId("daily-tip")).toContainText(`E2E daily tip ${stamp}`);
    await aditya.context().close();

    // Public Help page shows the edited answer (rendered per request).
    await open(page, "/help");
    await expect(page.locator('.faq__item[data-key="what_is_metabolism"]')).toContainText(`(E2E ${stamp})`);

    // Restore the support address and the FAQ wording so the seed stays recognisable.
    await open(page, "/admin/settings?section=product");
    await page.getByTestId("support-email-input").fill(original);
    await page.getByTestId("support-save").click();
    await expect(page.getByTestId("support-saved")).toBeVisible();
    await open(page, "/admin/content?group=help_faq");
    await page.getByTestId("content-table").locator("tr", { hasText: "what_is_metabolism" }).getByRole("button", { name: "Edit" }).click();
    await page.locator("#ce-body").fill(originalAnswer.replace(/ \(E2E [a-z0-9]+\)$/, ""));
    await page.getByTestId("content-save").click();
    await expect(page.getByTestId("content-save")).toHaveCount(0);
    await open(page, "/help");
    await expect(page.locator('.faq__item[data-key="what_is_metabolism"]')).not.toContainText("(E2E");
  });

  test("a second administrator has the same plain capability; the console never grants member access", async ({ page }) => {
    await adminSignIn(page, ADMIN_TWO.email, ADMIN_TWO.password);
    await expectAdminHome(page);
    await open(page, "/admin/requests");
    await expect(page.getByTestId("requests-counts")).toBeVisible();
    await open(page, "/admin/settings");
    await expect(page.getByTestId("settings-admin-email")).toHaveText(ADMIN_TWO.email);
    await expect(page.getByText("one administrator capability")).toBeVisible();
    await open(page, "/admin/settings?section=features");
    await expect(page.getByTestId("settings-features")).toContainText("Requests & Inbox");
    // an admin-only account still cannot enter the member application
    const sessions = await portalSessions(page);
    expect(sessions.admin?.email).toBe(ADMIN_TWO.email);
    expect(sessions.member).toBeNull();
    await open(page, "/app");
    await expect(page).toHaveURL(/\/login\?next=%2Fapp/);
  });
});
