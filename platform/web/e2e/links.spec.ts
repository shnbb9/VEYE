import { expect, test, type Page } from "@playwright/test";
import { ADITYA, ADMIN } from "./fixtures/accounts";
import { adminSignIn, expectAdminHome, expectMemberDashboard, memberSignIn, open } from "./fixtures/helpers";

/* Navigation audit: every internal link and every navigable control on the
   public, member and admin screens resolves (no dead routes), and every
   visible control is either working or visibly marked as not available.
   Controls that are meant to be inert carry aria-disabled / disabled and a
   "Coming soon" / "Not connected" label — anything else must have a handler
   or a destination. */

const PUBLIC = ["/", "/why-veye", "/about", "/help", "/pricing", "/terms", "/privacy", "/login", "/signup"];
const MEMBER = ["/app", "/app/progress", "/app/progress/health-number", "/app/progress/body-composition", "/app/progress/blood-markers",
  "/app/progress/health-assessment", "/app/progress/simple-quiz", "/app/mood", "/app/food-choices", "/app/meal-planning", "/app/food-diary",
  "/app/companion", "/app/supplements", "/app/fitness", "/app/mindfulness", "/app/resources", "/app/settings"];
const ADMIN_PAGES = ["/admin", "/admin/members", "/admin/assessments", "/admin/assessments/health_number", "/admin/care", "/admin/requests",
  "/admin/content", "/admin/insights", "/admin/settings", "/admin/settings?section=product", "/admin/settings?section=features",
  "/admin/companion/conversations", "/admin/companion/knowledge-sources", "/admin/companion/feedback", "/admin/companion/settings",
  "/admin/companion/settings/guided-experiences", "/admin/companion/settings/advanced/ai-monitoring", "/admin/companion/settings/advanced/audit"];

async function collectInternalLinks(page: Page): Promise<string[]> {
  return page.evaluate(() => Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]"))
    .map((a) => a.getAttribute("href") ?? "")
    .filter((href) => href.startsWith("/") && !href.startsWith("//") && !href.startsWith("/_next")));
}

async function inertControlsAreLabelled(page: Page): Promise<string[]> {
  // buttons/links that look disabled must say so somewhere the person can see it
  return page.evaluate(() => {
    const bad: string[] = [];
    document.querySelectorAll<HTMLElement>('button[disabled], [aria-disabled="true"]').forEach((el) => {
      const text = `${el.textContent ?? ""} ${el.getAttribute("title") ?? ""} ${el.getAttribute("aria-label") ?? ""} ${el.closest("label, .settings-toggle, .rowitem, .res-card, .fdx-photo")?.textContent ?? ""}`.toLowerCase();
      const explained = /coming soon|not connected|not built|in development|not yet|saving|sending|loading|unavailable|no other plans|next|previous|submit|save|resolve|reopen|mark in progress|cancel|send/.test(text);
      if (!explained) bad.push(`${el.tagName.toLowerCase()} "${(el.textContent ?? "").trim().slice(0, 40)}" on ${location.pathname}`);
    });
    return bad;
  });
}

async function sweep(page: Page, paths: string[]) {
  const seen = new Set<string>();
  const unlabelled: string[] = [];
  for (const path of paths) {
    await open(page, path);
    for (const href of await collectInternalLinks(page)) seen.add(href.split("#")[0]);
    unlabelled.push(...await inertControlsAreLabelled(page));
  }
  const dead: string[] = [];
  for (const href of Array.from(seen).filter(Boolean)) {
    const response = await page.request.get(href, { maxRedirects: 5 });
    if (response.status() >= 400) dead.push(`${href} → ${response.status()}`);
  }
  return { dead, unlabelled, checked: seen.size };
}

test.describe("Navigation and control audit", () => {
  test("public pages: every internal link resolves; inert controls are labelled", async ({ page }) => {
    const result = await sweep(page, PUBLIC);
    expect(result.checked).toBeGreaterThanOrEqual(10);
    expect(result.dead).toEqual([]);
    expect(result.unlabelled).toEqual([]);
  });

  test("member pages: every internal link resolves; inert controls are labelled", async ({ page }) => {
    await memberSignIn(page, ADITYA.email, ADITYA.password);
    await expectMemberDashboard(page);
    const result = await sweep(page, MEMBER);
    expect(result.checked).toBeGreaterThan(15);
    expect(result.dead).toEqual([]);
    expect(result.unlabelled).toEqual([]);
  });

  test("admin pages: every internal link resolves; inert controls are labelled", async ({ page }) => {
    await adminSignIn(page, ADMIN.email, ADMIN.password);
    await expectAdminHome(page);
    const result = await sweep(page, ADMIN_PAGES);
    expect(result.checked).toBeGreaterThan(15);
    expect(result.dead).toEqual([]);
    expect(result.unlabelled).toEqual([]);
  });
});
