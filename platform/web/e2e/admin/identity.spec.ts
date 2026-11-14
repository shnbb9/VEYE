import { expect, test, type Browser, type Page } from "@playwright/test";
import { ADMIN, API_URL, freshAdmin } from "../fixtures/accounts";
import { adminSignIn, csrfHeaders, expectAdminHome, linkFrom, memberSignIn, open, portalSessions, toPath, waitForMail } from "../fixtures/helpers";

/* One person, two portals, one picture (architecture V2 §5): an administrator
   adds and removes their own picture, then gives the same account its own
   member profile, which opens the member door with their own records only.
   The spec deletes that member profile again at the end, leaving a plain
   invited console account that the global teardown removes. */

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNwSRX5DwADawG9SIxpvAAAAABJRU5ErkJggg==", "base64");

async function invitedAdministrator(browser: Browser) {
  const person = freshAdmin("invited");
  const cara = await (await browser.newContext()).newPage();
  await adminSignIn(cara, ADMIN.email, ADMIN.password);
  await expectAdminHome(cara);
  const invited = await cara.request.post(`${API_URL}/api/v1/admin/administrators/invite`, {
    data: { email: person.email, first_name: person.firstName, last_name: person.lastName },
    headers: await csrfHeaders(cara.request),
  });
  expect(invited.status()).toBe(201);
  const mail = await waitForMail(person.email, "invited to the Veye admin console");
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await page.goto(toPath(linkFrom(mail.text, "admin/accept-invitation")));
  await page.locator('input[name="password"]').fill(person.password);
  await page.locator('input[name="confirm"]').fill(person.password);
  await page.getByTestId("accept-submit").click();
  await expect(page.getByTestId("invitation-accepted")).toBeVisible();
  await adminSignIn(page, person.email, person.password);
  await expectAdminHome(page);
  return { person, page, cara };
}

test.describe("an administrator's own account", () => {
  test("adds, keeps and removes their own picture, and only their own", async ({ browser }) => {
    const { page, cara } = await invitedAdministrator(browser);
    await open(page, "/admin/settings?section=account");
    await expect(page.getByTestId("settings-admin-initials")).toBeVisible();
    const uploaded = page.waitForResponse((r) => r.url().endsWith("/api/v1/admin/account/photo") && r.request().method() === "POST");
    await page.getByTestId("admin-photo-input").setInputFiles({ name: "me.png", mimeType: "image/png", buffer: PNG });
    expect((await uploaded).status()).toBe(201);
    await expect(page.getByTestId("settings-admin-photo")).toBeVisible();
    await expect(page.getByTestId("admin-chrome-photo")).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("settings-admin-photo")).toBeVisible();
    // Cara's own picture is untouched by this administrator's upload.
    const caraAccount = await cara.request.get(`${API_URL}/api/v1/auth/me`);
    expect((await caraAccount.json()).admin.photo_version ?? null).toBeNull();

    await page.getByTestId("admin-photo-input").setInputFiles({ name: "x.png", mimeType: "image/png", buffer: Buffer.from("not an image") });
    await expect(page.getByTestId("admin-photo-note")).toContainText(/JPG, PNG or WebP|could not be read/);

    await page.getByTestId("admin-photo-remove").click();
    await expect(page.getByTestId("settings-admin-initials")).toBeVisible();
  });

  test("creates their own member profile on the same account, and the member door shows only their records", async ({ browser }) => {
    const { person, page } = await invitedAdministrator(browser);
    await open(page, "/admin/settings?section=account");
    await page.getByTestId("create-member-profile").click();
    await expect(page.getByTestId("member-profile-submit")).toBeDisabled();
    await page.getByTestId("member-profile-understood").check();
    await page.getByTestId("member-profile-password").fill("not-the-password");
    await page.getByTestId("member-profile-submit").click();
    await expect(page.getByRole("alert").filter({ hasText: "not right" })).toBeVisible();
    await page.getByTestId("member-profile-password").fill(person.password);
    const created = page.waitForResponse((r) => r.url().endsWith("/api/v1/admin/account/member-profile"));
    await page.getByTestId("member-profile-submit").click();
    expect((await created).status()).toBe(201);
    await expect(page.getByTestId("member-profile-done")).toBeVisible();

    // The same email and password open the member application — separately.
    const memberDoor = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    await memberSignIn(memberDoor, person.email, person.password);
    await expect(memberDoor).toHaveURL(/\/app/);
    const sessions = await portalSessions(memberDoor);
    expect(sessions.member?.email).toBe(person.email);
    expect(sessions.admin).toBeNull();
    const history = await memberDoor.request.get(`${API_URL}/api/v1/members/me/health-number`);
    expect((await history.json()).history).toEqual([]);
    // The console session is still the console session.
    expect((await portalSessions(page)).admin?.email).toBe(person.email);

    // Tidy up through the product's own deletion: member data only — the
    // console access survives, which is itself the dual-access guarantee.
    await open(memberDoor, "/app/settings");
    await memberDoor.getByTestId("delete-profile-open").click();
    await expect(memberDoor.getByTestId("delete-profile-kept")).toContainText("console access");
    await memberDoor.getByTestId("delete-profile-password").fill(person.password);
    await memberDoor.getByTestId("delete-profile-confirm").fill("DELETE");
    await memberDoor.getByTestId("delete-profile-submit").click();
    await expect(memberDoor).toHaveURL(/\/account-deleted\?ref=/);
    await expect(memberDoor.getByTestId("account-deleted")).toContainText("administrator access to the Veye console is unchanged");
    await page.reload();
    await expect(page.getByTestId("settings-member-access")).toContainText("do not have a member profile");
  });
});
