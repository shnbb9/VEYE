import { expect, test, type Browser, type BrowserContextOptions, type Page } from "@playwright/test";
import { ADITYA, ADMIN } from "./fixtures/accounts";
import { adminSignIn, confirmDialog, expectAdminHome, expectMemberDashboard, expectNoHorizontalOverflow, memberSignIn, open } from "./fixtures/helpers";

/* Motion, as approved on 25 Nov 2026: 120 to 220 ms, opacity and a few pixels,
   nothing that moves what is around it, nothing that holds anything up, no
   health value on its way to itself, and none of it for a reader who asked for
   less. What is approved on screen is in the screenshots; here it is what must
   not happen. */

const LONGEST = 220;

/** Every element on the page that is moving, for how long, and what moves. */
const moving = (page: Page, within = "body") => page.evaluate((within) =>
  document.getAnimations().flatMap((animation) => {
    const effect = animation.effect as KeyframeEffect | null;
    const target = effect?.target as HTMLElement | null;
    if (!effect || !target || !document.querySelector(within)?.contains(target)) return [];
    const timing = effect.getComputedTiming();
    return [{ who: `${target.tagName.toLowerCase()}.${typeof target.className === "string" ? target.className.split(" ").join(".") : ""}`, ms: Number(timing.duration), delay: Number(timing.delay ?? 0),
      forever: timing.iterations === Infinity, what: [...new Set(effect.getKeyframes().flatMap((k) => Object.keys(k).filter((key) => !["offset", "computedOffset", "easing", "composite"].includes(key))))] }];
  }), within);

async function as(browser: Browser, who: "member" | "admin", options: BrowserContextOptions = {}): Promise<Page> {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 }, ...options })).newPage();
  if (who === "member") { await memberSignIn(page, ADITYA.email, ADITYA.password); await expectMemberDashboard(page); }
  else { await adminSignIn(page, ADMIN.email, ADMIN.password); await expectAdminHome(page); }
  return page;
}

/** What is still on the page of something that has closed. */
const leaving = (page: Page) => page.locator("[data-leaving]");

test("a question arrives quickly, leaves at once, and what is left of it can be neither used nor read", async ({ browser }) => {
  const page = await as(browser, "member");
  await open(page, "/app/settings");
  const stop = page.getByTestId("health-sharing-revoke");
  // By keyboard: it is where the focus goes back to that matters, and Safari
  // does not focus a button that is clicked.
  await stop.press("Enter");
  const dialog = page.getByTestId("confirm-dialog");
  await expect(dialog).toBeVisible();
  for (const motion of await moving(page, "[class*=overlay]")) {
    expect(motion.ms, JSON.stringify(motion)).toBeLessThanOrEqual(LONGEST);
    expect(motion.what.every((w) => ["opacity", "transform"].includes(w)), JSON.stringify(motion)).toBe(true);
  }
  await expect(page.getByTestId("confirm-no"), "the safe answer has the focus").toBeFocused();
  // Asked in one go, so it is as the page is in the frame it closed in.
  const after = await page.evaluate(() => {
    (document.querySelector("[data-testid=confirm-no]") as HTMLElement).click();
    return new Promise<Record<string, unknown>>((done) => queueMicrotask(() => requestAnimationFrame(() => {
      const copy = document.querySelector("[data-leaving]") as HTMLElement | null;
      done({ dialogs: document.querySelectorAll("[role=alertdialog]").length, inert: copy?.inert ?? null, hidden: copy?.getAttribute("aria-hidden") ?? null, pointer: copy ? getComputedStyle(copy).pointerEvents : null,
        named: copy ? copy.querySelectorAll("[id],[name],[role],[data-testid],[aria-label]").length + (copy.id ? 1 : 0) : 0, focus: (document.activeElement as HTMLElement | null)?.dataset.testid ?? null });
    })));
  });
  expect(after).toEqual({ dialogs: 0, inert: true, hidden: "true", pointer: "none", named: 0, focus: "health-sharing-revoke" });
  await expect(leaving(page)).toHaveCount(0, { timeout: 1000 });
  // Pressed again while the last one is still fading: one question, and it can be answered.
  await stop.press("Enter");
  await page.keyboard.press("Escape");
  await stop.press("Enter");
  await expect(dialog).toHaveCount(1);
  expect(await confirmDialog(page, false)).toContain("Stop sharing");
  await expect(stop).toBeFocused();
  await page.context().close();
});

test("a drawer in the console does the same, and typing in it is not lost to motion", async ({ browser }) => {
  const page = await as(browser, "admin");
  await open(page, "/admin/members");
  const add = page.getByRole("button", { name: /Add a member|Invite/ }).first();
  await add.press("Enter");
  const drawer = page.locator("[role=dialog]").first();
  await expect(drawer).toBeVisible();
  for (const motion of await moving(page, ".drawer")) expect(motion.ms, JSON.stringify(motion)).toBeLessThanOrEqual(280);
  await drawer.locator("input").first().fill("typed while it was arriving");
  await expect(drawer.locator("input").first()).toHaveValue("typed while it was arriving");
  await page.keyboard.press("Escape");
  await expect(page.locator("[role=dialog]")).toHaveCount(0);
  await expect(leaving(page)).toHaveCount(0, { timeout: 1000 });
  await expect(add).toBeFocused();
  await add.click();
  await expect(page.locator("[role=dialog]")).toHaveCount(1);
  await expect(page.locator("[role=dialog] input").first(), "a closed drawer left nothing behind").not.toHaveValue("typed while it was arriving");
  await page.context().close();
});

for (const portal of ["member", "admin"] as const) {
  test(`going from page to page in the ${portal} app: the frame stays, the page is there, and nothing is pushed`, async ({ browser }) => {
    const page = await as(browser, portal);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const links = portal === "member" ? ["/app/mood", "/app/food-diary", "/app/progress", "/app/companion", "/app/settings", "/app"]
      : ["/admin/members", "/admin/content", "/admin/insights", "/admin/settings", "/admin"];
    const side = page.locator(portal === "member" ? ".sidebar" : "#rail");
    const before = await side.boundingBox();
    for (const href of links) {
      await page.locator(`a[href="${href}"]:visible`).first().click();
      await expect(page).toHaveURL(new RegExp(`${href}(\\?.*)?$`));
      // Whatever is fading in is there within the time it may take, and is only fading.
      await expect.poll(() => page.evaluate(() => {
        const at = document.elementFromPoint(innerWidth * 0.6, innerHeight * 0.4);
        let opacity = 1;
        for (let el: Element | null = at; el; el = el.parentElement) opacity *= Number(getComputedStyle(el).opacity);
        return opacity;
      }), { timeout: 1500 }).toBe(1);
      expect(await side.boundingBox(), `${href}: the frame did not move`).toEqual(before);
      await expectNoHorizontalOverflow(page);
      expect((await page.locator("main").first().innerText()).trim().length, `${href} is not blank`).toBeGreaterThan(20);
    }
    expect(errors).toEqual([]);
    await page.context().close();
  });
}

test("a health value is never shown as anything but itself", async ({ browser }) => {
  const page = await as(browser, "member");
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { seen: string[] }).seen = seen;
    const look = () => document.querySelectorAll(".hn-value").forEach((el) => {
      const text = (el.textContent ?? "").trim();
      if (text && seen.at(-1) !== text) seen.push(text);
    });
    new MutationObserver(look).observe(document, { childList: true, subtree: true, characterData: true });
    setInterval(look, 8);
  });
  await open(page, "/app");
  await expect(page.locator(".hn-value").first()).toHaveText(/^\d+(\.\d)?$/);
  await page.waitForTimeout(1500);
  const seen = await page.evaluate(() => (window as unknown as { seen: string[] }).seen.filter((text) => text !== "—"));
  expect([...new Set(seen)], "one value, from the first time there is one").toEqual([await page.locator(".hn-value").first().innerText()]);
  await page.context().close();
});

test("nothing on the approved screens moves for longer than it may", async ({ browser }) => {
  const page = await as(browser, "member");
  for (const [path, selectors, which] of [
    // The cards' own hover on the dashboard was approved before this and is as it was; their arrival is what changed.
    ["/app", [".fade-in"], "animation"], ["/app", [".hn-value"], "both"],
    ["/app/food-diary", [".fdx-panel", ".fdx-meal", ".fdxcal-weeks", ".fdx-view"], "both"], ["/app/settings", [".choice__panel", ".settings-save", ".settings-outline"], "both"],
  ] as const) {
    await open(page, path);
    await page.waitForLoadState("networkidle");
    for (const selector of selectors) {
      const over = await page.evaluate(({ selector, longest, which }) => [...document.querySelectorAll(selector)].flatMap((el) => {
        const s = getComputedStyle(el);
        const ms = (list: string) => list.split(",").map((part) => parseFloat(part) * (part.trim().endsWith("ms") ? 1 : 1000));
        return [...ms(s.animationDuration), ...(which === "both" ? ms(s.transitionDuration) : [])].filter((value) => value > longest);
      }), { selector, longest: LONGEST, which });
      expect(over, `${path} ${selector}`).toEqual([]);
    }
  }
  await page.context().close();
});

test("with less motion asked for there is none, and everything still works", async ({ browser }) => {
  const member = await as(browser, "member", { reducedMotion: "reduce" });
  await open(member, "/app/settings");
  await expect(member.getByTestId("sprout-state")).toBeVisible();
  for (const el of await member.locator(".fade-in").all()) expect(await el.evaluate((node) => getComputedStyle(node).opacity)).toBe("1");
  await member.getByTestId("health-sharing-revoke").click();
  await expect(member.getByTestId("confirm-dialog")).toBeVisible();
  const still = (await moving(member)).filter((m) => m.ms > 1);
  expect(still, JSON.stringify(still)).toEqual([]);
  const left = await member.evaluate(() => {
    (document.querySelector("[data-testid=confirm-no]") as HTMLElement).click();
    return new Promise<number>((done) => requestAnimationFrame(() => done(document.querySelectorAll("[data-leaving]").length)));
  });
  expect(left, "no picture of what has gone").toBe(0);
  await member.locator(".sidebar a[href='/app/mood']").click();
  await expect(member).toHaveURL(/\/app\/mood$/);
  expect((await moving(member)).filter((m) => m.ms > 1)).toEqual([]);
  await member.context().close();

  const admin = await as(browser, "admin", { reducedMotion: "reduce" });
  await open(admin, "/admin/members");
  await admin.getByRole("button", { name: /Add a member|Invite/ }).first().click();
  await expect(admin.locator("[role=dialog]").first()).toBeVisible();
  expect((await moving(admin)).filter((m) => m.ms > 1 && !m.forever)).toEqual([]);
  await admin.keyboard.press("Escape");
  await expect(admin.locator("[role=dialog]")).toHaveCount(0);
  await expect(leaving(admin)).toHaveCount(0);
  await admin.context().close();
});

test("signed out, a deep link goes to the right door, without a flash of what is behind it", async ({ browser }) => {
  for (const [path, door] of [["/app/settings", "/login"], ["/admin/members", "/admin/login"]] as const) {
    const page = await (await browser.newContext()).newPage();
    await page.addInitScript(() => {
      (window as unknown as { shown: string[] }).shown = [];
      setInterval(() => {
        const text = document.body?.innerText ?? "";
        if (/Your privacy choices|Add a member/.test(text)) (window as unknown as { shown: string[] }).shown.push(text.slice(0, 80));
      }, 10);
    });
    await page.goto(path);
    await expect(page).toHaveURL(new RegExp(door));
    expect(await page.evaluate(() => (window as unknown as { shown: string[] }).shown ?? [])).toEqual([]);
    await page.context().close();
  }
});
