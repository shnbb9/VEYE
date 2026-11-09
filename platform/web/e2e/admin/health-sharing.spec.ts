import { expect, test } from "@playwright/test";
import { ADMIN, freshMember } from "../fixtures/accounts";
import { adminSignIn, expectAdminHome, memberApi, open, signUpMember } from "../fixtures/helpers";

/* Health Data Sharing Permission, through both portals.

   The assertions that matter are the API's own answers, not what the screens
   show: a console that is merely *shown* less has protected nothing. So each
   stage reads /api/v1/admin/members/{id} directly as well as looking at the
   page. */

type Member360 = {
  shares_health_data: boolean;
  sharing_state: string;
  health_number: unknown[];
  mood_entries: unknown[];
  profile: { health_number: number | null; email: string };
};

test.describe.serial("Health Data Sharing Permission", () => {
  const member = freshMember("probe");

  test("a new member shares nothing until they say so, and withdrawing closes it again", async ({ browser, page }) => {
    const memberContext = await browser.newContext();
    const memberPage = await memberContext.newPage();
    await signUpMember(memberPage, member);

    await adminSignIn(page, ADMIN.email, ADMIN.password);
    await expectAdminHome(page);
    await open(page, "/admin/members");
    await page.getByPlaceholder(/name|email|search/i).first().fill(member.email);
    const row = page.locator("tbody tr", { hasText: member.email }).first();
    await expect(row).toBeVisible();
    const href = await row.getByRole("link").first().getAttribute("href");
    const memberId = (href ?? "").split("/").pop() ?? "";
    expect(memberId).toMatch(/^[0-9a-f-]{36}$/);

    const read = async (): Promise<Member360> =>
      (await (await page.request.get(`${process.env.E2E_API_URL ?? "http://localhost:8001"}/api/v1/admin/members/${memberId}`)).json()) as Member360;

    // 1. Nothing shared, and the console is told why its tabs are empty.
    const before = await read();
    expect(before.shares_health_data).toBe(false);
    expect(before.sharing_state).toBe("not_requested");
    expect(before.health_number).toEqual([]);
    expect(before.profile.health_number).toBeNull();
    // Identity is not locked: the team still has to be able to answer them.
    expect(before.profile.email).toBe(member.email);

    await open(page, `/admin/members/${memberId}`);
    await expect(page.getByTestId("sharing-banner")).toContainText("Health records are not shared");
    await expect(page.getByTestId("sharing-ask")).toBeEnabled();

    // 2. The console asks. That is all it can do.
    await page.getByTestId("sharing-ask").click();
    await expect(page.getByTestId("sharing-ask")).toBeDisabled();
    expect((await read()).sharing_state).toBe("requested");
    expect((await read()).shares_health_data).toBe(false);

    // 3. The member decides, in their own application.
    await open(memberPage, "/app/settings");
    await expect(memberPage.getByTestId("health-sharing-state")).toContainText("Awaiting your decision");
    await memberPage.getByTestId("health-sharing-grant").click();
    await expect(memberPage.getByTestId("health-sharing-state")).toContainText("Shared with the Veye team");

    const shared = await read();
    expect(shared.shares_health_data).toBe(true);
    expect(shared.sharing_state).toBe("granted");

    // 4. Withdrawing re-locks on the very next request, not when something expires.
    await memberPage.getByTestId("health-sharing-revoke").click();
    await expect(memberPage.getByTestId("health-sharing-state")).toContainText("Withdrawn");

    const after = await read();
    expect(after.shares_health_data).toBe(false);
    expect(after.sharing_state).toBe("revoked");
    expect(after.health_number).toEqual([]);
    expect(after.mood_entries).toEqual([]);
    expect(after.profile.health_number).toBeNull();

    // The member keeps the evidence of every step.
    const mine = await memberApi<{ events: { to_state: string; actor: string; source: string }[] }>(
      memberPage, "/api/v1/members/me/health-permission");
    expect(mine.events.map((e) => e.to_state)).toEqual(["requested", "granted", "revoked"]);
    expect(mine.events.map((e) => e.actor)).toEqual(["administrator", "member", "member"]);
    expect(mine.events.map((e) => e.source)).toEqual(["admin_console", "member_app", "member_app"]);

    await memberContext.close();
  });

  test("the member-facing words never call it a HIPAA authorization", async ({ browser }) => {
    const context = await browser.newContext();
    const memberPage = await context.newPage();
    const other = freshMember("probe");
    await signUpMember(memberPage, other);
    await open(memberPage, "/app/settings");
    const card = memberPage.getByTestId("health-sharing");
    await expect(card).toBeVisible();
    const words = ((await card.textContent()) ?? "").toLowerCase();
    expect(words).not.toContain("hipaa");
    expect(words).not.toContain("authorization");
    expect(words).not.toContain("authorisation");
    await context.close();
  });
});
