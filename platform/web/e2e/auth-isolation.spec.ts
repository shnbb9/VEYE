import { expect, test } from "@playwright/test";
import { ADITYA, ADMIN, DUAL } from "./fixtures/accounts";
import { adminSignIn, expectAdminHome, expectMemberDashboard, memberSignIn, portalSessions, open } from "./fixtures/helpers";

/* Portal isolation: the door a person walks through decides where they land,
   never the account's flags. Member-only accounts cannot enter the console;
   an admin-only account cannot enter the member application; a dual-access
   person gets the member experience from /login and the console from
   /admin/login, may hold both sessions at once, and ending one leaves the
   other alone. */

test.describe("Portal isolation", () => {
  test("a member-only account is refused by the admin portal and cannot reach admin pages", async ({ page }) => {
    await memberSignIn(page, ADITYA.email, ADITYA.password);
    await expectMemberDashboard(page);
    // the console redirects to its own sign-in, never trusting the member session
    await open(page, "/admin");
    await expect(page).toHaveURL(/\/admin\/login/);
    await adminSignIn(page, ADITYA.email, ADITYA.password);
    await expect(page.getByText(/does not have administrator access/)).toBeVisible();
    const sessions = await portalSessions(page);
    expect(sessions.member?.email).toBe(ADITYA.email);
    expect(sessions.admin).toBeNull();
  });

  test("an admin-only account is refused by the member portal and cannot reach member pages", async ({ page }) => {
    await adminSignIn(page, ADMIN.email, ADMIN.password);
    await expectAdminHome(page);
    await open(page, "/app");
    await expect(page).toHaveURL(/\/login\?next=%2Fapp/);
    await memberSignIn(page, ADMIN.email, ADMIN.password);
    await expect(page.getByText(/does not have a Veye member profile/)).toBeVisible();
    const sessions = await portalSessions(page);
    expect(sessions.admin?.email).toBe(ADMIN.email);
    expect(sessions.member).toBeNull();
  });

  test("dual access: /login gives the member experience, /admin/login gives the console, both sessions coexist and end independently", async ({ page }) => {
    // Member portal first — no redirect to /admin although the account has admin access.
    await memberSignIn(page, DUAL.email, DUAL.password);
    await expectMemberDashboard(page);
    await expect(page.getByRole("heading", { name: `Welcome back ${DUAL.firstName}` })).toBeVisible();
    let sessions = await portalSessions(page);
    expect(sessions.member?.email).toBe(DUAL.email);
    expect(sessions.admin).toBeNull();

    // Admin portal in the same browser — the member session stays.
    await adminSignIn(page, DUAL.email, DUAL.password);
    await expectAdminHome(page);
    sessions = await portalSessions(page);
    expect(sessions.member?.email).toBe(DUAL.email);
    expect(sessions.admin?.email).toBe(DUAL.email);

    // Both applications are open at once.
    await open(page, "/app/progress");
    await expect(page.getByRole("heading", { name: "My Progress" })).toBeVisible();
    await open(page, "/admin/members");
    await expect(page.getByTestId("members-table")).toBeVisible();

    // Sign out of the console: the member session is untouched.
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/admin\/login/);
    sessions = await portalSessions(page);
    expect(sessions.admin).toBeNull();
    expect(sessions.member?.email).toBe(DUAL.email);
    await open(page, "/app");
    await expectMemberDashboard(page);

    // Sign back into the console, then out of the member application: the admin session is untouched.
    await adminSignIn(page, DUAL.email, DUAL.password);
    await expectAdminHome(page);
    await open(page, "/app");
    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page).toHaveURL(/\/$/);
    sessions = await portalSessions(page);
    expect(sessions.member).toBeNull();
    expect(sessions.admin?.email).toBe(DUAL.email);
    await open(page, "/admin");
    await expectAdminHome(page);
  });

  test("a member session cookie presented as an admin cookie authenticates nothing", async ({ page, context }) => {
    await memberSignIn(page, ADITYA.email, ADITYA.password);
    await expectMemberDashboard(page);
    const cookies = await context.cookies();
    const member = cookies.find((c) => c.name === "veye_member_session");
    expect(member).toBeTruthy();
    expect(cookies.find((c) => c.name === "veye_admin_session")).toBeUndefined();
    await context.addCookies([{ ...member!, name: "veye_admin_session" }]);
    const sessions = await portalSessions(page);
    expect(sessions.admin).toBeNull();
    await open(page, "/admin");
    await expect(page).toHaveURL(/\/admin\/login/);
  });
});
