import { expect, test, type Browser, type Page } from "@playwright/test";
import { ADMIN, freshMember } from "../fixtures/accounts";
import { adminSignIn, expectAdminHome, linkFrom, memberApi, open, signUpMember, toPath, waitForMail } from "../fixtures/helpers";

/* The console asks; the member is told by email; the button opens the app
   and decides nothing; the member decides on the consent screen, with every
   element in view and two equal choices (architecture V2 §4). */

const SUBJECT = "VEYE: Review a request to share your health information";

async function verifiedMember(browser: Browser) {
  const member = freshMember("probe");
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await signUpMember(page, member);
  const verify = await waitForMail(member.email, "Verify your Veye email address");
  await open(page, toPath(linkFrom(verify.text, "verify-email")));
  await expect(page.getByText("Your email address is verified.")).toBeVisible();
  const me = await memberApi<{ member: { member_id: string } }>(page, "/api/v1/auth/me");
  return { member, page, memberId: me.member.member_id };
}

async function console(browser: Browser): Promise<Page> {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await adminSignIn(page, ADMIN.email, ADMIN.password);
  await expectAdminHome(page);
  return page;
}

test.describe("a request to share health records", () => {
  test("asked from Member 360, emailed, and decided by the member on the consent screen", async ({ browser }) => {
    const { member, page, memberId } = await verifiedMember(browser);
    const admin = await console(browser);

    await open(admin, `/admin/members/${memberId}`);
    const asked = admin.waitForResponse((r) => r.url().endsWith(`/members/${memberId}/health-permission/request`));
    await admin.getByTestId("sharing-ask").click();
    expect((await asked).status()).toBe(200);
    await expect(admin.getByTestId("sharing-delivery")).toContainText("Email delivered");

    const mail = await waitForMail(member.email, SUBJECT);
    expect(mail.text).toContain("Review sharing request");
    expect(mail.text).toContain("does not share anything");
    const link = toPath(linkFrom(mail.text, "app/settings"));
    expect(link).toMatch(/^\/app\/settings\?section=privacy&request=[\w-]{20,}$/);

    // Opening the link changes nothing by itself.
    await open(page, link);
    await expect(page).toHaveURL(/\/app\/sharing-request\?request=/);
    const before = await memberApi<{ state: string }>(page, "/api/v1/members/me/health-permission");
    expect(before.state).toBe("requested");

    const screen = page.getByTestId("sharing-request");
    await expect(screen.getByTestId("sharing-request-categories").getByRole("listitem")).toHaveCount(6);
    await expect(screen).toContainText("For how long");
    await expect(screen).toContainText("What is not covered");
    await expect(screen).toContainText("If you don’t allow it");
    const allow = screen.getByTestId("sharing-allow");
    const deny = screen.getByTestId("sharing-deny");
    // Equal choices: same size and the same visual weight.
    const [a, d] = [await allow.boundingBox(), await deny.boundingBox()];
    expect(Math.abs((a?.height ?? 0) - (d?.height ?? 0))).toBeLessThanOrEqual(1);
    expect(await allow.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(await deny.evaluate((el) => getComputedStyle(el).backgroundColor));

    const granted = page.waitForResponse((r) => r.url().endsWith("/health-permission/grant"));
    await allow.click();
    expect((await granted).status()).toBe(200);
    await expect(page.getByTestId("sharing-request-decided")).toContainText("Shared with the Veye team");

    await admin.reload();
    await expect(admin.getByTestId("sharing-banner")).toContainText("Shared with the Veye team");
    const evidence = await memberApi<{ events: { to_state: string; terms_hash: string | null; scope: string[] | null }[] }>(page, "/api/v1/members/me/health-permission");
    const decision = evidence.events.find((e) => e.to_state === "granted");
    expect(decision?.terms_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(decision?.scope?.length).toBe(6);
  });

  test("the link does nothing for another member", async ({ browser }) => {
    const { member, memberId } = await verifiedMember(browser);
    const admin = await console(browser);
    await open(admin, `/admin/members/${memberId}`);
    await admin.getByTestId("sharing-ask").click();
    await expect(admin.getByTestId("sharing-delivery")).toBeVisible();
    const link = toPath(linkFrom((await waitForMail(member.email, SUBJECT)).text, "app/settings"));

    const other = await verifiedMember(browser);
    await open(other.page, link);
    await expect(other.page.getByTestId("sharing-request-problem")).toContainText("not for this account");
    const theirs = await memberApi<{ state: string }>(other.page, "/api/v1/members/me/health-permission");
    expect(theirs.state).toBe("not_requested");
  });

  test("an unverified member cannot be asked, and the console says why", async ({ browser }) => {
    const member = freshMember("probe");
    const page = await (await browser.newContext()).newPage();
    await signUpMember(page, member);
    const me = await memberApi<{ member: { member_id: string } }>(page, "/api/v1/auth/me");
    const admin = await console(browser);
    await open(admin, `/admin/members/${me.member.member_id}`);
    await expect(admin.getByTestId("sharing-cannot-ask")).toContainText("not verified");
    await expect(admin.getByTestId("sharing-ask")).toBeDisabled();
  });
});
