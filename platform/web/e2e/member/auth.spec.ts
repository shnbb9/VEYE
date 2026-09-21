import { expect, test } from "@playwright/test";
import { ADITYA, freshMember } from "../fixtures/accounts";
import { expectMemberDashboard, linkFrom, memberSignIn, portalSessions, toPath, waitForMail, open } from "../fixtures/helpers";

test.describe("Member portal — sign-up, verification, sign-in, reset", () => {
  test("a visitor signs up, verifies by email (Mailpit) and lands on the member dashboard", async ({ page }) => {
    const member = freshMember("signup");
    await open(page, "/signup");
    await page.getByLabel("First name").fill(member.firstName);
    await page.getByLabel("Last name").fill(member.lastName);
    await page.getByLabel("Email", { exact: true }).fill(member.email);
    await page.getByPlaceholder("Enter your password").fill(member.password);
    await page.getByPlaceholder("Confirm your password").fill(member.password);
    await page.getByRole("button", { name: "Sign Up" }).click();

    // A new member without a Health Number is taken to onboarding; the session is a MEMBER session.
    await expect(page).toHaveURL(/\/(app|onboarding)/);
    const sessions = await portalSessions(page);
    expect(sessions.member?.email).toBe(member.email);
    expect(sessions.admin).toBeNull();

    // Verification link arrives in the local mailbox and works exactly once.
    const mail = await waitForMail(member.email, "Verify your Veye email address");
    await open(page, toPath(linkFrom(mail.text, "verify-email")));
    await expect(page.getByText("Your email address is verified.")).toBeVisible();
    await open(page, toPath(linkFrom(mail.text, "verify-email")));
    await expect(page.getByText(/already been used/)).toBeVisible();

    await open(page, "/app");
    await expectMemberDashboard(page);
  });

  test("a seeded member signs in and out; signing out ends only the member session", async ({ page }) => {
    await memberSignIn(page, ADITYA.email, ADITYA.password);
    await expectMemberDashboard(page);
    await expect(page.getByRole("heading", { name: `Welcome back ${ADITYA.firstName}` })).toBeVisible();

    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page).toHaveURL(/\/$/);
    expect((await portalSessions(page)).member).toBeNull();

    // The member portal is closed now.
    await open(page, "/app");
    await expect(page).toHaveURL(/\/login\?next=%2Fapp/);
  });

  test("wrong credentials are refused without saying which part was wrong", async ({ page }) => {
    await memberSignIn(page, ADITYA.email, "not-the-password-2026");
    await expect(page.getByText("That email address and password do not match.")).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test("forgot / reset password by email returns to the member sign-in", async ({ page }) => {
    const member = freshMember("reset");
    // create the member through the API-backed sign-up screen
    await open(page, "/signup");
    await page.getByLabel("First name").fill(member.firstName);
    await page.getByLabel("Last name").fill(member.lastName);
    await page.getByLabel("Email", { exact: true }).fill(member.email);
    await page.getByPlaceholder("Enter your password").fill(member.password);
    await page.getByPlaceholder("Confirm your password").fill(member.password);
    await page.getByRole("button", { name: "Sign Up" }).click();
    await expect(page).toHaveURL(/\/(app|onboarding)/);
    await page.context().clearCookies();

    await open(page, "/login");
    await page.getByRole("button", { name: "Forgot your password?" }).click();
    await page.getByRole("button", { name: /Reset by email/ }).click();
    await page.locator("#pwEmail").fill(member.email);
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByText(/password-reset link has been sent/)).toBeVisible();

    const mail = await waitForMail(member.email, "Reset your Veye password");
    const link = linkFrom(mail.text, "reset-password");
    expect(link).not.toContain("portal=admin");
    await open(page, toPath(link));
    const newPassword = `${member.password}-new`;
    await page.getByPlaceholder("New password", { exact: true }).fill(newPassword);
    await page.getByPlaceholder("Confirm new password").fill(newPassword);
    await page.getByRole("button", { name: "Save new password" }).click();
    await expect(page).toHaveURL(/\/login\?flash=reset/);
    await expect(page.getByText("Your password has been changed.")).toBeVisible();

    await memberSignIn(page, member.email, member.password);
    await expect(page.getByText("That email address and password do not match.")).toBeVisible();
    await memberSignIn(page, member.email, newPassword);
    await expect(page).toHaveURL(/\/(app|onboarding)/);
  });
});
