import { expect, request, test, type Browser, type Page } from "@playwright/test";
import { ADITYA, ADMIN, API_URL, freshMember } from "./fixtures/accounts";
import { adminSignIn, expectAdminHome, expectMemberDashboard, memberSignIn, open, signUpMember } from "./fixtures/helpers";

/* Runtime and navigation acceptance (22 Sep 2026). The journey specs prove
   SPA navigation; this file proves what a person does by hand on the durable
   runtime and what the click-through never covered:
     - every sidebar destination opens by click, renders its shell and content,
       and survives F5 on that route;
     - every detail row (Members → Member 360, Assessments → instrument →
       Member 360, Requests → detail, Member 360 → Requests / Conversations,
       My Progress → each tracker) opens its nested route;
     - every nested URL answers a DIRECT page.goto, a reload, Back / Forward
       and a second tab, and a signed-out browser is sent to the portal's own
       sign-in with `next` set;
     - Member 360 handles a valid, an unknown, a malformed and a just-removed
       member id with a controlled state, never a blank screen.
   A failed document navigation (network failure or a 4xx/5xx document) or a
   console error fails the test. */

const ADMIN_NAV = [
  { label: "Home", path: "/admin" },
  { label: "Members", path: "/admin/members" },
  { label: "Care Studio", path: "/admin/care" },
  { label: "Assessments", path: "/admin/assessments" },
  { label: "Companion", path: "/admin/companion/conversations" },
  { label: "Requests & Inbox", path: "/admin/requests" },
  { label: "Content", path: "/admin/content" },
  { label: "Insights", path: "/admin/insights" },
  { label: "Settings", path: "/admin/settings" },
];
const COMPANION_NAV = [
  { label: "Conversations", path: "/admin/companion/conversations" },
  { label: "Knowledge Sources", path: "/admin/companion/knowledge-sources" },
  { label: "Feedback", path: "/admin/companion/feedback" },
  { label: "Settings", path: "/admin/companion/settings" },
];
const ADVANCED_NAV = [
  { label: "AI Monitoring", path: "/admin/companion/settings/advanced/ai-monitoring" },
  { label: "Retrieval Diagnostics", path: "/admin/companion/settings/advanced/retrieval-diagnostics" },
  { label: "Safety Analytics", path: "/admin/companion/settings/advanced/safety-analytics" },
  { label: "Provider Status", path: "/admin/companion/settings/advanced/provider-status" },
  { label: "Audit", path: "/admin/companion/settings/advanced/audit" },
];
const MEMBER_NAV = [
  { label: "Dashboard", path: "/app" },
  { label: "Veye Companion", path: "/app/companion" },
  { label: "My Progress", path: "/app/progress" },
  { label: "Mood Tracker", path: "/app/mood" },
  { label: "Food Choices", path: "/app/food-choices" },
  { label: "Meal Planning", path: "/app/meal-planning" },
  { label: "Food Diary", path: "/app/food-diary" },
  { label: "Supplements", path: "/app/supplements" },
  { label: "Fitness", path: "/app/fitness" },
  { label: "Mindfulness", path: "/app/mindfulness" },
  { label: "Resources", path: "/app/resources" },
  { label: "Settings", path: "/app/settings" },
];
const TRACKERS = ["/app/progress/health-number", "/app/progress/body-composition", "/app/progress/blood-markers", "/app/progress/health-assessment", "/app/progress/simple-quiz"];

/* Nested URLs a person pastes by hand. `{aditya}` is replaced by the seeded member's id. */
const ADMIN_DEEP = [
  "/admin/members/{aditya}", "/admin/members/{aditya}?tab=assessments", "/admin/members/{aditya}?tab=journal",
  "/admin/members/{aditya}?tab=companion", "/admin/members/{aditya}?tab=requests", "/admin/members/{aditya}?tab=account",
  "/admin/assessments/health_number", "/admin/assessments/body_composition", "/admin/assessments/blood_markers",
  "/admin/assessments/health_assessment", "/admin/assessments/simple_quiz",
  "/admin/requests?view=all", "/admin/requests?view=resolved", "/admin/care?kind=supplement", "/admin/content?group=member_copy",
  "/admin/settings?section=product", "/admin/settings?section=features",
  ...COMPANION_NAV.map((n) => n.path), "/admin/companion/settings/guided-experiences", ...ADVANCED_NAV.map((n) => n.path),
];
const MEMBER_DEEP = [...TRACKERS, "/app/mood", "/app/food-diary", "/app/settings", "/app/companion", "/app/progress"];

// Crawls visit thirty-odd screens each; against the Docker dev server every
// first visit also compiles the route, so give them room.
test.describe.configure({ timeout: 300_000 });

type Watch = { errors: string[]; failedDocs: string[] };

/** Console errors and failed document navigations on this page, collected for
 *  the test's final assertion. `expected` names API answers a screen is meant
 *  to receive (a 404 for an unknown member): Chrome logs every 4xx fetch as a
 *  console error, and those are the controlled path, not a defect. */
function watch(page: Page, expected?: RegExp): Watch {
  const errors: string[] = [];
  const failedDocs: string[] = [];
  page.on("console", (message) => {
    if (message.type() !== "error" || /hmr|favicon|ERR_CONNECTION_REFUSED.*ws/i.test(message.text())) return;
    if (expected && expected.test(message.text())) return;
    errors.push(`${message.text()} @ ${page.url()}`);
  });
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message} @ ${page.url()}`));
  // Top-level documents only: embedded third-party iframes (video embeds) are not navigation.
  const topLevel = (req: { resourceType(): string; frame(): unknown }) => req.resourceType() === "document" && req.frame() === page.mainFrame();
  page.on("requestfailed", (req) => { if (topLevel(req)) failedDocs.push(`${req.url()} → ${req.failure()?.errorText ?? "failed"}`); });
  page.on("response", (response) => { if (topLevel(response.request()) && response.status() >= 400) failedDocs.push(`${response.url()} → ${response.status()}`); });
  return { errors, failedDocs };
}

function clean(w: Watch) {
  expect(w.failedDocs, "document navigations that failed").toEqual([]);
  expect(w.errors, "browser console errors").toEqual([]);
}

async function expectPath(page: Page, path: string) {
  const [pathname, search] = path.split("?");
  await expect(page).toHaveURL((url) => url.pathname === pathname && (search === undefined || url.search === `?${search}`));
}

/** The admin shell and the screen's own content are on screen: a heading, no loading placeholder left. */
async function adminReady(page: Page) {
  await expect(page.locator("#main-content")).toBeVisible();
  await expect(page.locator("#main-content h1").first()).toBeVisible();
  await expect(page.locator("#main-content .loading-row")).toHaveCount(0);
}

async function memberReady(page: Page) {
  await expect(page.locator("main")).toBeVisible();
  await expect(page.locator("main")).not.toBeEmpty();
  await expect(page.locator("main").getByText(/^Loading/)).toHaveCount(0);
}

async function adityaId(): Promise<string> {
  const api = await request.newContext({ baseURL: API_URL });
  try {
    const signIn = await api.post("/api/v1/auth/admin/sign-in", { data: { email: ADMIN.email, password: ADMIN.password, remember: false } });
    expect(signIn.ok()).toBe(true);
    const members = await api.get(`/api/v1/admin/members?q=${encodeURIComponent(ADITYA.email)}`);
    const body = (await members.json()) as { rows: { member_id: string; email: string }[] };
    const row = body.rows.find((r) => r.email === ADITYA.email);
    if (!row) throw new Error(`${ADITYA.email} is not in the member directory`);
    return row.member_id;
  } finally {
    await api.dispose();
  }
}

/** Direct paste + F5 on a nested route, the manual scenario the click-through specs never exercised. */
async function deepLink(page: Page, url: string, ready: (page: Page) => Promise<void>) {
  await open(page, url);
  await expectPath(page, url);
  await ready(page);
  await page.reload();
  await expectPath(page, url);
  await ready(page);
}

async function memberPage(browser: Browser, email: string, password: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await memberSignIn(page, email, password);
  await expectMemberDashboard(page);
  return page;
}

test.describe("Admin navigation crawl", () => {
  test("every sidebar destination opens by click, renders, and survives a reload", async ({ page }) => {
    const w = watch(page);
    await adminSignIn(page, ADMIN.email, ADMIN.password);
    await expectAdminHome(page);
    const rail = page.getByRole("navigation", { name: "Main" });
    for (const item of ADMIN_NAV) {
      await rail.getByRole("link", { name: item.label, exact: true }).click();
      await expectPath(page, item.path);
      await adminReady(page);
      await expect(rail.getByRole("link", { name: item.label, exact: true })).toHaveAttribute("aria-current", "page");
      await page.reload();
      await adminReady(page);
      await expectPath(page, item.path);
    }
    // Companion sub-navigation and its Advanced section.
    await rail.getByRole("link", { name: "Companion", exact: true }).click();
    await expectPath(page, "/admin/companion/conversations");
    await adminReady(page);
    for (const item of COMPANION_NAV) {
      // by href: the Conversations entry carries a needs-review count in its name
      await page.getByRole("navigation", { name: "Section" }).locator(`a[href="${item.path}"]`).click();
      await expectPath(page, item.path);
      await adminReady(page);
    }
    await page.locator('#main-content a[href="/admin/companion/settings/guided-experiences"]').first().click();
    await expectPath(page, "/admin/companion/settings/guided-experiences");
    await adminReady(page);
    for (const item of ADVANCED_NAV) {
      await open(page, "/admin/companion/settings");
      await page.locator(`#main-content a[href="${item.path}"]`).first().click();
      await expectPath(page, item.path);
      await adminReady(page);
    }
    clean(w);
  });

  test("every detail row opens its nested route: Members, Assessments, Requests, Member 360 tabs", async ({ page }) => {
    const w = watch(page);
    await adminSignIn(page, ADMIN.email, ADMIN.password);
    await expectAdminHome(page);

    // Members → search → Open → Member 360 → each tab by click.
    await open(page, "/admin/members");
    await page.getByLabel("Search members").fill(ADITYA.email);
    const openAditya = page.getByRole("link", { name: /^Open Aditya/ });
    await expect(openAditya).toBeVisible();
    await openAditya.click();
    await expect(page).toHaveURL(/\/admin\/members\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { name: /Aditya/ })).toBeVisible();
    const m360 = new URL(page.url()).pathname;
    for (const tab of ["Assessments", "Mood & Diary", "Companion", "Requests", "Account", "Overview"]) {
      await page.getByRole("navigation", { name: "Section" }).getByRole("link", { name: tab, exact: true }).click();
      await expectPath(page, tab === "Overview" ? `${m360}?tab=overview` : `${m360}?tab=${{ "Mood & Diary": "journal" }[tab] ?? tab.toLowerCase()}`);
      await adminReady(page);
    }
    // Member 360 → Requests tab → a request opens in Requests & Inbox with that request selected.
    await page.getByRole("navigation", { name: "Section" }).getByRole("link", { name: "Requests", exact: true }).click();
    await expectPath(page, `${m360}?tab=requests`);
    await expect(page.getByTestId("m360-requests")).toBeVisible();
    const requestLinks = page.getByTestId("m360-requests").getByRole("link", { name: "Open", exact: true });
    if (await requestLinks.count()) {
      await requestLinks.first().click();
      await expect(page).toHaveURL(/\/admin\/requests\?view=all&id=[0-9a-f-]{36}$/);
      await expect(page.getByTestId("request-detail")).toContainText(ADITYA.firstName);
      await page.goBack();
      await expectPath(page, `${m360}?tab=requests`);
    }
    // Member 360 → Companion tab → a conversation opens preselected in Conversations.
    await page.getByRole("navigation", { name: "Section" }).getByRole("link", { name: "Companion", exact: true }).click();
    await expectPath(page, `${m360}?tab=companion`);
    await adminReady(page);
    const conversationLinks = page.locator("#main-content table").getByRole("link", { name: "Open", exact: true });
    if (await conversationLinks.count()) {
      await conversationLinks.first().click();
      await expect(page).toHaveURL(/\/admin\/companion\/conversations\?conversation=[0-9a-f-]{36}$/);
      const id = new URL(page.url()).searchParams.get("conversation");
      await expect(page.locator(`.flag.is-active`)).toHaveCount(1);
      await expect(page.locator("#main-content")).toContainText(ADITYA.firstName);
      expect(id).toBeTruthy();
      await page.goBack();
      await expectPath(page, `${m360}?tab=companion`);
    }
    await page.goBack();
    await expectPath(page, `${m360}?tab=requests`);
    await page.goForward();
    await expectPath(page, `${m360}?tab=companion`);

    // Assessments → instrument → attempts → Member 360 (assessments tab).
    await open(page, "/admin/assessments");
    await page.getByTestId("instruments").locator('a[href="/admin/assessments/health_number"]').click();
    await expectPath(page, "/admin/assessments/health_number");
    await adminReady(page);
    const m360FromAttempt = page.getByTestId("attempts-table").getByRole("link", { name: "Member 360" }).first();
    await expect(m360FromAttempt).toBeVisible();
    await m360FromAttempt.click();
    await expect(page).toHaveURL(/\/admin\/members\/[0-9a-f-]{36}\?tab=assessments$/);
    await adminReady(page);

    // Requests & Inbox → a row → detail → Open Member 360.
    await open(page, "/admin/requests?view=all");
    const firstRequest = page.getByTestId("requests-list").locator(".flag").first();
    await expect(firstRequest).toBeVisible();
    await firstRequest.click();
    await expect(page.getByTestId("request-detail")).toBeVisible();
    const toMember = page.getByRole("link", { name: "Open Member 360" });
    if (await toMember.count()) {
      await toMember.click();
      await expect(page).toHaveURL(/\/admin\/members\/[0-9a-f-]{36}/);
      await adminReady(page);
    }
    clean(w);
  });

  test("every nested admin URL answers a direct visit, a reload, Back/Forward and a second tab", async ({ page, context }) => {
    const w = watch(page);
    const id = await adityaId();
    await adminSignIn(page, ADMIN.email, ADMIN.password);
    await expectAdminHome(page);
    const urls = ADMIN_DEEP.map((u) => u.replace("{aditya}", id));
    for (const url of urls) await deepLink(page, url, adminReady);
    // Member 360 specifically: the member's name after a direct visit and after F5.
    await open(page, `/admin/members/${id}`);
    await expect(page.getByRole("heading", { name: /Aditya/ })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: /Aditya/ })).toBeVisible();
    // Back / Forward across three nested routes.
    await open(page, `/admin/members/${id}?tab=journal`);
    await open(page, "/admin/requests?view=resolved");
    await page.goBack();
    await expectPath(page, `/admin/members/${id}?tab=journal`);
    await adminReady(page);
    await page.goBack();
    await expectPath(page, `/admin/members/${id}`);
    await page.goForward();
    await expectPath(page, `/admin/members/${id}?tab=journal`);
    await page.goForward();
    await expectPath(page, "/admin/requests?view=resolved");
    await adminReady(page);
    // A second tab in the same browser shares the session and renders the nested route.
    const tab = await context.newPage();
    const tw = watch(tab);
    await open(tab, `/admin/members/${id}?tab=journal`);
    await expect(tab.getByRole("heading", { name: /Aditya/ })).toBeVisible();
    await expect(tab.getByTestId("m360-journal")).toBeVisible();
    await tab.close();
    clean(tw);
    clean(w);
  });

  test("Member 360: unknown, malformed and just-removed member ids show a controlled not-found state", async ({ page, browser }) => {
    const w = watch(page, /Failed to load resource: .* (404|422) /);
    await adminSignIn(page, ADMIN.email, ADMIN.password);
    await expectAdminHome(page);
    for (const bad of ["/admin/members/00000000-0000-4000-8000-000000000000", "/admin/members/not-a-uuid", "/admin/members/12345"]) {
      await open(page, bad);
      await expect(page.getByRole("heading", { name: "That member was not found" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Go to the member directory" })).toBeVisible();
      await page.reload();
      await expect(page.getByRole("heading", { name: "That member was not found" })).toBeVisible();
    }
    await page.getByRole("link", { name: "Go to the member directory" }).click();
    await expectPath(page, "/admin/members");
    await adminReady(page);

    // A member removed while the administrator is looking at them.
    const gone = freshMember("gone");
    const signUp = await browser.newContext();
    await signUpMember(await signUp.newPage(), gone);
    await signUp.close();
    await open(page, "/admin/members");
    await page.getByLabel("Search members").fill(gone.email);
    await page.locator("tr", { hasText: gone.email }).getByRole("link", { name: /^Open/ }).click();
    await expect(page.getByRole("heading", { name: new RegExp(gone.lastName) })).toBeVisible();
    const removedAt = new URL(page.url()).pathname;
    const api = await request.newContext({ baseURL: API_URL });
    try {
      const signIn = await api.post("/api/v1/auth/admin/sign-in", { data: { email: ADMIN.email, password: ADMIN.password, remember: false } });
      expect(signIn.ok()).toBe(true);
      const cleaned = await api.post("/api/v1/admin/qa/cleanup-synthetic-members", { data: { prefixes: ["gone"] } });
      expect(cleaned.ok()).toBe(true);
      expect(((await cleaned.json()) as { removed: string[] }).removed).toContain(gone.email);
    } finally {
      await api.dispose();
    }
    await page.reload();
    await expectPath(page, removedAt);
    await expect(page.getByRole("heading", { name: "That member was not found" })).toBeVisible();
    await open(page, "/admin/members");
    await page.getByLabel("Search members").fill(gone.email);
    await expect(page.locator("#main-content")).toContainText("No members match those filters");
    await expect(page.locator("tr", { hasText: gone.email })).toHaveCount(0);
    clean(w);
  });

  test("a signed-out browser is sent from every nested admin URL to the admin sign-in with next set", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const w = watch(page);
    const id = await adityaId();
    for (const url of [`/admin/members/${id}`, `/admin/members/${id}?tab=journal`, "/admin/requests?view=all", "/admin/settings?section=product", "/admin/companion/settings/advanced/audit"]) {
      await open(page, url);
      const pathname = url.split("?")[0];
      await expect(page).toHaveURL((u) => u.pathname === "/admin/login" && u.searchParams.get("next") === pathname);
    }
    // the member sign-in never receives an admin destination and vice versa
    await open(page, "/app/settings");
    await expect(page).toHaveURL((u) => u.pathname === "/login" && u.searchParams.get("next") === "/app/settings");
    await context.close();
    clean(w);
  });
});

test.describe("Member navigation crawl", () => {
  test("every sidebar destination opens by click, renders, and survives a reload", async ({ page }) => {
    const w = watch(page);
    await memberSignIn(page, ADITYA.email, ADITYA.password);
    await expectMemberDashboard(page);
    const sidebar = page.locator("aside.sidebar");
    for (const item of MEMBER_NAV) {
      await sidebar.getByRole("link", { name: item.label, exact: true }).click();
      await expectPath(page, item.path);
      await memberReady(page);
      await expect(sidebar.getByRole("link", { name: item.label, exact: true })).toHaveAttribute("aria-current", "page");
      await page.reload();
      await memberReady(page);
      await expectPath(page, item.path);
    }
    // My Progress → each tracker → back to My Progress.
    for (const tracker of TRACKERS) {
      await open(page, "/app/progress");
      await page.locator(`main a[href="${tracker}"]`).first().click();
      await expectPath(page, tracker);
      await memberReady(page);
      await expect(sidebar.getByRole("link", { name: "My Progress", exact: true })).toHaveAttribute("aria-current", "page");
      await page.goBack();
      await expectPath(page, "/app/progress");
    }
    // Dashboard cards.
    await open(page, "/app");
    await page.getByTestId("mood-card").click();
    await expectPath(page, "/app/mood");
    await memberReady(page);
    clean(w);
  });

  test("every nested member URL answers a direct visit, a reload, Back/Forward and a second tab", async ({ page, context }) => {
    const w = watch(page);
    await memberSignIn(page, ADITYA.email, ADITYA.password);
    await expectMemberDashboard(page);
    for (const url of MEMBER_DEEP) await deepLink(page, url, memberReady);
    // Content, not just a shell: the tracker and journal screens show their own data after F5.
    await open(page, "/app/mood");
    await expect(page.getByTestId("mood-logged")).toHaveText(/\d+/);
    await page.reload();
    await expect(page.getByTestId("mood-logged")).toHaveText(/\d+/);
    await open(page, "/app/food-diary");
    await expect(page.getByRole("heading", { name: "Food Diary" })).toBeVisible();
    await expect(page.getByTestId("diary-meals")).toBeAttached(); // empty on a day with no meal
    await page.reload();
    await expect(page.getByRole("heading", { name: "Food Diary" })).toBeVisible();
    await expect(page.getByTestId("diary-meals")).toBeAttached();
    await open(page, "/app/settings");
    await expect(page.getByTestId("settings-name")).toHaveValue(new RegExp(ADITYA.firstName));
    await page.reload();
    await expect(page.getByTestId("settings-name")).toHaveValue(new RegExp(ADITYA.firstName));
    // Back / Forward.
    await open(page, "/app/progress/health-number");
    await open(page, "/app/mood");
    await page.goBack();
    await expectPath(page, "/app/progress/health-number");
    await memberReady(page);
    await page.goBack();
    await expectPath(page, "/app/settings");
    await page.goForward();
    await expectPath(page, "/app/progress/health-number");
    await page.goForward();
    await expectPath(page, "/app/mood");
    await memberReady(page);
    // Second tab.
    const tab = await context.newPage();
    const tw = watch(tab);
    await open(tab, "/app/food-diary");
    await expect(tab.getByRole("heading", { name: "Food Diary" })).toBeVisible();
    await expect(tab.getByTestId("diary-meals")).toBeAttached();
    await tab.close();
    clean(tw);
    clean(w);
  });

  test("a signed-out browser is sent from every nested member URL to the member sign-in with next set", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const w = watch(page);
    for (const url of MEMBER_DEEP) {
      await open(page, url);
      await expect(page).toHaveURL((u) => u.pathname === "/login" && u.searchParams.get("next") === url);
    }
    await context.close();
    clean(w);
  });

  test("a member browser with two portals open keeps each portal's nested routes independent", async ({ browser }) => {
    // The same browser context signed into BOTH portals: nested member and
    // admin URLs each render for their own portal, none redirects the other.
    const page = await memberPage(browser, ADITYA.email, ADITYA.password);
    const w = watch(page);
    await adminSignIn(page, ADMIN.email, ADMIN.password);
    await expectAdminHome(page);
    const id = await adityaId();
    await deepLink(page, `/admin/members/${id}?tab=journal`, adminReady);
    await deepLink(page, "/app/mood", memberReady);
    await deepLink(page, "/admin/requests?view=all", adminReady);
    await deepLink(page, "/app/settings", memberReady);
    await page.context().close();
    clean(w);
  });
});
