import { expect, test } from "@playwright/test";
import { ADMIN, freshMember } from "../fixtures/accounts";
import { confirmDialog, adminSignIn, expectAdminHome, expectMemberDashboard, expectNoHorizontalOverflow, linkFrom, memberApi, memberSignIn, open, toPath, waitForMail } from "../fixtures/helpers";

/* Add a member (Cara, 15 Nov 2026), through the real screens and a real
   mailbox: the console sends an address an invitation, the person opens it,
   chooses a password, lands on their own empty dashboard — and nothing about
   their health is visible to anyone. */

test("an invitation becomes a member with their own empty dashboard; every other use of the link is refused in words", async ({ page, browser }) => {
  const person = freshMember("invited");
  await adminSignIn(page, ADMIN.email, ADMIN.password);
  await expectAdminHome(page);
  await open(page, "/admin/members");
  await page.getByTestId("add-member").click();
  await page.getByLabel(/^Email address/).fill(person.email);
  await page.getByLabel("First name").fill(person.firstName);
  await page.getByTestId("invite-member-send").click();
  await expect(page).toHaveURL(/\/admin\/members\/invitations/);
  await expect(page.getByTestId("invitations-notice")).toContainText(`on its way to ${person.email}`);
  const row = page.getByTestId("invitation-row").filter({ hasText: person.email });
  await expect(row).toContainText("Pending");
  await expect(row.getByTestId("invitation-delivery")).toContainText("Email sent");

  // The same address again is refused, and the drawer says why.
  await page.getByTestId("add-member").click();
  await page.getByLabel(/^Email address/).fill(person.email.toUpperCase());
  await page.getByTestId("invite-member-send").click();
  await expect(page.getByTestId("invite-member-form").getByRole("alert")).toContainText("already has an invitation");
  await page.keyboard.press("Escape");

  // Sending it again retires the first link.
  const first = toPath(linkFrom((await waitForMail(person.email, "You are invited to Veye")).text, "accept-invitation"));
  await row.getByTestId("invitation-resend").click();
  await expect(row).toContainText("sent 2 times");
  await expect.poll(async () => toPath(linkFrom((await waitForMail(person.email, "You are invited to Veye")).text, "accept-invitation"))).not.toBe(first);
  const second = toPath(linkFrom((await waitForMail(person.email, "You are invited to Veye")).text, "accept-invitation"));

  const theirs = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await theirs.goto(first);
  await expect(theirs.getByTestId("member-invitation-error")).toContainText("not valid any more");
  await theirs.goto(second);
  await expect(theirs.getByTestId("member-invitation-for")).toContainText(person.email);
  await expect(theirs, "the token leaves the address bar").toHaveURL(/\/accept-invitation$/);
  await expectNoHorizontalOverflow(theirs);
  await theirs.locator('input[name="password"]').fill("short");
  await theirs.locator('input[name="confirm"]').fill("short");
  await theirs.getByTestId("accept-member-submit").click();
  await expect(theirs.locator(".auth__error")).toContainText("at least 12 characters");
  await theirs.locator('input[name="password"]').fill(person.password);
  await theirs.locator('input[name="confirm"]').fill(person.password);
  await theirs.getByTestId("accept-member-submit").click();
  await expectMemberDashboard(theirs);
  await expect(theirs.getByRole("link", { name: "Take the assessment", exact: true })).toBeVisible();
  expect((await memberApi<{ state: string }>(theirs, "/api/v1/members/me/health-permission")).state).toBe("not_requested");
  await theirs.reload();
  await expectMemberDashboard(theirs);

  // Used: the link opens nothing more, and the password they chose works.
  const again = await (await browser.newContext()).newPage();
  await again.goto(second);
  await expect(again.getByTestId("member-invitation-error")).toContainText("already been used");
  await memberSignIn(again, person.email, person.password);
  await expectMemberDashboard(again);
  await again.context().close();

  await page.reload();
  const accepted = page.getByTestId("invitation-row").filter({ hasText: person.email });
  await expect(accepted).toContainText("Accepted");
  await accepted.getByRole("link", { name: /Open member/ }).click();
  await expect(page.getByTestId("sharing-banner")).toContainText("Health records are not shared");
  await theirs.context().close();
});

test("a withdrawn invitation opens nothing", async ({ page, browser }) => {
  const person = freshMember("invited");
  await adminSignIn(page, ADMIN.email, ADMIN.password);
  await expectAdminHome(page);
  await open(page, "/admin/members/invitations");
  await page.getByTestId("add-member").click();
  await page.getByLabel(/^Email address/).fill(person.email);
  await page.getByTestId("invite-member-send").click();
  const row = page.getByTestId("invitation-row").filter({ hasText: person.email });
  await expect(row).toContainText("Pending");
  const link = toPath(linkFrom((await waitForMail(person.email, "You are invited to Veye")).text, "accept-invitation"));
  await row.getByTestId("invitation-revoke").click();
  await confirmDialog(page);
  await expect(row).toContainText("Withdrawn");
  const theirs = await (await browser.newContext()).newPage();
  await theirs.goto(link);
  await expect(theirs.getByTestId("member-invitation-error")).toBeVisible();
  await theirs.context().close();
});
