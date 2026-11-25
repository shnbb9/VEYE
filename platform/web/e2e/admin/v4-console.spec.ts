import { expect, test, type Browser, type Page } from "@playwright/test";
import { ADMIN, freshMember } from "../fixtures/accounts";
import { adminSignIn, expectAdminHome, expectNoHorizontalOverflow, linkFrom, memberApi, memberSignIn, open, portalSessions, signUpMember, toPath, waitForMail } from "../fixtures/helpers";

/* What Cara confirmed on 25 Nov 2026, driven as she would: health sharing and
   trends in the directory, archiving, questions awaiting a reply, importance,
   the Finance placeholder, and retention that does not guess. */

async function admin(page: Page) {
  await adminSignIn(page, ADMIN.email, ADMIN.password);
  await expectAdminHome(page);
}

async function newMember(browser: Browser, prefix = "e2e") {
  const person = freshMember(prefix);
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await signUpMember(page, person);
  return { person, page };
}

async function find(page: Page, email: string) {
  await open(page, "/admin/members");
  await page.getByLabel("Search members").fill(email);
  const row = page.getByTestId("members-table").locator("tbody tr").filter({ hasText: email });
  await expect(row).toHaveCount(1);
  return row;
}

async function takeQuiz(page: Page, tired: "yes" | "no") {
  await page.evaluate(async ({ api, tired }) => {
    const csrf = decodeURIComponent(document.cookie.match(/veye_csrf=([^;]*)/)?.[1] ?? "");
    const answers = { goals: ["Live a Healthier Lifestyle"], plans: ["No other plans"], activity: "Moderate (I exercise 1-3 times a week)", meditate: "no", tired,
      gainWeight: tired, abdomenWeight: tired, sleepEnough: tired === "yes" ? "no" : "yes", sleepWell: "yes", sleepHours: 7, diet: "No preference", source: "Friends or Family" };
    const saved = await fetch(`${api}/api/v1/health-number/calculate`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json", "X-Veye-Csrf": csrf }, body: JSON.stringify({ answers }) });
    if (!saved.ok) throw new Error(await saved.text());
  }, { api: process.env.E2E_API_URL ?? "http://localhost:8001", tired });
}

async function share(page: Page, email: string) {
  await page.goto(toPath(linkFrom((await waitForMail(email, "Verify")).text, "verify-email")));
  await expect(page.getByText(/verified/i).first()).toBeVisible();
  await open(page, "/app/sharing-request");
  await page.getByTestId("sharing-allow").click();
  await expect.poll(async () => (await memberApi<{ state: string }>(page, "/api/v1/members/me/health-permission")).state).toBe("granted");
}

test("the directory shows sharing, withholds the number and the trend, and opens both the moment the member shares", async ({ page, browser }) => {
  const { person, page: mine } = await newMember(browser);
  await takeQuiz(mine, "yes");
  await takeQuiz(mine, "no");
  await admin(page);
  let row = await find(page, person.email);
  await expect(row.locator("[data-sharing]")).toHaveText("Not requested");
  await expect(row).toContainText("Not shared");
  await expect(row.locator("[data-trend]")).toHaveAttribute("data-trend", "not_shared");
  await expect(page.getByTestId("members-table").locator("thead")).not.toContainText("Trackers");

  await share(mine, person.email);
  row = await find(page, person.email);
  await expect(row.locator("[data-sharing]")).toHaveText("Shared");
  await expect(row.locator("[data-trend]")).toHaveAttribute("data-trend", "improved");
  await expect(row.locator('[data-trend="improved"]')).toHaveText(/lower, improved: lower is better\s*since \w/);

  // The same member on Progress & trends, reached by its card and by filter.
  await open(page, "/admin/members/trends");
  await page.getByTestId("trend-improved").click();
  await expect(page.getByTestId("trend-improved")).toHaveAttribute("aria-pressed", "true");
  await page.getByLabel("Search members").fill(person.email);
  await expect(page.getByTestId("members-table").locator("tbody tr")).toHaveCount(1);
  await page.locator("#fTrend").selectOption("worsened");
  await expect(page.getByText("No members match those filters")).toBeVisible();
  for (const width of [1024, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expectNoHorizontalOverflow(page);
  }
  await page.setViewportSize({ width: 1440, height: 900 });

  // Withdrawn: closed on the very next look.
  await open(mine, "/app/settings?section=privacy");
  mine.once("dialog", (dialog) => void dialog.accept());
  await mine.getByTestId("health-sharing-revoke").click();
  await expect.poll(async () => (await memberApi<{ state: string }>(mine, "/api/v1/members/me/health-permission")).state).toBe("revoked");
  row = await find(page, person.email);
  await expect(row.locator("[data-sharing]")).toHaveText("Revoked");
  await expect(row.locator("[data-trend]")).toHaveAttribute("data-trend", "not_shared");
  await mine.context().close();
});

test("the whole directory and the trends, unfiltered, fit every width", async ({ page }) => {
  await admin(page);
  for (const path of ["/admin/members", "/admin/members/trends"]) {
    for (const width of [1920, 1440, 1280, 1024, 768, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await open(page, path);
      await expect(page.getByTestId("members-table").locator("tbody tr").first()).toBeVisible();
      await expectNoHorizontalOverflow(page);
    }
  }
});

test("archiving signs the member out and hides them; restoring brings them back", async ({ page, browser }) => {
  const { person, page: mine } = await newMember(browser);
  await admin(page);
  await (await find(page, person.email)).getByRole("link", { name: /Open/ }).click();
  await page.locator(".subnav").getByRole("link", { name: "Account" }).click();
  await page.getByLabel(/^Reason/).fill("Asked to pause");
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByTestId("member-archive").click();
  await expect(page.getByTestId("archived-banner")).toContainText("Asked to pause");

  await mine.goto("/app");
  await expect(mine).toHaveURL(/\/login/);
  await memberSignIn(mine, person.email, person.password);
  await expect(mine.locator(".auth__error")).toContainText("archived");

  await open(page, "/admin/members");
  await page.getByLabel("Search members").fill(person.email);
  await expect(page.getByText("No members match those filters")).toBeVisible();
  await page.getByLabel("Archived members").selectOption("only");
  await expect(page.getByTestId("members-table").locator("tbody tr").filter({ hasText: person.email })).toContainText("Archived");
  await page.getByTestId("members-table").getByRole("link", { name: new RegExp(`Open ${person.firstName}`) }).click();
  await page.locator(".subnav").getByRole("link", { name: "Account" }).click();
  await page.getByTestId("member-restore").click();
  await expect(page.getByTestId("archived-banner")).toHaveCount(0);
  await memberSignIn(mine, person.email, person.password);
  await expect.poll(async () => (await portalSessions(mine)).member?.email).toBe(person.email);
  await mine.context().close();
});

test("a member's question reaches Home, is ordered by importance, and leaves only when it is answered", async ({ page, browser }) => {
  const { person, page: mine } = await newMember(browser);
  const subject = `E2E question ${Date.now().toString(36)}`;
  await mine.evaluate(async ({ api, subject }) => {
    const csrf = decodeURIComponent(document.cookie.match(/veye_csrf=([^;]*)/)?.[1] ?? "");
    await fetch(`${api}/api/v1/members/me/requests`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json", "X-Veye-Csrf": csrf },
      body: JSON.stringify({ kind: "help_question", subject, message: "How do I change my diary day?" }) });
  }, { api: process.env.E2E_API_URL ?? "http://localhost:8001", subject });

  await admin(page);
  const quick = page.locator(".quick__btn");
  await expect(quick.filter({ hasText: "View all members" })).toHaveCount(0);
  await expect(quick.last()).toContainText("Questions awaiting a reply");
  await quick.last().click();
  await expect(page).toHaveURL(/\/admin\/requests\?view=awaiting_reply/);
  await expect(page.getByRole("tab", { name: "Awaiting a reply" })).toHaveAttribute("aria-selected", "true");
  await page.getByLabel("Search requests").fill(subject);
  await page.getByTestId("requests-list").getByRole("button", { name: new RegExp(subject) }).click();
  await page.getByTestId("priority-select").selectOption("high");
  await expect(page.getByTestId("requests-list").locator("[data-priority=high]").first()).toBeVisible();
  // Moving the status answers nobody.
  await page.getByTestId("request-progress").click();
  await page.reload();
  await expect(page.getByTestId("requests-list").getByRole("button", { name: new RegExp(subject) })).toBeVisible();

  await open(page, "/admin");
  const card = page.getByTestId("attention");
  await card.getByLabel("Importance").selectOption("high");
  const item = card.getByTestId("attention-row").filter({ hasText: subject });
  await expect(item).toContainText("Reply needed");
  await item.getByRole("link", { name: /Open request/ }).click();
  await expect(page.getByTestId("request-detail")).toContainText(subject);
  await page.getByTestId("request-reply").fill("Use the arrows beside the date.");
  await page.getByTestId("request-send-reply").click();
  await expect(page.getByTestId("request-reply-result")).toContainText(`Sent to ${person.email}`);

  await open(page, "/admin");
  await card.getByLabel("Importance").selectOption("high");
  await expect(card.getByTestId("attention-row").filter({ hasText: subject })).toHaveCount(0);
  await card.getByRole("tab", { name: /^Replied/ }).click();
  await expect(card.getByTestId("attention-row").filter({ hasText: subject })).toContainText("Replied, not resolved");
  for (const width of [768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expectNoHorizontalOverflow(page);
  }
  await mine.context().close();
});

test("Finance is a placeholder that says so and holds no figure", async ({ page }) => {
  await admin(page);
  await page.locator(".rail a[href='/admin/finance']").click();
  await expect(page.getByTestId("finance-phase")).toHaveText(/Phase 2/);
  for (const [path, panel] of [["/admin/finance", "finance-revenue"], ["/admin/finance?tab=plans", "finance-plans"]] as const) {
    await open(page, path);
    await expect(page.getByTestId(panel)).toBeVisible();
    await expect(page.getByTestId("finance-notice")).toContainText("not zero");
    const values = await page.locator(".kpi__value").allTextContents();
    expect(values.length).toBe(4);
    expect(values.every((value) => value.trim() === "—")).toBe(true);
    expect(await page.locator("#main-content").innerText()).not.toMatch(/\$\s?\d/);
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await expectNoHorizontalOverflow(page);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
  }
  await open(page, "/admin/finance");
  await page.getByRole("tab", { name: "Quarter" }).click();
  await expect(page.locator(".finance-chart")).toContainText("Revenue by quarter");
});

test("retention states its definitions and never shows a rate it cannot measure", async ({ page }) => {
  await admin(page);
  await open(page, "/admin/insights");
  const section = page.getByTestId("retention");
  await expect(section).toContainText("Nothing before that date is known");
  for (const days of [7, 30]) {
    const tile = page.getByTestId(`retention-return-${days}`);
    const value = (await tile.locator(".kpi__value").innerText()).trim();
    if (value === "—") await expect(tile).toContainText("Not enough time yet");
    else await expect(tile).toContainText(/of \d+ who joined at least/);
  }
  await expect(page.getByTestId("getting-started")).toContainText("Chose foods");
  await open(page, "/admin/assessments");
  await expect(page.getByTestId("unfinished-health_number")).toContainText("Started, not finished");
});
