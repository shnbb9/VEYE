import { expect, test, type Page } from "@playwright/test";
import { ADMIN, ADITYA } from "./fixtures/accounts";
import { adminSignIn, expectAdminHome, expectMemberDashboard, memberSignIn, open } from "./fixtures/helpers";

/* What `aria-modal="true"` promises.
 *
 * Every dialog in this application declared it; one of them kept it. In the
 * others Tab walked out of the open dialog into the page behind the scrim —
 * out of the Content editor onto that row's Unpublish, out of the invite panel
 * onto an administrator's Deactivate — with nothing on screen to say where
 * focus had gone, and the member app's scrim painted below the sidebar so the
 * nav was still clickable over an open dialog.
 *
 * These assertions were each checked to fail with the behaviour removed. */

type Dialog = { name: string; open: (page: Page) => Promise<void>; sel: string; close?: "escape" | "none" };

async function focusIsInside(page: Page, sel: string) {
  return page.evaluate((s) => {
    const dlg = document.querySelector(s);
    return !!dlg && !!document.activeElement && dlg.contains(document.activeElement);
  }, sel);
}

/** Tab all the way round; report the first control reached outside the dialog. */
async function tabEscapesTo(page: Page, sel: string, steps = 30) {
  for (let i = 0; i < steps; i += 1) {
    await page.keyboard.press("Tab");
    const out = await page.evaluate((s) => {
      const dlg = document.querySelector(s);
      const active = document.activeElement;
      if (!dlg || !active || active === document.body || dlg.contains(active)) return null;
      return `${active.tagName.toLowerCase()}: ${(active.textContent ?? "").trim().slice(0, 40)}`;
    }, sel);
    if (out) return out;
  }
  return null;
}

async function behavesLikeAModal(page: Page, d: Dialog) {
  await d.open(page);
  await expect(page.locator(d.sel)).toBeVisible();

  // Focus must land inside. Poll: the dialog may still be animating in.
  await expect.poll(() => focusIsInside(page, d.sel), { message: `${d.name}: focus never moved into the dialog` }).toBe(true);

  expect(await tabEscapesTo(page, d.sel), `${d.name}: Tab left the dialog`).toBeNull();

  if (d.close !== "none") {
    await page.keyboard.press("Escape");
    await expect(page.locator(d.sel), `${d.name}: Escape did not close it`).toBeHidden();
  }
}

test.describe("admin drawers", () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test.beforeEach(async ({ page }) => {
    await open(page, "/admin/login");
    await adminSignIn(page, ADMIN.email, ADMIN.password);
    await expectAdminHome(page);
  });

  const drawers: { name: string; path: string; openIt: (page: Page) => Promise<void> }[] = [
    { name: "Care Studio · new item", path: "/admin/care", openIt: (p) => p.getByRole("button", { name: /^New /i }).first().click() },
    { name: "Content · new entry", path: "/admin/content", openIt: (p) => p.getByRole("button", { name: "New entry" }).first().click() },
    { name: "Content · edit", path: "/admin/content", openIt: (p) => p.getByRole("button", { name: "Edit" }).first().click() },
    { name: "Settings · invite an administrator", path: "/admin/settings?section=administrators", openIt: (p) => p.getByRole("button", { name: /Invite/i }).first().click() },
  ];

  for (const d of drawers) {
    test(`${d.name} traps focus and closes on Escape`, async ({ page }) => {
      await open(page, d.path);
      await behavesLikeAModal(page, { name: d.name, sel: ".drawer", open: () => d.openIt(page) });
    });
  }

  test("the drawer scrim covers the console chrome", async ({ page }) => {
    await open(page, "/admin/content");
    await page.getByRole("button", { name: "Edit" }).first().click();
    await expect(page.locator(".drawer")).toBeVisible();
    const topmost = await page.evaluate(() => {
      const at = (x: number, y: number) => document.elementFromPoint(x, y)?.className ?? "none";
      return { overSidebar: at(100, 300), overContent: at(500, 450) };
    });
    expect(topmost.overSidebar, "the sidebar is clickable over an open drawer").toContain("drawer-scrim");
    expect(topmost.overContent, "the page is clickable over an open drawer").toContain("drawer-scrim");
  });
});

test.describe("member dialogs", () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test.beforeEach(async ({ page }) => {
    await open(page, "/login");
    await memberSignIn(page, ADITYA.email, ADITYA.password);
    await expectMemberDashboard(page);
  });

  test("Mood Tracker: the picker and the note behave like modals, and Escape unstacks one at a time", async ({ page }) => {
    await open(page, "/app/mood");
    await behavesLikeAModal(page, {
      name: "mood picker", sel: "#moodPickerModal .modal-card", close: "none",
      open: () => page.getByRole("button", { name: /Log Your Mood Today/i }).click(),
    });
    await behavesLikeAModal(page, {
      name: "mood note", sel: "#moodNoteModal .modal-card", close: "none",
      open: () => page.locator("#moodPickerModal .emoji-btn").first().click(),
    });

    // Escape closes the note and leaves the picker, rather than dismissing both.
    await page.keyboard.press("Escape");
    await expect(page.locator("#moodNoteModal .modal-card")).toBeHidden();
    await expect(page.locator("#moodPickerModal .modal-card")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("#moodPickerModal .modal-card")).toBeHidden();
  });

  test("Meal Planning: Create a day behaves like a modal", async ({ page }) => {
    await open(page, "/app/meal-planning");
    await behavesLikeAModal(page, {
      name: "create a day", sel: "#dayModal .modal-card",
      open: () => page.getByRole("button", { name: /Create a day/ }).first().click(),
    });
  });

  test("closing a stacked dialog gives the page its scrolling back", async ({ page }) => {
    await open(page, "/app/mood");
    const overflow = () => page.evaluate(() => getComputedStyle(document.querySelector(".main")!).overflow);
    const before = await overflow();

    await page.getByRole("button", { name: /Log Your Mood Today/i }).click();
    await expect(page.locator("#moodPickerModal .modal-card")).toBeVisible();
    await page.locator("#moodPickerModal .emoji-btn").first().click();
    await expect(page.locator("#noteText")).toBeVisible();
    expect(await overflow(), "a dialog should hold the page still").toBe("hidden");

    // Out of the note, then out of the picker. Each dialog restoring its own
    // remembered value leaves the page locked, because the note recorded the
    // lock the picker had already applied.
    await page.keyboard.press("Escape");
    await expect(page.locator("#noteText")).toBeHidden();
    await page.keyboard.press("Escape");
    await expect(page.locator("#moodPickerModal .modal-card")).toBeHidden();
    await expect.poll(overflow, { message: "the page is still locked after both dialogs closed" }).toBe(before);
  });

  test("a member dialog's scrim covers the rail and the top bar", async ({ page }) => {
    await open(page, "/app/mood");
    await page.getByRole("button", { name: /Log Your Mood Today/i }).click();
    await expect(page.locator("#moodPickerModal .modal-card")).toBeVisible();
    const topmost = await page.evaluate(() => {
      const at = (x: number, y: number) => document.elementFromPoint(x, y)?.className ?? "none";
      return { overRail: at(100, 300), overTopBar: at(700, 20) };
    });
    // `section.content` is a stacking context, so an overlay rendered inside it
    // paints under the rail however high its z-index: the nav stayed live over
    // an open dialog. The overlay is portalled to <body> for this reason.
    expect(topmost.overRail, "the rail is clickable over an open dialog").toContain("modal-overlay");
    expect(topmost.overTopBar, "the top bar is clickable over an open dialog").toContain("modal-overlay");
  });
});
