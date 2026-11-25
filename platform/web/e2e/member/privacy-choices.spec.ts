import { expect, test, type Browser, type Page } from "@playwright/test";
import { ADITYA, ADMIN, API_URL, freshMember, MAYA, NOOR, TARA } from "../fixtures/accounts";
import {
  adminSignIn, confirmDialog, expectAdminHome, expectMemberDashboard, expectNoHorizontalOverflow, memberApi, memberSignIn, open, sendAs, signUpMember, verifyAddress,
} from "../fixtures/helpers";

/* Two choices that do not know about each other (owner decision, 25 Nov 2026):
   A, the Veye team may see my health information; B, Sprout may use it.

   Every state is asserted where it matters, which is not the switch: what the
   console is sent, and what Sprout says it used. The switch is checked against
   those. */

const QUESTION = "Explain what my Health Number means";
const ANSWERS = {
  goals: ["Live a Healthier Lifestyle"], plans: ["No other plans"], activity: "Moderate (I exercise 1-3 times a week)", meditate: "no", tired: "no",
  gainWeight: "no", abdomenWeight: "no", sleepEnough: "yes", sleepWell: "yes", sleepHours: 7, diet: "No preference", source: "Friends or Family",
};

type Sprout = { state: string; personalizes: boolean; authorized_at: string | null; revoked_at: string | null; policy_version: string | null;
  email_verified: boolean; terms: { version: number; hash: string }; events: { to_state: string; policy_version: string | null }[] };
type Team = { state: string; shares_health_data: boolean };
type Asked = { health_context: string; reply: string; context_scopes: string[]; conversation_id: string; provider: string | null };

async function member(browser: Browser, { verified = true, viewport = { width: 1440, height: 1000 } } = {}) {
  const account = freshMember("e2e");
  const page = await (await browser.newContext({ viewport })).newPage();
  await signUpMember(page, account);
  if (verified) await verifyAddress(page, account.email);
  const result = await sendAs(page, "POST", "/api/v1/health-number/calculate", { answers: ANSWERS });
  expect(result.status, JSON.stringify(result.body)).toBe(201);
  const me = await memberApi<{ member: { member_id: string } }>(page, "/api/v1/auth/me");
  return { account, page, id: me.member.member_id };
}

async function console(browser: Browser): Promise<Page> {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
  await adminSignIn(page, ADMIN.email, ADMIN.password);
  await expectAdminHome(page);
  return page;
}

const sprout = (page: Page) => memberApi<Sprout>(page, "/api/v1/members/me/sprout-permission");
const team = (page: Page) => memberApi<Team>(page, "/api/v1/members/me/health-permission");
const seen = async (admin: Page, id: string) =>
  (await (await admin.request.get(`${API_URL}/api/v1/admin/members/${id}`)).json()) as { shares_health_data: boolean; health_number: unknown[]; profile: { health_number: number | null } };
const ask = async (page: Page) => {
  const sent = await sendAs<Asked>(page, "POST", "/api/v1/companion/messages", { message: QUESTION, conversation_id: null });
  expect(sent.status, JSON.stringify(sent.body)).toBe(201);
  return sent.body;
};

async function openChoices(page: Page) {
  await open(page, "/app/settings");
  await expect(page.getByTestId("sprout-state")).toBeVisible();
  await expect(page.getByTestId("health-sharing-state")).toBeVisible();
}
async function turnOn(page: Page) {
  await page.getByTestId("sprout-review").click();
  await expect(page.getByTestId("sprout-terms")).toBeVisible();
  await page.getByTestId("sprout-turn-on").click();
  await expect(page.getByTestId("sprout-state")).toContainText("On, since");
}
async function share(page: Page) {
  await page.getByTestId("health-sharing-review").click();
  await expect(page).toHaveURL(/\/app\/sharing-request/);
  await page.getByTestId("sharing-allow").click();
  await expect(page.getByTestId("sharing-request-decided")).toContainText("Shared with the Veye team");
}

test.describe("two separate choices", () => {
  test("neither, the team only, both, Sprout only, neither: each changes exactly what it says", async ({ browser }) => {
    const { page, id } = await member(browser);
    const admin = await console(browser);
    const check = async (what: string, sharing: boolean, personal: boolean) => {
      expect([(await team(page)).shares_health_data, (await sprout(page)).personalizes], what).toEqual([sharing, personal]);
      const console = await seen(admin, id);
      expect([console.shares_health_data, console.health_number.length > 0, console.profile.health_number !== null], `${what}: the console`).toEqual([sharing, sharing, sharing]);
      const answer = await ask(page);
      expect([answer.health_context, answer.context_scopes.length > 0], `${what}: Sprout`).toEqual([personal ? "used" : "off", personal]);
      // Their own copy is theirs whatever they chose.
      expect((await memberApi<{ history: unknown[] }>(page, "/api/v1/members/me/health-number")).history.length, what).toBeGreaterThan(0);
      return answer;
    };

    await openChoices(page);
    await expect(page.getByTestId("two-choices")).toContainText("Saying yes to one never says yes to the other");
    await expect(page.getByTestId("sprout-state")).toContainText("Off. Sprout answers without your health information.");
    await check("neither", false, false);

    await share(page);
    await check("the team only", true, false);
    await openChoices(page);
    await expect(page.getByTestId("sprout-state")).toContainText("Off.");

    await turnOn(page);
    await check("both", true, true);

    await page.getByTestId("health-sharing-revoke").click();
    expect(await confirmDialog(page)).toContain("Stop sharing with the Veye team?");
    await expect(page.getByTestId("health-sharing-state")).toContainText("Withdrawn");
    const withheld = await check("Sprout only", false, true);
    await expect(page.getByTestId("sprout-state")).toContainText("On, since");

    // What Sprout wrote from their records is not a way round their answer to the team.
    await open(admin, `/admin/companion/conversations?conversation=${withheld.conversation_id}`);
    const stored = await (await admin.request.get(`${API_URL}/api/v1/admin/companion/conversations/${withheld.conversation_id}`)).json();
    const replies = (stored.messages as { role: string; content: string; withheld: boolean }[]).filter((m) => m.role === "sprout");
    expect(replies.filter((m) => m.withheld).length).toBeGreaterThan(0);
    for (const reply of replies.filter((m) => m.withheld)) expect(reply.content).toBe("Hidden. Sprout wrote this from health information this member does not share with the team.");
    expect(replies.map((m) => m.content)).not.toContain(withheld.reply);
    await expect(admin.getByTestId("reply-withheld").first()).toBeVisible();

    // Turning it off is one press, with no question and nothing to verify.
    await page.getByTestId("sprout-turn-off").click();
    await expect(page.getByTestId("sprout-state")).toContainText("Off. You turned it off on");
    await check("neither again", false, false);

    // And every step of both is there to read, each in its own list.
    await page.reload();
    await page.getByTestId("sprout-history").locator("summary").click();
    await expect(page.getByTestId("sprout-history").locator("li")).toHaveText([/turned personalization off/, /turned personalization on/]);
    await page.getByTestId("health-sharing-history").locator("summary").click();
    await expect(page.getByTestId("health-sharing-history").locator("li")).toHaveText([/stopped sharing/, /started sharing/]);
    const mine = await sprout(page);
    expect(mine.events.map((e) => e.to_state)).toEqual(["on", "turned_off"]);
    expect(mine.policy_version).toMatch(/^sprout-personalization-/);
    await page.context().close();
    await admin.context().close();
  });

  test("everything agreed to is read first, and keeping it off is as easy as turning it on", async ({ browser }) => {
    const { page } = await member(browser);
    await openChoices(page);
    const there = page.locator('.settings-help a[href="#privacy"]');
    await expect(there, "part of its sentence, not a box in the middle of it").toHaveCSS("display", "inline");
    await there.click();
    await expect(page.getByTestId("two-choices")).toBeInViewport();
    const card = page.getByTestId("sprout-permission");
    await expect(page.getByTestId("sprout-turn-on")).toBeHidden();
    await page.getByTestId("sprout-review").click();
    const terms = page.getByTestId("sprout-terms");
    for (const heading of ["Why", "What Sprout would use", "An outside AI company", "For how long", "When it is off"]) await expect(terms.getByRole("heading", { name: heading })).toBeVisible();
    await expect(terms).toContainText("Version");
    const words = ((await card.textContent()) ?? "").toLowerCase();
    for (const never of ["hipaa", "authorization", "authorisation", "phi"]) expect(words).not.toMatch(new RegExp(`\\b${never}\\b`));
    const [yes, no] = [page.getByTestId("sprout-turn-on"), page.getByTestId("sprout-keep-off")];
    const [a, b] = [await yes.boundingBox(), await no.boundingBox()];
    expect(Math.abs((a?.height ?? 0) - (b?.height ?? 0))).toBeLessThanOrEqual(1);
    expect(await yes.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(await no.evaluate((el) => getComputedStyle(el).backgroundColor));
    await no.click();
    await expect(terms).toBeHidden();
    expect((await sprout(page)).state).toBe("off");
    await page.context().close();
  });

  test("an unproved address cannot turn it on, on the screen or past it, and can always turn it off", async ({ browser }) => {
    const { page, account } = await member(browser, { verified: false });
    await openChoices(page);
    await page.getByTestId("sprout-review").click();
    await expect(page.getByTestId("sprout-verify")).toBeVisible();
    await expect(page.getByTestId("sprout-turn-on")).toHaveCount(0);
    const { terms } = await sprout(page);
    const past = await sendAs<{ detail: string }>(page, "POST", "/api/v1/members/me/sprout-permission/grant", { terms_version: terms.version, terms_hash: terms.hash });
    expect(past.status).toBe(409);
    expect((await sendAs(page, "POST", "/api/v1/members/me/sprout-permission/revoke", {})).status).toBe(200);
    expect((await sprout(page)).personalizes).toBe(false);
    await verifyAddress(page, account.email);
    await openChoices(page);
    await turnOn(page);
    await page.context().close();
  });

  test("only the member, only the current words, only with their own session", async ({ browser, request }) => {
    const { page } = await member(browser);
    const other = await member(browser);
    const admin = await console(browser);
    const { terms } = await sprout(page);
    const grant = "/api/v1/members/me/sprout-permission/grant";
    const right = { terms_version: terms.version, terms_hash: terms.hash };
    // Not signed in, a console session, no CSRF token.
    expect((await request.get(`${API_URL}/api/v1/members/me/sprout-permission`)).status()).toBe(401);
    expect((await request.post(`${API_URL}${grant}`, { data: right })).status()).toBeGreaterThanOrEqual(401);
    expect((await admin.request.get(`${API_URL}/api/v1/members/me/sprout-permission`)).status()).toBe(401);
    expect((await admin.request.post(`${API_URL}${grant}`, { data: right })).status()).toBeGreaterThanOrEqual(401);
    expect((await page.request.post(`${API_URL}${grant}`, { data: right })).status()).toBe(403);
    // Words that are not the ones being shown now, and a body with more in it than a choice.
    expect((await sendAs(page, "POST", grant, { ...right, terms_version: 0 })).status).toBe(409);
    expect((await sendAs(page, "POST", grant, { ...right, terms_hash: "0".repeat(64) })).status).toBe(409);
    expect((await sendAs(page, "POST", grant, {})).status).toBe(422);
    expect((await sendAs(page, "POST", grant, { ...right, member_id: other.id })).status).toBe(422);
    expect((await sprout(page)).personalizes).toBe(false);
    // One member's yes is one member's.
    expect((await sendAs(page, "POST", grant, right)).status).toBe(200);
    expect([(await sprout(page)).personalizes, (await sprout(other.page)).personalizes]).toEqual([true, false]);
    expect((await ask(other.page)).health_context).toBe("off");
    for (const p of [page, other.page, admin]) await p.context().close();
  });

  test("another tab, the Back button and several presses all end in one truth", async ({ browser }) => {
    const { page } = await member(browser);
    const second = await page.context().newPage();
    await openChoices(page);
    await openChoices(second);
    await turnOn(page);
    // The other tab still shows Off; what it does next is checked against now.
    await second.getByTestId("sprout-review").click();
    await second.getByTestId("sprout-turn-on").click();
    await expect(second.getByTestId("sprout-state")).toContainText("On, since");
    expect((await sprout(page)).events.map((e) => e.to_state), "saying yes twice is one yes").toEqual(["on"]);
    await second.getByTestId("sprout-turn-off").click();
    await expect(second.getByTestId("sprout-state")).toContainText("Off. You turned it off");
    expect((await ask(page)).health_context, "the next question, whatever this tab shows").toBe("off");
    await page.getByTestId("sprout-turn-off").click();
    await expect(page.getByTestId("sprout-state")).toContainText("Off. You turned it off");
    expect((await sprout(page)).events.map((e) => e.to_state)).toEqual(["on", "turned_off"]);

    // Both ways at once, several times: it ends where the last one said.
    const { terms } = await sprout(page);
    const statuses = await page.evaluate(async ({ api, terms }) => {
      const token = decodeURIComponent(document.cookie.match(/(?:^|; )veye_csrf=([^;]+)/)?.[1] ?? "");
      const send = (what: string, body: unknown) => fetch(`${api}/api/v1/members/me/sprout-permission/${what}`, { method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json", "X-Veye-Csrf": token }, body: JSON.stringify(body) }).then((r) => r.status);
      const yes = { terms_version: terms.version, terms_hash: terms.hash };
      return Promise.all([send("grant", yes), send("revoke", {}), send("grant", yes), send("revoke", {}), send("grant", yes), send("grant", yes)]);
    }, { api: API_URL, terms });
    expect(statuses).toEqual([200, 200, 200, 200, 200, 200]);
    const after = await sprout(page);
    expect(after.personalizes).toBe(after.events.at(-1)?.to_state === "on");
    for (let i = 1; i < after.events.length; i++) expect(after.events[i].to_state, "no step repeats the one before").not.toBe(after.events[i - 1].to_state);
    await second.close();
    await page.reload();
    await expect(page.getByTestId("sprout-state")).toContainText(after.personalizes ? "On, since" : "Off.");
    await page.context().close();
  });

  test("a refused or lost answer leaves the choice as it was and says so; the other choice still works", async ({ browser }) => {
    const { page } = await member(browser);
    await openChoices(page);
    await page.route("**/sprout-permission/grant", (route) => route.abort());
    await page.getByTestId("sprout-review").click();
    await page.getByTestId("sprout-turn-on").click();
    await expect(page.getByTestId("sprout-error")).toBeVisible();
    await expect(page.getByTestId("sprout-state")).toContainText("Off.");
    await page.unroute("**/sprout-permission/grant");
    await page.getByTestId("sprout-turn-on").click();
    await expect(page.getByTestId("sprout-state")).toContainText("On, since");
    await expect(page.getByTestId("sprout-error")).toHaveCount(0);

    // Each loads on its own: one that cannot be read says so beside one that can.
    await page.route("**/api/v1/members/me/sprout-permission", (route) => route.abort());
    await open(page, "/app/settings");
    await expect(page.getByTestId("sprout-error")).toBeVisible();
    await expect(page.getByTestId("health-sharing-state")).toBeVisible();
    await expect(page.getByTestId("health-sharing-review")).toBeEnabled();
    await page.context().close();
  });

  test("on the companion screen: said once, with the way to change it, and gone once it is on", async ({ browser }) => {
    const { page } = await member(browser);
    const say = async (text: string) => {
      const answered = page.waitForResponse((r) => r.url().endsWith("/api/v1/companion/messages") && r.request().method() === "POST");
      await page.locator("#chatInput").fill(text);
      await expect(page.locator(".chat-send")).toBeEnabled();
      await page.locator("#chatInput").press("Enter");
      await answered;
    };
    await open(page, "/app/companion");
    await expect(page.locator(".msg-row.bot").first()).toBeVisible();
    await say(QUESTION);
    await expect(page.getByTestId("without-health")).toHaveCount(1);
    await say(QUESTION);
    await expect(page.locator(".msg-row.bot:not(.msg-typing)")).toHaveCount(2);
    await expect(page.getByTestId("without-health"), "not under every answer in a run of them").toHaveCount(1);
    await page.getByTestId("without-health").getByRole("link").click();
    await expect(page).toHaveURL(/\/app\/settings/);
    await turnOn(page);
    await open(page, "/app/companion");
    await expect(page.locator(".msg-row.bot").first()).toBeVisible();
    await say(QUESTION);
    await expect(page.locator(".msg-row.bot:not(.msg-typing)").last()).toContainText(/\w/);
    await expect(page.getByTestId("without-health")).toHaveCount(0);
    await page.context().close();
  });

  test("on a phone both choices fit and can be pressed", async ({ browser }) => {
    const { page } = await member(browser, { viewport: { width: 390, height: 844 } });
    await openChoices(page);
    await page.getByTestId("sprout-review").click();
    await expect(page.getByTestId("sprout-terms")).toBeVisible();
    for (const width of [390, 320, 768]) {
      await page.setViewportSize({ width, height: 844 });
      await expectNoHorizontalOverflow(page);
      for (const id of ["sprout-turn-on", "sprout-keep-off"]) expect((await page.getByTestId(id).boundingBox())!.height).toBeGreaterThanOrEqual(40);
    }
    await page.context().close();
  });
});

test("the four demonstration members, as the console and they themselves see them", async ({ browser }) => {
  const admin = await console(browser);
  const { rows } = (await (await admin.request.get(`${API_URL}/api/v1/admin/members?page_size=100&q=.demo@demo`)).json()) as { rows: { email: string; health_number: number | null; shares_health_data: boolean }[] };
  for (const [who, sharing, personal] of [[ADITYA, true, true], [MAYA, true, false], [TARA, false, true], [NOOR, false, false]] as const) {
    const page = await (await browser.newContext()).newPage();
    await memberSignIn(page, who.email, who.password);
    await expectMemberDashboard(page);
    expect([(await team(page)).shares_health_data, (await sprout(page)).personalizes], who.email).toEqual([sharing, personal]);
    const row = rows.find((r) => r.email === who.email);
    expect(row, `${who.email} is in the console's list`).toBeTruthy();
    expect([row!.shares_health_data, row!.health_number !== null], who.email).toEqual([sharing, sharing]);
    await openChoices(page);
    await expect(page.getByTestId("sprout-state")).toContainText(personal ? "On, since" : "Off.");
    await expect(page.getByTestId("health-sharing-state")).toContainText(sharing ? "can open your saved results" : "Nobody at Veye can open your saved results");
    await page.context().close();
  }
  await admin.context().close();
});
