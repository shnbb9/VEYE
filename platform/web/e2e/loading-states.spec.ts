import { expect, test, type Page } from "@playwright/test";
import { ADMIN, MAYA } from "./fixtures/accounts";
import { adminSignIn, expectAdminHome, expectMemberDashboard, memberSignIn, open } from "./fixtures/helpers";

/* The flashes the owner saw (25 Nov 2026), on the kind of network that showed
   them: every stylesheet and every API answer is slow. Nothing unstyled may
   ever be visible, and a failed session check is not a sign-out. */

async function slow(page: Page, css = 700, api = 400) {
  await page.route(/\.css($|\?)/, async (route) => { await new Promise((later) => setTimeout(later, css)); await route.continue().catch(() => undefined); });
  await page.route(/\/api\/v1\//, async (route) => { await new Promise((later) => setTimeout(later, api)); await route.continue().catch(() => undefined); });
}

/** Watch every frame: is the portal's frame VISIBLE while a sheet it needs is missing? */
async function watch(page: Page) {
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { unstyled: string[] }).unstyled = seen;
    const look = () => {
      const frame = document.querySelector(".app .sidebar, .app .rail, main.auth, .quiz, .public-site");
      if (frame) {
        const missing = [...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"][href^="/"]')].filter((link) => !link.sheet);
        const visible = getComputedStyle(frame).visibility === "visible" && frame.getBoundingClientRect().height > 0;
        if (missing.length && visible) seen.push(`${location.pathname} ${frame.className} ${missing.length}`);
      }
      requestAnimationFrame(look);
    };
    requestAnimationFrame(look);
  });
}
const unstyled = (page: Page) => page.evaluate(() => (window as unknown as { unstyled: string[] }).unstyled);

test("the console, deep-linked on a slow network, shows its skeleton and then itself — never raw HTML", async ({ page }) => {
  await adminSignIn(page, ADMIN.email, ADMIN.password);
  await expectAdminHome(page);
  await slow(page);
  await watch(page);
  await page.goto("/admin/members", { waitUntil: "commit" });
  await expect(page.locator(".skel-console")).toBeVisible();
  await expect(page.getByTestId("members-table")).toBeVisible();
  await expect(page.locator(".skel-console")).toHaveCount(0);
  await page.locator(".rail a[href='/admin/requests']").click();
  await expect(page.getByTestId("requests-list")).toBeVisible();
  await page.goBack();
  await expect(page.getByTestId("members-table")).toBeVisible();
  expect(await unstyled(page)).toEqual([]);
});

test("the member app and the way out to the site and back, on a slow network", async ({ page }) => {
  await memberSignIn(page, MAYA.email, MAYA.password);
  await expectMemberDashboard(page);
  await slow(page);
  await watch(page);
  await page.goto("/app/food-diary", { waitUntil: "commit" });
  await expect(page.locator(".skel-member")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Food Diary" })).toBeVisible();
  await page.locator(".sidebar a[href='/app/progress']").click();
  await expect(page).toHaveURL(/\/app\/progress$/);
  await page.locator(".sidebar-logo").click();
  await expect(page.locator(".public-site")).toBeVisible();
  expect(await unstyled(page)).toEqual([]);
});

test("the site to sign-in and the quiz, on a slow network", async ({ page }) => {
  await slow(page);
  await watch(page);
  await page.goto("/", { waitUntil: "commit" });
  await page.locator("a[href='/login']").first().click();
  await expect(page.getByPlaceholder("Your Password")).toBeVisible();
  await page.getByRole("link", { name: "Start the process" }).click();
  await expect(page.locator(".quiz__progress")).toBeVisible();
  expect(await unstyled(page)).toEqual([]);
});

test("trackers wait as placeholders, never as 'at rest'", async ({ page }) => {
  await memberSignIn(page, MAYA.email, MAYA.password);
  await expectMemberDashboard(page);
  await page.route(/\/members\/me\/(simple-quiz|health-assessment)$/, async (route) => { await new Promise((later) => setTimeout(later, 1500)); await route.continue().catch(() => undefined); });
  await page.goto("/app");
  await expect(page.locator(".skel-cards")).toBeVisible();
  await expect(page.locator(".tracker-card--rest")).toHaveCount(0);
  await expect(page.getByTestId("tracker-cards")).toBeVisible();
});

test("one failed session check does not sign anyone out", async ({ page }) => {
  await adminSignIn(page, ADMIN.email, ADMIN.password);
  await expectAdminHome(page);
  let failures = 1;
  await page.route(/\/api\/v1\/auth\/me$/, async (route) => { if (failures > 0) { failures -= 1; await route.abort(); } else await route.continue(); });
  await page.goto("/admin/members");
  await expect(page.getByTestId("members-table")).toBeVisible();
  await expect(page).toHaveURL(/\/admin\/members$/);
});

test("an API that cannot be reached says so, keeps the place, and carries on when it returns", async ({ page }) => {
  await memberSignIn(page, MAYA.email, MAYA.password);
  await expectMemberDashboard(page);
  let down = true;
  await page.route(/\/api\/v1\/auth\/me$/, async (route) => { if (down) await route.fulfill({ status: 503, body: "{}" }); else await route.continue(); });
  await page.goto("/app/mood");
  await expect(page.getByText("You have not been signed out")).toBeVisible();
  await expect(page).toHaveURL(/\/app\/mood$/);
  down = false;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.locator(".sidebar")).toBeVisible();
  await expect(page).toHaveURL(/\/app\/mood$/);
});

test("a request that cannot reach Veye is said in words, in the portal's own error place", async ({ page }) => {
  for (const [path, call] of [["/login", "**/api/v1/auth/sign-in"], ["/admin/login", "**/api/v1/auth/admin/sign-in"]] as const) {
    await open(page, path);
    await page.route(call, (route) => route.abort());
    await page.locator('input[type="email"]').fill("somebody@demo.veye.test");
    await page.locator('input[type="password"]').first().fill("not-a-real-password");
    await page.locator('button[type="submit"]').first().click();
    await expect(page.getByText("Veye cannot be reached right now"), path).toBeVisible();
    await expect(page.locator("body"), path).not.toContainText(/Failed to fetch|Load failed|NetworkError/);
  }
});

test("signed out is still signed out", async ({ page }) => {
  await page.goto("/admin/members");
  await expect(page).toHaveURL(/\/admin\/login\?next=/);
});
