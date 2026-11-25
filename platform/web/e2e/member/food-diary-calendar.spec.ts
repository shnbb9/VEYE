import { expect, test, type Browser, type Page } from "@playwright/test";
import { freshMember } from "../fixtures/accounts";
import { confirmDialog, expectNoHorizontalOverflow, memberApi, open, sendAs, signUpMember } from "../fixtures/helpers";

/* The Food Diary's History as a month (owner, 25 Nov 2026), and what had to be
   made safe for it: opening another day while a meal is half written, an answer
   that arrives after the person has moved on, and two presses of one button.

   Days are real calendar days in the browser's own time zone, so the clock is
   set where a day could be lost: before midnight, in a leap February, at the
   turn of a year, and on both sides of the date line. */

type Entry = { entry_date: string; meal_time: string; description: string; feelings?: string[]; notes?: string };

async function member(browser: Browser, options: { timezoneId?: string; now?: string; viewport?: { width: number; height: number } } = {}) {
  const context = await browser.newContext({ timezoneId: options.timezoneId, viewport: options.viewport ?? { width: 1440, height: 1000 } });
  const page = await context.newPage();
  await signUpMember(page, freshMember("e2e"));
  if (options.now) await page.clock.setFixedTime(new Date(options.now));
  return page;
}

async function log(page: Page, ...entries: Entry[]) {
  for (const entry of entries) {
    const sent = await sendAs(page, "POST", "/api/v1/members/me/food-diary", { feelings: [], notes: "", ...entry });
    expect(sent.status, JSON.stringify(sent.body)).toBe(201);
  }
}

const day = (page: Page, key: string) => page.locator(`[data-cal-day="${key}"]`);
const month = (page: Page) => page.locator(".fdxcal-month");
const meals = (page: Page) => page.getByTestId("diary-meals").locator(".fdx-meal");
const openDay = (page: Page, key: string) => expect(page.getByTestId("diary-day")).toHaveAttribute("data-day", key);

async function openDiary(page: Page, query = "") {
  await open(page, `/app/food-diary${query}`);
  await expect(page.getByTestId("diary-day")).toHaveAttribute("aria-busy", "false");
}

async function openCalendar(page: Page) {
  if (await page.locator("#fdxHistoryBtn").getAttribute("aria-expanded") !== "true") await page.locator("#fdxHistoryBtn").click();
  await page.getByTestId("diary-view-calendar").click();
  await expect(page.getByTestId("diary-calendar")).toBeVisible();
}

const NOON = "2026-11-25T12:00:00Z";
const ROWS: Entry[] = [
  { entry_date: "2026-11-25", meal_time: "08:00", description: "Porridge with berries", feelings: ["Hungry", "Relaxed"], notes: "Before the school run" },
  { entry_date: "2026-11-25", meal_time: "13:00", description: "Lentil soup" },
  { entry_date: "2026-11-25", meal_time: "19:00", description: "Baked salmon" },
  { entry_date: "2026-11-10", meal_time: "12:15", description: "Chicken salad", feelings: ["Rushed"], notes: "At the desk" },
  { entry_date: "2026-10-31", meal_time: "18:30", description: "Halloween soup" },
];

test.describe("the diary's calendar", () => {
  test("the list stays, the icon opens the month, and any day in it opens in Your day", async ({ browser }) => {
    const page = await member(browser, { timezoneId: "UTC", now: NOON });
    await openDiary(page);
    await log(page, ...ROWS);
    expect((await sendAs(page, "POST", "/api/v1/members/me/food-diary/days/2026-11-10/save", {})).status).toBe(200);
    await openDiary(page);

    // The list, as it always was, newest first.
    await page.locator("#fdxHistoryBtn").click();
    await expect(page.getByTestId("diary-view-list")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".fdx-hist-row b")).toHaveText(["2026-11-25", "2026-11-10", "2026-10-31"]);

    // The month: this one first, marks where there are meals.
    await page.getByTestId("diary-view-calendar").click();
    await expect(page.getByTestId("diary-calendar")).toBeVisible();
    await expect(page.locator(".fdx-hist-row")).toHaveCount(3);
    await expect(page.locator(".fdx-hist-row").first()).toBeHidden();
    await expect(month(page)).toContainText("2026");
    await expect(day(page, "2026-11-25")).toHaveAttribute("aria-current", "date");
    await expect(day(page, "2026-11-25")).toHaveAccessibleName(/3 meals logged/);
    await expect(day(page, "2026-11-25")).toHaveClass(/has-meals/);
    await expect(day(page, "2026-11-24")).toHaveAccessibleName(/nothing logged/);
    await expect(day(page, "2026-11-24")).not.toHaveClass(/has-meals/);
    await expect(page.getByTestId("diary-calendar-day")).toContainText("3 meals");

    // A day with meals opens where meals are: description, time, feelings, notes.
    await day(page, "2026-11-10").click();
    await openDay(page, "2026-11-10");
    await expect(page.locator("#fdxDate")).toHaveValue("2026-11-10");
    await expect(meals(page)).toHaveCount(1);
    await expect(meals(page).first()).toContainText("Chicken salad");
    await expect(meals(page).first()).toContainText("12:15");
    await expect(meals(page).first()).toContainText("Rushed");
    await expect(meals(page).first()).toContainText("At the desk");
    await expect(page.getByTestId("diary-calendar-day")).toContainText("1 meal");

    // A day without any says so, and is not an error.
    await day(page, "2026-11-11").click();
    await openDay(page, "2026-11-11");
    await expect(page.locator("#fdxEmpty")).toBeVisible();
    await expect(page.getByTestId("diary-calendar-day")).toContainText("Nothing logged on this day");

    // Back to the list, and a row of it opens its day.
    await page.getByTestId("diary-view-list").click();
    await expect(page.getByTestId("diary-calendar")).toHaveCount(0);
    await page.locator('[data-fdx-day="2026-11-25"]').click();
    await openDay(page, "2026-11-25");
    await expect(meals(page)).toHaveCount(3);
    await expect(page.locator("#fdxHistory")).toBeHidden();
    await page.context().close();
  });

  test("pages of the month turn without touching the open day, and the date controls turn them too", async ({ browser }) => {
    const page = await member(browser, { timezoneId: "UTC", now: NOON });
    await openDiary(page);
    await log(page, ...ROWS);
    await openDiary(page);
    await openCalendar(page);
    const calendar = page.getByTestId("diary-calendar");
    await calendar.getByRole("button", { name: "Previous month" }).click();
    await expect(day(page, "2026-10-31")).toHaveClass(/has-meals/);
    await openDay(page, "2026-11-25");
    await calendar.getByRole("button", { name: "Next month" }).click();
    await calendar.getByRole("button", { name: "Next month" }).click();
    await expect(day(page, "2026-12-31")).toBeVisible();
    await calendar.getByRole("button", { name: "Next month" }).click();
    await expect(month(page)).toContainText("2027");
    await expect(day(page, "2027-01-01")).toBeVisible();
    await calendar.getByRole("button", { name: "This month" }).click();
    await expect(day(page, "2026-11-25")).toBeVisible();

    // The arrows and the date box move both.
    await page.locator("#fdxPrevDay").click();
    await openDay(page, "2026-11-24");
    await expect(day(page, "2026-11-24")).toHaveClass(/is-open/);
    await page.locator("#fdxDate").fill("2026-10-31");
    await openDay(page, "2026-10-31");
    await expect(day(page, "2026-10-31")).toHaveClass(/is-open/);
    await expect(meals(page).first()).toContainText("Halloween soup");
    await page.locator("#fdxNextDay").click();
    await openDay(page, "2026-11-01");
    await expect(day(page, "2026-11-01"), "the page turned with it").toHaveClass(/is-open/);
    await page.context().close();
  });

  test("a saved day, an unsaved one and an empty one look and read differently, and change as the day does", async ({ browser }) => {
    const page = await member(browser, { timezoneId: "UTC", now: NOON });
    await openDiary(page);
    await log(page, ...ROWS);
    await openDiary(page);
    await openCalendar(page);
    await expect(day(page, "2026-11-25")).not.toHaveClass(/is-saved/);
    await page.locator("#fdxSaveDay").click();
    await expect(page.locator("#fdxSavedNote")).toBeVisible();
    await expect(day(page, "2026-11-25")).toHaveClass(/is-saved/);
    await expect(day(page, "2026-11-25")).toHaveAccessibleName(/3 meals logged, saved/);
    await expect(page.getByTestId("diary-calendar-day")).toContainText("saved");
    await expect(day(page, "2026-11-10")).toHaveClass(/has-meals/);
    await expect(day(page, "2026-11-10")).not.toHaveClass(/is-saved/);

    // Editing changes what is kept; removing the last meal takes the mark away.
    await day(page, "2026-11-10").click();
    await openDay(page, "2026-11-10");
    await meals(page).first().getByRole("button", { name: "Edit" }).click();
    await page.locator("#fdxWhat").fill("Chicken salad with avocado");
    await page.getByRole("button", { name: "Update Entry" }).click();
    await expect(meals(page).first()).toContainText("avocado");
    await expect(page.getByTestId("diary-target")).toContainText("This will be added to");
    await meals(page).first().getByRole("button", { name: "Remove" }).click();
    await expect(meals(page)).toHaveCount(0);
    await expect(page.locator("#fdxEmpty")).toBeVisible();
    await expect(day(page, "2026-11-10")).not.toHaveClass(/has-meals/);

    // Adding one puts it back, on the day the form said it would.
    await page.locator("#fdxWhat").fill("Apple");
    await page.locator("#fdxTime").fill("16:00");
    await page.getByRole("button", { name: "Add Entry" }).click();
    await expect(meals(page)).toHaveCount(1);
    await expect(day(page, "2026-11-10")).toHaveClass(/has-meals/);
    const stored = await memberApi<{ meals: { description: string; entry_date: string }[] }>(page, "/api/v1/members/me/food-diary?date=2026-11-10");
    expect(stored.meals.map((m) => [m.description, m.entry_date])).toEqual([["Apple", "2026-11-10"]]);
    await page.context().close();
  });

  test("a reload and the Back button come back to the same day and the same view", async ({ browser }) => {
    const page = await member(browser, { timezoneId: "UTC", now: NOON });
    await openDiary(page);
    await log(page, ...ROWS);
    await openDiary(page);
    await openCalendar(page);
    await day(page, "2026-11-10").click();
    await openDay(page, "2026-11-10");
    await expect(page).toHaveURL(/\?date=2026-11-10$/);
    await page.reload({ waitUntil: "domcontentloaded" });
    await openDay(page, "2026-11-10");
    await expect(meals(page)).toHaveCount(1);
    await expect(page.getByTestId("diary-calendar")).toBeVisible();
    await expect(day(page, "2026-11-10")).toHaveClass(/is-open/);
    await page.locator(".sidebar a[href='/app/mood']").click();
    await expect(page).toHaveURL(/\/app\/mood$/);
    await page.goBack();
    await openDay(page, "2026-11-10");
    await expect(page.getByTestId("diary-calendar")).toBeVisible();
    // Today is the plain address; a date that is not one is today.
    await page.locator("#fdxDate").fill("2026-11-25");
    await expect(page).toHaveURL(/\/app\/food-diary$/);
    for (const wrong of ["2026-02-30", "not-a-date", "2026-13-01", ""]) {
      await openDiary(page, `?date=${wrong}`);
      await openDay(page, "2026-11-25");
    }
    await page.context().close();
  });

  test("leap years, short months and the turn of the year", async ({ browser }) => {
    const page = await member(browser, { timezoneId: "UTC", now: "2028-02-29T12:00:00Z" });
    await openDiary(page);
    await openDay(page, "2028-02-29");
    await openCalendar(page);
    await expect(page.locator("[data-cal-day]")).toHaveCount(29);
    await expect(day(page, "2028-02-29")).toHaveAttribute("aria-current", "date");
    await openDiary(page, "?date=2027-02-28");
    await expect(page.locator("[data-cal-day]")).toHaveCount(28);
    await page.locator("#fdxNextDay").click();
    await openDay(page, "2027-03-01");
    await expect(page.locator("[data-cal-day]")).toHaveCount(31);
    await page.locator("#fdxDate").fill("2026-12-31");
    await openDay(page, "2026-12-31");
    await page.locator("#fdxNextDay").click();
    await openDay(page, "2027-01-01");
    await expect(day(page, "2027-01-01")).toHaveClass(/is-open/);
    await page.locator("#fdxPrevDay").click();
    await openDay(page, "2026-12-31");
    // The same height whatever the month, so turning pages moves nothing.
    const heights = new Set<number>();
    for (const key of ["2026-02-10", "2026-05-10", "2026-08-10", "2026-11-10"]) {
      await page.locator("#fdxDate").fill(key);
      await openDay(page, key);
      heights.add(Math.round((await page.locator(".fdxcal-weeks").boundingBox())!.height));
    }
    expect(heights.size, [...heights].join()).toBe(1);
    await page.context().close();
  });

  for (const [timezoneId, now, local] of [
    ["America/Los_Angeles", "2026-03-01T07:30:00Z", "2026-02-28"],   // still February there
    ["Pacific/Auckland", "2026-02-28T11:30:00Z", "2026-03-01"],      // already March there
    ["America/New_York", "2026-03-08T16:00:00Z", "2026-03-08"],      // the clocks went forward that morning
    ["Asia/Kolkata", "2026-12-31T19:00:00Z", "2027-01-01"],          // the new year, there only
  ] as const) {
    test(`today is the member's own day in ${timezoneId}`, async ({ browser }) => {
      const page = await member(browser, { timezoneId, now });
      await openDiary(page);
      await openDay(page, local);
      await expect(page.locator("#fdxDate")).toHaveValue(local);
      await openCalendar(page);
      await expect(day(page, local)).toHaveAttribute("aria-current", "date");
      await page.locator("#fdxWhat").fill("Late supper");
      await page.locator("#fdxTime").fill("23:30");
      await page.getByRole("button", { name: "Add Entry" }).click();
      await expect(meals(page)).toHaveCount(1);
      await expect(day(page, local)).toHaveClass(/has-meals/);
      await expect(page.locator(".fdxcal-cell.has-meals")).toHaveCount(1);
      const stored = await memberApi<{ meals: { entry_date: string }[] }>(page, `/api/v1/members/me/food-diary?date=${local}`);
      expect(stored.meals.map((m) => m.entry_date)).toEqual([local]);
      await page.context().close();
    });
  }

  test("the keyboard alone: one stop, arrows, weeks, months, years, and Enter opens", async ({ browser }) => {
    const page = await member(browser, { timezoneId: "UTC", now: NOON });
    await openDiary(page);
    await openCalendar(page);
    await expect(page.locator('[data-cal-day][tabindex="0"]')).toHaveCount(1);
    await day(page, "2026-11-25").focus();
    const at = (key: string) => expect(day(page, key)).toBeFocused();
    await page.keyboard.press("ArrowLeft"); await at("2026-11-24");
    await page.keyboard.press("ArrowUp"); await at("2026-11-17");
    await page.keyboard.press("Home"); await at("2026-11-15");
    await page.keyboard.press("End"); await at("2026-11-21");
    await page.keyboard.press("ArrowDown"); await page.keyboard.press("ArrowDown"); await at("2026-12-05");   // into the next page
    await page.keyboard.press("PageUp"); await at("2026-11-05");
    await page.keyboard.press("PageUp"); await page.keyboard.press("PageUp"); await at("2026-09-05");
    await page.keyboard.press("Shift+PageDown"); await at("2027-09-05");
    await openDay(page, "2026-11-25");     // moving about opens nothing
    await page.keyboard.press("Enter");
    await openDay(page, "2027-09-05");
    await at("2027-09-05");                // and the focus stays where it was
    await expect(page.locator('[data-cal-day][tabindex="0"]')).toHaveCount(1);
    await expect(page.locator('[role="gridcell"][aria-selected="true"]')).toHaveCount(1);
    // The last day of a long month goes to the last day of a short one.
    await page.locator("#fdxDate").fill("2026-01-31");
    await openDay(page, "2026-01-31");
    await day(page, "2026-01-31").focus();
    await page.keyboard.press("PageDown"); await at("2026-02-28");
    await page.context().close();
  });

  test("on a phone it fits, and every day is big enough to press", async ({ browser }) => {
    const page = await member(browser, { timezoneId: "UTC", now: NOON, viewport: { width: 390, height: 844 } });
    await openDiary(page);
    await log(page, ...ROWS);
    await openDiary(page);
    await openCalendar(page);
    await expectNoHorizontalOverflow(page);
    const calendar = (await page.getByTestId("diary-calendar").boundingBox())!;
    expect(calendar.x).toBeGreaterThanOrEqual(0);
    expect(calendar.x + calendar.width).toBeLessThanOrEqual(390);
    const cell = (await day(page, "2026-11-10").boundingBox())!;
    expect(Math.min(cell.width, cell.height)).toBeGreaterThanOrEqual(24);
    await day(page, "2026-11-10").click();
    await openDay(page, "2026-11-10");
    await expect(page.locator("#fdxRightTitle"), "the day it opened is brought into view").toBeInViewport();
    for (const width of [320, 768, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      await expectNoHorizontalOverflow(page);
    }
    await page.context().close();
  });

  test("one member's days are never in another's calendar", async ({ browser }) => {
    const a = await member(browser, { timezoneId: "UTC", now: NOON });
    await openDiary(a);
    await log(a, ...ROWS);
    const b = await member(browser, { timezoneId: "UTC", now: NOON });
    await openDiary(b, "?date=2026-11-10");
    await openCalendar(b);
    await expect(b.locator(".fdxcal-cell.has-meals")).toHaveCount(0);
    await expect(b.locator("#fdxEmpty")).toBeVisible();
    await expect(b.locator("body")).not.toContainText("Chicken salad");
    // The same browser, the other person: nothing of the first is left behind.
    await a.context().close();
    await b.context().close();
  });
});

test.describe("opening another day", () => {
  test("a meal being edited asks before it is left, and a new one keeps its words and says its day", async ({ browser }) => {
    const page = await member(browser, { timezoneId: "UTC", now: NOON });
    await openDiary(page);
    await log(page, ...ROWS);
    await openDiary(page);
    await openCalendar(page);

    // Nothing changed: no question.
    await meals(page).first().getByRole("button", { name: "Edit" }).click();
    await day(page, "2026-11-10").click();
    await openDay(page, "2026-11-10");
    await expect(page.locator("#fdxWhat"), "the words of the other day's meal do not come with").toHaveValue("");

    // Changed: asked, whichever way the day is left.
    await meals(page).first().getByRole("button", { name: "Edit" }).click();
    await page.locator("#fdxNotes").fill("A note I have not saved");
    for (const leave of [
      () => day(page, "2026-11-25").click(), () => page.locator("#fdxPrevDay").click(), () => page.locator("#fdxNextDay").click(),
      () => page.locator("#fdxDate").fill("2026-11-01"),
      async () => { await page.getByTestId("diary-view-list").click(); await page.locator('[data-fdx-day="2026-10-31"]').click(); },
    ]) {
      await leave();
      expect(await confirmDialog(page, false)).toContain("Leave without saving");
      await openDay(page, "2026-11-10");
      await expect(page.locator("#fdxDate")).toHaveValue("2026-11-10");
      await expect(page.locator("#fdxNotes")).toHaveValue("A note I have not saved");
      await expect(page.getByRole("button", { name: "Update Entry" })).toBeVisible();
    }
    // Escape is "keep editing" too.
    await page.locator("#fdxPrevDay").click();
    await expect(page.getByTestId("confirm-dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("confirm-dialog")).toHaveCount(0);
    await openDay(page, "2026-11-10");

    // Leaving: the day opens, the form is clear, and the meal is as it was.
    await page.locator("#fdxPrevDay").click();
    await confirmDialog(page);
    await openDay(page, "2026-11-09");
    await expect(page.locator("#fdxNotes")).toHaveValue("");
    await expect(page.getByRole("button", { name: "Add Entry" })).toBeVisible();
    const kept = await memberApi<{ meals: { notes: string; entry_date: string }[] }>(page, "/api/v1/members/me/food-diary?date=2026-11-10");
    expect(kept.meals.map((m) => m.notes)).toEqual(["At the desk"]);

    // A new meal belongs to no day yet: its words stay, and the form says where it will go.
    await page.locator("#fdxWhat").fill("Draft omelette");
    await page.locator("#fdxTime").fill("09:00");
    await page.locator("#fdxNextDay").click();
    await openDay(page, "2026-11-10");
    await expect(page.getByTestId("confirm-dialog")).toHaveCount(0);
    await expect(page.locator("#fdxWhat")).toHaveValue("Draft omelette");
    await expect(page.getByTestId("diary-target")).toContainText("November");
    await page.getByRole("button", { name: "Add Entry" }).click();
    await expect(meals(page)).toHaveCount(2);
    await page.locator("#fdxDate").fill("2026-11-25");
    await openDay(page, "2026-11-25");
    await expect(page.getByTestId("diary-target")).toHaveCount(0);   // today needs no telling
    await expect(meals(page)).toHaveCount(3);
    await page.context().close();
  });

  test("while a day loads there is nothing of the last one, no false 'no entries', and no jump", async ({ browser }) => {
    const page = await member(browser, { timezoneId: "UTC", now: NOON });
    await openDiary(page);
    await log(page, ...ROWS);
    await openDiary(page);
    await expect(meals(page)).toHaveCount(3);
    const before = (await page.getByTestId("diary-day").boundingBox())!.height;
    await page.route("**/api/v1/members/me/food-diary?date=2026-11-10", async (route) => { await new Promise((r) => setTimeout(r, 900)); await route.continue(); });
    await page.locator("#fdxDate").fill("2026-11-10");
    await expect(page.getByTestId("diary-day")).toHaveAttribute("aria-busy", "true");
    await expect(meals(page)).toHaveCount(0);
    await expect(page.locator("#fdxEmpty")).toBeHidden();
    await expect(page.locator("#fdxSummary")).toBeEmpty();
    expect(Math.round((await page.getByTestId("diary-day").boundingBox())!.height)).toBeGreaterThanOrEqual(Math.round(before) - 1);
    await expect(meals(page)).toHaveCount(1);
    await expect(page.getByTestId("diary-day")).toHaveAttribute("aria-busy", "false");
    await page.context().close();
  });

  test("what was said of one day is not said of the next, even while it loads or cannot be read", async ({ browser }) => {
    const page = await member(browser, { timezoneId: "UTC", now: NOON });
    await openDiary(page);
    await log(page, ...ROWS);
    await openDiary(page);
    await page.locator("#fdxFeedback").click();
    await expect(page.locator("#fdxFeedbackOut")).toBeVisible();
    await page.locator("#fdxSaveDay").click();
    await expect(page.locator("#fdxSavedNote")).toBeVisible();
    await page.route("**/api/v1/members/me/food-diary?date=2026-11-10", (route) => route.abort());
    await page.locator("#fdxDate").fill("2026-11-10");
    await expect(page.locator(".fdx-loaderr")).toBeVisible();
    await expect(page.locator("#fdxFeedbackOut")).toBeHidden();
    await expect(page.locator("#fdxSavedNote")).toBeHidden();
    await page.context().close();
  });

  test("an answer that comes back late belongs to its own day", async ({ browser }) => {
    const page = await member(browser, { timezoneId: "UTC", now: NOON });
    await openDiary(page);
    await log(page, ...ROWS);
    await openDiary(page);
    await page.route("**/api/v1/members/me/food-diary?date=2026-11-10", async (route) => { await new Promise((r) => setTimeout(r, 1200)); await route.continue(); });
    const late = page.waitForResponse((r) => r.url().includes("date=2026-11-10"));
    await page.locator("#fdxDate").fill("2026-11-10");
    await page.locator("#fdxDate").fill("2026-10-31");
    await expect(meals(page)).toHaveCount(1);
    await expect(meals(page).first()).toContainText("Halloween soup");
    await late;
    await page.waitForTimeout(200);
    await expect(meals(page).first()).toContainText("Halloween soup");

    // A meal saved while another day was opened: filed under its own day, and
    // the day on screen is not replaced by it.
    await page.locator("#fdxWhat").fill("Slow toast");
    await page.locator("#fdxTime").fill("07:00");
    await page.route("**/api/v1/members/me/food-diary", async (route) => {
      if (route.request().method() === "POST") await new Promise((r) => setTimeout(r, 900));
      await route.continue();
    });
    await page.getByRole("button", { name: "Add Entry" }).click();
    await page.locator("#fdxNextDay").click();       // not while it is being saved
    await openDay(page, "2026-10-31");
    await expect(meals(page)).toHaveCount(2);
    await page.context().close();
  });

  test("a day that cannot be read says so and can be tried again", async ({ browser }) => {
    const page = await member(browser, { timezoneId: "UTC", now: NOON });
    await openDiary(page);
    await log(page, ...ROWS);
    await openDiary(page);
    let broken = true;
    await page.route("**/api/v1/members/me/food-diary?date=2026-11-10", (route) => broken ? route.abort() : route.continue());
    await page.locator("#fdxDate").fill("2026-11-10");
    await expect(page.locator(".fdx-loaderr")).toContainText("Veye cannot be reached");
    await expect(page.locator("#fdxEmpty"), "not knowing is not the same as nothing").toBeHidden();
    broken = false;
    await page.locator(".fdx-loaderr").getByRole("button", { name: "Try again" }).click();
    await expect(meals(page)).toHaveCount(1);
    await expect(page.locator(".fdx-loaderr")).toHaveCount(0);
    await page.context().close();
  });

  test("one press is one request, however many presses", async ({ browser }) => {
    const page = await member(browser, { timezoneId: "UTC", now: NOON });
    await openDiary(page);
    await log(page, ...ROWS);
    await openDiary(page);
    const calls: string[] = [];
    page.on("request", (r) => { if (r.url().includes("/food-diary") && r.method() !== "GET" && r.method() !== "OPTIONS" && !r.url().includes("/estimate")) calls.push(`${r.method()} ${new URL(r.url()).pathname.split("/").pop()}`); });
    await page.route("**/api/v1/members/me/food-diary**", async (route) => {
      if (route.request().method() !== "GET") await new Promise((r) => setTimeout(r, 400));
      await route.continue();
    });
    await page.locator("#fdxSaveDay").dblclick();
    await expect(page.locator("#fdxSavedNote")).toBeVisible();
    expect(calls.length, calls.join()).toBe(1);
    calls.length = 0;
    await meals(page).last().getByRole("button", { name: "Remove" }).dblclick();
    await expect(meals(page)).toHaveCount(2);
    await page.waitForTimeout(600);
    expect(calls.length, calls.join()).toBe(1);
    await expect(meals(page)).toHaveCount(2);
    await page.context().close();
  });
});
