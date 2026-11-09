import { expect, test } from "@playwright/test";
import { ADITYA, ADMIN, ADMIN_TWO, DUAL, freshAdmin } from "../fixtures/accounts";
import { adminSignIn, expectAdminHome, linkFrom, memberSignIn, open, toPath, waitForMail } from "../fixtures/helpers";

/* Administrator provisioning, through the real screens: invite someone from
   Settings → Administrators, pick the invitation out of the mailbox, activate
   the account, and sign in to the same console everybody else gets.

   There are no roles in any of this. The page shows who holds the one
   administrator capability and how; the guards that matter are that nobody
   can switch off their own access and the last administrator cannot be
   switched off either. */

test.describe.serial("Administrators", () => {
  test("an invited administrator activates their account and gets the whole console", async ({ page, browser }) => {
    const invited = freshAdmin();
    await adminSignIn(page, ADMIN.email, ADMIN.password);
    await expectAdminHome(page);

    await open(page, "/admin/settings?section=administrators");
    await expect(page.getByTestId("admins-table")).toBeVisible();
    const before = await page.getByTestId("admins-table").locator("tbody tr").count();

    await page.getByTestId("invite-admin").click();
    await page.getByTestId("invite-first-name").fill(invited.firstName);
    await page.getByTestId("invite-last-name").fill(invited.lastName);
    await page.getByTestId("invite-email").fill(invited.email);
    await page.getByTestId("invite-send").click();
    await expect(page.getByTestId("admins-notice")).toContainText(invited.email);

    const row = page.getByTestId("admins-table").locator("tr", { hasText: invited.email });
    await expect(row).toContainText("Invitation sent");
    await expect(row).toContainText(`by ${ADMIN.firstName}`);
    await expect(page.getByTestId("admins-table").locator("tbody tr")).toHaveCount(before + 1);

    // The invitation email carries the only way in.
    const mail = await waitForMail(invited.email, "invited to the Veye admin console");
    expect(mail.text).toContain("Cara Hogue has invited you");
    const link = toPath(linkFrom(mail.text, "admin/accept-invitation"));

    // A separate browser: the invited person has no session at all.
    const context = await browser.newContext();
    const theirs = await context.newPage();
    await theirs.goto(link);
    await expect(theirs.getByTestId("invitation-for")).toContainText(invited.email);
    await expect(theirs.getByTestId("invitation-for")).toContainText("Cara Hogue");
    // The password is theirs to choose, and it has to be a real one.
    await theirs.locator('input[name="password"]').fill("short");
    await theirs.locator('input[name="confirm"]').fill("short");
    await theirs.getByTestId("accept-submit").click();
    await expect(theirs.locator(".auth__error, .field__error").first()).toContainText(/at least 12/i);
    await theirs.locator('input[name="password"]').fill(invited.password);
    await theirs.locator('input[name="confirm"]').fill(invited.password);
    await theirs.getByTestId("accept-submit").click();
    await expect(theirs.getByTestId("invitation-accepted")).toBeVisible();

    // Activation does not sign anyone in: the portal still decides that.
    await theirs.goto("/admin");
    await expect(theirs).toHaveURL(/\/admin\/login/);
    await adminSignIn(theirs, invited.email, invited.password);
    await expectAdminHome(theirs);
    // The same console as everyone else — not a reduced one.
    for (const path of ["/admin/members", "/admin/requests", "/admin/content", "/admin/settings?section=administrators"]) {
      await open(theirs, path);
      await expect(theirs.locator("#main-content h1")).toBeVisible();
    }
    // …and the member application is still closed to a console-only account.
    await open(theirs, "/app");
    await expect(theirs).toHaveURL(/\/login\?next=%2Fapp/);
    await context.close();

    await open(page, "/admin/settings?section=administrators");
    const accepted = page.getByTestId("admins-table").locator("tr", { hasText: invited.email });
    await expect(accepted).toContainText("Accepted");
    await expect(accepted).toContainText("signed in now");
  });

  test("the link works once, a resend replaces it, and withdrawing kills it", async ({ page, browser }) => {
    const invited = freshAdmin();
    await adminSignIn(page, ADMIN.email, ADMIN.password);
    await expectAdminHome(page);
    await open(page, "/admin/settings?section=administrators");
    await page.getByTestId("invite-admin").click();
    await page.getByTestId("invite-first-name").fill(invited.firstName);
    await page.getByTestId("invite-email").fill(invited.email);
    await page.getByTestId("invite-send").click();
    await expect(page.getByTestId("admins-notice")).toContainText(invited.email);
    const first = await waitForMail(invited.email, "invited to the Veye admin console");

    await page.getByTestId(`resend-${invited.email}`).click();
    await expect(page.getByTestId("admins-notice")).toContainText("fresh invitation");
    await expect.poll(async () => (await waitForMail(invited.email, "invited to the Veye admin console")).text !== first.text,
      { timeout: 15_000 }).toBe(true);
    const second = await waitForMail(invited.email, "invited to the Veye admin console");

    const context = await browser.newContext();
    const theirs = await context.newPage();
    // The superseded link is dead.
    await theirs.goto(toPath(linkFrom(first.text, "admin/accept-invitation")));
    await expect(theirs.getByTestId("invitation-error")).toBeVisible();
    await expect(theirs.getByTestId("accept-submit")).toBeDisabled();

    // Withdrawing the invitation kills the live one as well.
    page.once("dialog", (dialog) => void dialog.accept());
    await page.getByTestId(`revoke-${invited.email}`).click();
    await expect(page.getByTestId("admins-notice")).toContainText("withdrawn");
    await theirs.goto(toPath(linkFrom(second.text, "admin/accept-invitation")));
    await expect(theirs.getByTestId("invitation-error")).toBeVisible();
    await context.close();
  });

  test("nobody can switch off their own access, and the seeded administrators are listed honestly", async ({ page }) => {
    await adminSignIn(page, ADMIN.email, ADMIN.password);
    await expectAdminHome(page);
    await open(page, "/admin/settings?section=administrators");
    const mine = page.getByTestId("admins-table").locator("tr", { hasText: ADMIN.email });
    await expect(mine).toContainText("you");
    await expect(page.getByTestId(`deactivate-${ADMIN.email}`)).toBeDisabled();

    // Every seeded administrator is on the page, with no role or permission column.
    for (const email of [ADMIN.email, ADMIN_TWO.email, DUAL.email]) {
      await expect(page.getByTestId("admins-table").locator("tr", { hasText: email })).toBeVisible();
    }
    const headers = await page.getByTestId("admins-table").locator("thead th").allTextContents();
    expect(headers.join(" ").toLowerCase()).not.toMatch(/role|permission|team/);
    // The dual-access person is marked as also being a member.
    await expect(page.getByTestId("admins-table").locator("tr", { hasText: DUAL.email })).toContainText("Also a Veye member");
  });

  test("deactivating an administrator ends their session immediately", async ({ page, browser }) => {
    const invited = freshAdmin();
    await adminSignIn(page, ADMIN.email, ADMIN.password);
    await expectAdminHome(page);
    await open(page, "/admin/settings?section=administrators");
    await page.getByTestId("invite-admin").click();
    await page.getByTestId("invite-first-name").fill(invited.firstName);
    await page.getByTestId("invite-email").fill(invited.email);
    await page.getByTestId("invite-send").click();
    await expect(page.getByTestId("admins-notice")).toContainText(invited.email);

    const mail = await waitForMail(invited.email, "invited to the Veye admin console");
    const context = await browser.newContext();
    const theirs = await context.newPage();
    await theirs.goto(toPath(linkFrom(mail.text, "admin/accept-invitation")));
    await theirs.locator('input[name="password"]').fill(invited.password);
    await theirs.locator('input[name="confirm"]').fill(invited.password);
    await theirs.getByTestId("accept-submit").click();
    await expect(theirs.getByTestId("invitation-accepted")).toBeVisible();
    await adminSignIn(theirs, invited.email, invited.password);
    await expectAdminHome(theirs);

    await open(page, "/admin/settings?section=administrators");
    page.once("dialog", (dialog) => void dialog.accept());
    await page.getByTestId(`deactivate-${invited.email}`).click();
    await expect(page.getByTestId("admins-notice")).toContainText("deactivated");
    await expect(page.getByTestId("admins-table").locator("tr", { hasText: invited.email })).toContainText("Deactivated");

    // The cookie they are holding is worthless from this moment.
    await theirs.goto("/admin/members");
    await expect(theirs).toHaveURL(/\/admin\/login/);
    await adminSignIn(theirs, invited.email, invited.password);
    await expect(theirs.locator(".auth__error, .field__error").first()).toBeVisible();
    await expect(theirs).toHaveURL(/\/admin\/login/);

    await page.getByTestId(`reactivate-${invited.email}`).click();
    await expect(page.getByTestId("admins-notice")).toContainText("can use the console again");
    await adminSignIn(theirs, invited.email, invited.password);
    await expectAdminHome(theirs);
    await context.close();
  });

  test("a member session can never reach the Administrators page", async ({ page }) => {
    await memberSignIn(page, ADITYA.email, ADITYA.password);
    await open(page, "/admin/settings?section=administrators");
    await expect(page).toHaveURL(/\/admin\/login/);
    await expect(page.getByTestId("admins-table")).toHaveCount(0);
  });
});
