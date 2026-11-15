import { expect, test } from "@playwright/test";
import { ADITYA, ADMIN, API_URL, DUAL, freshMember } from "./fixtures/accounts";
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

/* The page at one name for this computer, the API at another (127.0.0.1 and
   localhost): the browser counts them as two sites and drops the session
   cookie although the API accepted the password. The screen has to say why
   nothing opened, and where it will — the sign-in form used to come back with
   no word at all (15 Nov 2026). */
test.describe("A sign-in this browser could not keep", () => {
  test("signing in from 127.0.0.1 says why the session did not stay, and links to the address that works", async ({ page, baseURL }) => {
    const site = new URL(baseURL!);
    test.skip(site.hostname !== "localhost" || new URL(API_URL).hostname !== "localhost", "needs the page and the API both on localhost");
    const elsewhere = `${site.protocol}//127.0.0.1:${site.port}`;
    const dropped = page.getByRole("alert").filter({ hasText: "did not keep the sign-in" });

    // The console's door. "Remember me" off: the session the browser drops
    // should not outlive the test by weeks.
    await open(page, `${elsewhere}/admin/login`);
    await page.getByLabel(/Email address/).fill(ADMIN.email);
    await page.getByLabel(/^Password/).fill(ADMIN.password);
    await page.getByText("Remember me").click();
    await expect(page.locator("#admin-remember")).not.toBeChecked();
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(dropped).toContainText("Your password was accepted, but this browser did not keep the sign-in, because this page is open at 127.0.0.1 rather than localhost.");
    await expect(dropped.getByRole("link", { name: `Continue at ${site.origin}/admin/login` })).toHaveAttribute("href", `${site.origin}/admin/login`);
    await expect(page).toHaveURL(`${elsewhere}/admin/login`);

    // The member door says the same, and its link leads somewhere that works.
    await open(page, `${elsewhere}/login`);
    await page.getByLabel("Your Email").fill(ADITYA.email);
    await page.getByPlaceholder("Your Password").fill(ADITYA.password);
    await page.getByText("Remember me").click();
    await expect(page.locator('input[name="remember"]')).not.toBeChecked();
    await page.getByRole("button", { name: "Login" }).click();
    await expect(dropped).toContainText("because this page is open at 127.0.0.1 rather than localhost.");
    await dropped.getByRole("link", { name: `Continue at ${site.origin}/login` }).click();
    await expect(page).toHaveURL(`${site.origin}/login`);
    await memberSignIn(page, ADITYA.email, ADITYA.password);
    await expectMemberDashboard(page);
  });

  test("signing up from 127.0.0.1 says the account exists, and where to sign in to it", async ({ page, baseURL }) => {
    const site = new URL(baseURL!);
    test.skip(site.hostname !== "localhost" || new URL(API_URL).hostname !== "localhost", "needs the page and the API both on localhost");
    const elsewhere = `${site.protocol}//127.0.0.1:${site.port}`;
    const member = freshMember("signup");

    await open(page, `${elsewhere}/signup`);
    await page.getByLabel("First name").fill(member.firstName);
    await page.getByLabel("Last name").fill(member.lastName);
    await page.getByLabel("Email", { exact: true }).fill(member.email);
    await page.getByPlaceholder("Enter your password").fill(member.password);
    await page.getByPlaceholder("Confirm your password").fill(member.password);
    await page.getByRole("button", { name: "Sign Up" }).click();
    const dropped = page.getByRole("alert").filter({ hasText: "did not keep the sign-in" });
    await expect(dropped).toContainText("Your account was created, but this browser did not keep the sign-in, because this page is open at 127.0.0.1 rather than localhost.");
    await expect(page).toHaveURL(`${elsewhere}/signup`);

    // The link goes to the sign-in at the address that works, and the new
    // account is there to sign in to.
    await dropped.getByRole("link", { name: `Continue at ${site.origin}/login` }).click();
    await expect(page).toHaveURL(`${site.origin}/login`);
    await memberSignIn(page, member.email, member.password);
    await expect.poll(async () => (await portalSessions(page)).member?.email).toBe(member.email);
  });
});
