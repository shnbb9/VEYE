import { expect, test } from "@playwright/test";
import { ADMIN, API_URL, freshMember } from "../fixtures/accounts";
import { adminSignIn, expectAdminHome, memberApi, memberSignIn, open, signUpMember } from "../fixtures/helpers";

/* Deleting a member profile (architecture V2 §6): what goes and what stays is
   shown first; the password and the typed word are both required; access
   ends at once; the public status page works by reference after the session
   is gone; the account cannot sign in again and the console cannot find it. */

test.describe("deleting a member profile", () => {
  test("is explained first, needs proof, and ends access everywhere", async ({ browser }) => {
    const member = freshMember("gone");
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    await signUpMember(page, member);
    const { member: account } = await memberApi<{ member: { member_id: string } }>(page, "/api/v1/auth/me");

    await open(page, "/app/settings");
    await page.getByTestId("delete-profile-open").click();
    const dialog = page.getByTestId("delete-profile-dialog");
    await expect(dialog.getByTestId("delete-profile-removed")).toContainText("Health Number");
    await expect(dialog.getByTestId("delete-profile-kept")).toContainText("minimal record");
    await expect(dialog.getByTestId("delete-profile-submit")).toBeDisabled();

    await dialog.getByTestId("delete-profile-password").fill("not-the-password");
    await dialog.getByTestId("delete-profile-confirm").fill("DELETE");
    await dialog.getByTestId("delete-profile-submit").click();
    await expect(dialog.getByTestId("delete-profile-error")).toContainText("not right");
    expect((await memberApi<{ member: unknown }>(page, "/api/v1/auth/me")).member, "nothing happened yet").not.toBeNull();

    await dialog.getByTestId("delete-profile-password").fill(member.password);
    const erased = page.waitForResponse((r) => r.url().endsWith("/api/v1/members/me/erasure") && r.request().method() === "POST");
    await dialog.getByTestId("delete-profile-submit").click();
    expect((await erased).status()).toBe(202);
    await expect(page).toHaveURL(/\/account-deleted\?ref=/);
    await expect(page.getByTestId("account-deleted-state")).toContainText("Deleted");
    const ref = await page.getByTestId("account-deleted-ref").innerText();
    expect(ref).toMatch(/^[0-9a-f-]{36}$/);

    // The session is gone, and so is the account.
    const me = await page.request.get(`${API_URL}/api/v1/auth/me`);
    expect((await me.json()).member).toBeNull();
    await memberSignIn(page, member.email, member.password);
    await expect(page.getByRole("alert").filter({ hasText: /do not match/ })).toBeVisible();
    await expect(page).toHaveURL(/\/login/);

    // The console cannot open it.
    const admin = await (await browser.newContext()).newPage();
    await adminSignIn(admin, ADMIN.email, ADMIN.password);
    await expectAdminHome(admin);
    const profile = await admin.request.get(`${API_URL}/api/v1/admin/members/${account.member_id}`);
    expect(profile.status()).toBe(404);
    const oversight = await admin.request.get(`${API_URL}/api/v1/admin/erasure-requests`);
    const rows = (await oversight.json()) as { request_id: string; state: string }[];
    expect(rows.find((r) => r.request_id === ref)?.state).toBe("erased");
  });
});
