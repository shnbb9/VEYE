import { expect, test } from "@playwright/test";
import { ADMIN, ADITYA } from "../fixtures/accounts";
import { adminSignIn, expectAdminHome, open } from "../fixtures/helpers";

/* Shape guards for console screens whose defects a content test cannot see:
   a table wider than the card holding it, a date broken across lines, a window
   of a log rendered as if it were the whole log, a destructive action with no
   border on it. Every one of these shipped past a full API suite and the
   journey specs, because none of them is something those were asked to look
   at. These assertions were each checked to fail with the defect put back. */

test.use({ viewport: { width: 1440, height: 900 } });

test.beforeEach(async ({ page }) => {
  await open(page, "/admin/login");
  await adminSignIn(page, ADMIN.email, ADMIN.password);
  await expectAdminHome(page);
});

test("no console table is wider than the card holding it", async ({ page }) => {
  // Every console screen that draws a table. A table wider than its card hides
  // its right-hand columns, and the primary action is usually the last one.
  const screens = [
    "/admin/members", "/admin/assessments", "/admin/assessments/health_number",
    "/admin/care", "/admin/requests", "/admin/content", "/admin/insights", "/admin/settings",
    "/admin/companion/conversations", "/admin/companion/feedback",
    "/admin/companion/settings/guided-experiences",
    "/admin/companion/settings/advanced/audit",
    "/admin/companion/settings/advanced/safety-analytics",
    "/admin/companion/settings/advanced/retrieval-diagnostics",
  ];
  for (const path of screens) {
    await open(page, path);
    const wraps = page.locator(".table-wrap");
    if (await wraps.count() === 0) continue;
    await expect(wraps.first()).toBeVisible();
    for (let i = 0; i < await wraps.count(); i += 1) {
      const m = await wraps.nth(i).evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
      expect(m.scrollWidth - m.clientWidth, `${path} table ${i} overflows its card by ${m.scrollWidth - m.clientWidth}px`).toBeLessThanOrEqual(1);
    }
  }
});

test("the audit log says which window of itself it is showing", async ({ page }) => {
  await open(page, "/admin/companion/settings/advanced/audit");
  const range = page.getByTestId("audit-range");
  await expect(range).toBeVisible();

  const text = await range.textContent() ?? "";
  // Either the whole log fits, or the caption positions this window inside it.
  expect(text).toMatch(/^(All \d+ entries|Entries \d+–\d+ of \d+, newest first)$/);

  if (/^Entries/.test(text)) {
    await expect(page.getByTestId("audit-newer")).toBeDisabled();
    const firstRow = await page.locator("tbody tr").first().innerText();

    await page.getByTestId("audit-older").click();
    await expect(range).toContainText("Entries 101");
    await expect(page.getByTestId("audit-newer")).toBeEnabled();
    // A second page that re-served the first page's rows would be worse than
    // none: these entries share a timestamp to the second, so the ordering
    // needs a tiebreaker or the offset hands back rows it has already sent.
    const second = await page.locator("tbody tr").first().innerText();
    expect(second).not.toBe(firstRow);

    await page.getByTestId("audit-newer").click();
    await expect(range).toContainText("Entries 1–");
    await expect.poll(() => page.locator("tbody tr").first().innerText()).toBe(firstRow);
  } else {
    // The other branch has to assert too, or on a short log this test passes
    // having checked nothing: "All N entries" is only true with no way to page.
    await expect(page.getByTestId("audit-older")).toHaveCount(0);
    await expect(page.getByTestId("audit-newer")).toHaveCount(0);
    const shown = await page.locator("tbody tr").count();
    expect(Number(text.match(/\d+/)?.[0])).toBe(shown);
  }
});

test("Member 360 keeps a date and a member's name on one line", async ({ page }) => {
  await open(page, "/admin/members");
  await page.getByRole("link", { name: ADITYA.firstName, exact: false }).first().click();
  await expect(page).toHaveURL(/\/admin\/members\/[0-9a-f-]{36}/);

  const base = page.url().split("?")[0];
  for (const [tab, anchor] of [["companion", "Conversations"], ["journal", "Food Diary"]] as const) {
    await open(page, `${base}?tab=${tab}`);
    // Wait for the tab's own content: a count() taken before React paints is a
    // count of nothing, and would pass whatever the markup said.
    await expect(page.getByRole("heading", { name: anchor })).toBeVisible();
    // Find the cells by what they hold, not by the class that fixes them: a
    // check that only looks at .t-nowrap cells passes the moment someone
    // removes the class, which is the one change it exists to catch.
    const broken = await page.evaluate(() => {
      // Both shapes the console prints: fmtDate ("Sep 15, 2026, 08:19 PM")
      // and the Food Diary's stored date and time ("2026-09-15", "08:00").
      const dateLike = /^([A-Z][a-z]{2} \d{1,2}, \d{4}(, \d{1,2}:\d{2} [AP]M)?|\d{4}-\d{2}-\d{2}|\d{1,2}:\d{2}( [AP]M)?)$/;
      const out: { text: string; lines: number }[] = [];
      let seen = 0;
      for (const cell of document.querySelectorAll("td")) {
        const text = (cell.textContent ?? "").trim();
        if (!dateLike.test(text)) continue;
        seen += 1;
        // One client rect per line box the text occupies, so cell padding is
        // never mistaken for a second line the way a height ratio can be.
        const range = document.createRange();
        range.selectNodeContents(cell);
        const lines = range.getClientRects().length;
        if (lines > 1) out.push({ text, lines });
      }
      return { out, seen };
    });
    expect(broken.seen, `${tab} tab should show at least one date`).toBeGreaterThan(0);
    expect(broken.out, `date cells on the ${tab} tab broke across lines`).toEqual([]);
  }
});

test("the account tab's destructive action looks like a control, and its icons draw", async ({ page }) => {
  await open(page, "/admin/members");
  await page.getByRole("link", { name: ADITYA.firstName, exact: false }).first().click();
  await expect(page).toHaveURL(/\/admin\/members\/[0-9a-f-]{36}/);
  await open(page, `${page.url().split("?")[0]}?tab=account`);
  await expect(page.getByTestId("m360-account-actions")).toBeVisible();

  const deactivate = page.getByTestId("account-deactivate");
  await expect(deactivate).toBeVisible();
  const border = await deactivate.evaluate((el) => getComputedStyle(el).borderTopColor);
  expect(border, "a destructive action with a transparent border reads as plain text").not.toBe("rgba(0, 0, 0, 0)");

  // Every row icon slot must actually contain a glyph: both icon components
  // answer an unknown name with null, which draws an empty circle and no error.
  const empty = await page.locator(".rowitem__icon").evaluateAll(
    (nodes) => nodes.filter((n) => !n.querySelector("svg")).length);
  expect(empty, "an icon slot rendered with no glyph in it").toBe(0);
});
