import { expect, test } from "@playwright/test";
import { ADITYA, ADMIN, freshMember } from "../fixtures/accounts";
import {
  adminSignIn,
  expectAdminHome,
  expectMemberDashboard,
  linkFrom,
  memberSignIn,
  open,
  signUpMember,
  toPath,
  waitForMail,
} from "../fixtures/helpers";

/* Settings → Sign-in details: the member's own password, email address and
   sessions. Each one is proven by its consequence — the old password stops
   working, the other device is signed out, the new address becomes the
   sign-in — not by a toast. */

test.describe("Member account security", () => {
  test("changing the password keeps this session and signs every other device out", async ({ page, browser }) => {
    const member = freshMember("security");
    await signUpMember(page, member);
    await open(page, "/app");
    await expectMemberDashboard(page);

    // A second device signed into the same account.
    const otherContext = await browser.newContext();
    const other = await otherContext.newPage();
    await memberSignIn(other, member.email, member.password);
    await expectMemberDashboard(other);

    await open(page, "/app/settings");
    await expect(page.getByTestId("settings-sessions")).toContainText("2 sessions");
    await page.getByTestId("open-password").click();

    // The current password has to be right, and the new one has to be real.
    const next = `${member.password}-changed`;
    await page.getByTestId("password-current").fill("not-my-password");
    await page.getByTestId("password-new").fill(next);
    await page.getByTestId("password-confirm").fill(next);
    await page.getByTestId("password-save").click();
    await expect(page.getByTestId("security-note")).toContainText(/current password is not right/i);

    await page.getByTestId("password-current").fill(member.password);
    await page.getByTestId("password-new").fill("short");
    await page.getByTestId("password-confirm").fill("short");
    await page.getByTestId("password-save").click();
    await expect(page.getByTestId("security-note")).toContainText(/at least 12/i);

    await page.getByTestId("password-current").fill(member.password);
    await page.getByTestId("password-new").fill(next);
    await page.getByTestId("password-confirm").fill(next);
    await page.getByTestId("password-save").click();
    await expect(page.getByTestId("security-note")).toContainText(/password has been changed/i);

    // This session survived…
    await open(page, "/app/settings");
    await expect(page.getByTestId("settings-sessions")).toContainText("here only");
    // …the other device did not.
    await other.goto("/app/settings");
    await expect(other).toHaveURL(/\/login/);
    // The old password is dead; the new one works.
    await memberSignIn(other, member.email, member.password);
    await expect(other.locator(".auth__error, .field__error").first()).toBeVisible();
    await memberSignIn(other, member.email, next);
    await expectMemberDashboard(other);
    await otherContext.close();
  });

  test("a member sees their sessions and can sign out everywhere else", async ({ page, browser }) => {
    const member = freshMember("security");
    await signUpMember(page, member);
    const contexts = [];
    for (let i = 0; i < 2; i++) {
      const context = await browser.newContext();
      const extra = await context.newPage();
      await memberSignIn(extra, member.email, member.password);
      await expectMemberDashboard(extra);
      contexts.push({ context, extra });
    }

    await open(page, "/app/settings");
    await expect(page.getByTestId("settings-sessions")).toContainText("3 sessions");
    await expect(page.getByTestId("session-current")).toHaveCount(1);
    await expect(page.getByTestId("session-other")).toHaveCount(2);

    await page.getByTestId("revoke-others").click();
    await expect(page.getByTestId("security-note")).toContainText(/2 .*signed out/i);
    await expect(page.getByTestId("session-other")).toHaveCount(0);
    // This device is still signed in; the others are not.
    await open(page, "/app");
    await expectMemberDashboard(page);
    for (const { context, extra } of contexts) {
      await extra.goto("/app");
      await expect(extra).toHaveURL(/\/login/);
      await context.close();
    }
  });

  test("an email change is confirmed from the new mailbox and only then becomes the sign-in", async ({ page }) => {
    const member = freshMember("security");
    const moved = freshMember("security").email; // itself disposable: the teardown matches <prefix>.<stamp>
    await signUpMember(page, member);
    await open(page, "/app/settings");

    await page.getByTestId("open-email-change").click();
    // The account password is required, and a taken address is refused.
    await page.getByTestId("email-new").fill(ADITYA.email);
    await page.getByTestId("email-password").fill(member.password);
    await page.getByTestId("email-save").click();
    await expect(page.getByTestId("security-note")).toContainText(/already in use/i);

    await page.getByTestId("email-new").fill(moved);
    await page.getByTestId("email-password").fill("not-my-password");
    await page.getByTestId("email-save").click();
    await expect(page.getByTestId("security-note")).toContainText(/password is not right/i);

    await page.getByTestId("email-new").fill(moved);
    await page.getByTestId("email-password").fill(member.password);
    await page.getByTestId("email-save").click();
    await expect(page.getByTestId("security-note")).toContainText(/check the new address/i);

    // Until the link is used the account keeps its current address.
    await open(page, "/app/settings");
    await expect(page.getByTestId("pending-email")).toContainText(moved);
    await expect(page.getByTestId("settings-email")).toHaveValue(member.email);

    const mail = await waitForMail(moved, "Confirm your new Veye email address");
    await page.goto(toPath(linkFrom(mail.text, "confirm-email")));
    // Confirming ends every session: the identity on the account moved.
    await expect(page.getByTestId("confirm-email-message")).toContainText(/your email address is now/i);
    await memberSignIn(page, member.email, member.password);
    await expect(page.locator(".auth__error, .field__error").first()).toBeVisible();
    await memberSignIn(page, moved, member.password);
    await expectMemberDashboard(page);
    await open(page, "/app/settings");
    await expect(page.getByTestId("settings-email")).toHaveValue(moved);
  });

  test("a pending email change can be cancelled", async ({ page }) => {
    const member = freshMember("security");
    const moved = freshMember("security").email;
    await signUpMember(page, member);
    await open(page, "/app/settings");
    await page.getByTestId("open-email-change").click();
    await page.getByTestId("email-new").fill(moved);
    await page.getByTestId("email-password").fill(member.password);
    await page.getByTestId("email-save").click();
    await expect(page.getByTestId("pending-email")).toContainText(moved);
    const mail = await waitForMail(moved, "Confirm your new Veye email address");

    await page.getByTestId("cancel-email-change").click();
    await expect(page.getByTestId("security-note")).toContainText(/cancelled/i);
    await expect(page.getByTestId("pending-email")).toHaveCount(0);
    // The cancelled link no longer does anything.
    await page.goto(toPath(linkFrom(mail.text, "confirm-email")));
    await expect(page.getByTestId("confirm-email-message")).toContainText(/not valid|already been used|no pending/i);
    await open(page, "/app/settings");
    await expect(page.getByTestId("settings-email")).toHaveValue(member.email);
  });
});

/* The administrator's side of the same account: what the console may do, and
   what it must never do. */
test.describe("Admin actions on a member account", () => {
  test("deactivating a member blocks the sign-in, and reactivating restores it", async ({ page, browser }) => {
    const member = freshMember("security");
    const memberContext = await browser.newContext();
    const theirs = await memberContext.newPage();
    await signUpMember(theirs, member);
    await open(theirs, "/app");
    await expectMemberDashboard(theirs);

    await adminSignIn(page, ADMIN.email, ADMIN.password);
    await expectAdminHome(page);
    await open(page, "/admin/members");
    await page.getByLabel("Search members").fill(member.email);
    const row = page.locator("tr", { hasText: member.email });
    await expect(row).toHaveCount(1);
    await row.getByRole("link", { name: /^Open/ }).click();
    await expect(page).toHaveURL(/\/admin\/members\/[0-9a-f-]{36}$/);
    await page.getByRole("navigation", { name: "Section" }).getByRole("link", { name: "Account", exact: true }).click();
    await expect(page.getByTestId("m360-account-actions")).toBeVisible();

    page.once("dialog", (dialog) => void dialog.accept());
    await page.getByTestId("account-deactivate").click();
    await expect(page.getByTestId("account-action-notice")).toContainText(/deactivated/i);

    // They are out of the application at once, and the password stops working.
    await theirs.goto("/app/settings");
    await expect(theirs).toHaveURL(/\/login/);
    await memberSignIn(theirs, member.email, member.password);
    await expect(theirs.locator(".auth__error, .field__error").first()).toBeVisible();
    // Veye tells them why.
    await waitForMail(member.email, "Your Veye account has been deactivated");

    await page.getByTestId("account-reactivate").click();
    await expect(page.getByTestId("account-action-notice")).toContainText(/active again/i);
    await memberSignIn(theirs, member.email, member.password);
    await expectMemberDashboard(theirs);
    await memberContext.close();
  });

  test("an administrator can send the two account emails but never sets a password", async ({ page, browser }) => {
    const member = freshMember("security");
    const memberContext = await browser.newContext();
    const theirs = await memberContext.newPage();
    await signUpMember(theirs, member);

    await adminSignIn(page, ADMIN.email, ADMIN.password);
    await expectAdminHome(page);
    await open(page, "/admin/members");
    await page.getByLabel("Search members").fill(member.email);
    const row = page.locator("tr", { hasText: member.email });
    await expect(row).toHaveCount(1);
    await row.getByRole("link", { name: /^Open/ }).click();
    await page.getByRole("navigation", { name: "Section" }).getByRole("link", { name: "Account", exact: true }).click();

    // The sign-up address is unverified, so a fresh verification can be sent.
    await page.getByTestId("account-resend-verification").click();
    await expect(page.getByTestId("account-action-notice")).toContainText(/verification email/i);
    await waitForMail(member.email, "Verify your Veye email address");

    page.once("dialog", (dialog) => void dialog.accept());
    await page.getByTestId("account-send-reset").click();
    await expect(page.getByTestId("account-action-notice")).toContainText(/reset link/i);
    const reset = await waitForMail(member.email, "Reset your Veye password");

    // The console shows no password control of any kind.
    await expect(page.getByTestId("m360-account-actions")).not.toContainText(/set password|new password/i);
    // Only the person holding the mailbox chooses the new one.
    const chosen = `${member.password}-reset`;
    await theirs.goto(toPath(linkFrom(reset.text, "reset-password")));
    await theirs.locator('input[name="password"]').fill(chosen);
    await theirs.locator('input[name="confirm"]').fill(chosen);
    await theirs.getByRole("button", { name: /save new password/i }).click();
    await expect(theirs).toHaveURL(/\/login/);
    await memberSignIn(theirs, member.email, chosen);
    await expectMemberDashboard(theirs);
    await memberContext.close();
  });
});
