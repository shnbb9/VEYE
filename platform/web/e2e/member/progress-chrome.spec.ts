import { expect, test, type Page } from "@playwright/test";
import { freshMember } from "../fixtures/accounts";
import { expectMemberDashboard, memberSignIn, open } from "../fixtures/helpers";

/* Where the member is left standing after a Progress screen changes.
 *
 * The member shell scrolls `.main` (`overflow-y: auto` in
 * member-css/dashboard.css), not the document. Every Progress screen called
 * `window.scrollTo(0, 0)` after saving or retaking, which in that shell does
 * nothing at all: the result the member had just asked for rendered above the
 * fold while they went on looking at the button they had pressed. Seven call
 * sites across four screens, every one of them a no-op.
 *
 * Each assertion here also checks that the view was genuinely scrolled first,
 * and is still scrollable afterwards — otherwise a short result page would make
 * `scrollTop === 0` true whether or not anything scrolled it.
 *
 * A FRESH member, not the seeded Aditya: submitting a quiz as a seeded identity
 * grows its stored history, and admin/console.spec.ts asserts his Simple Quiz
 * has exactly two results. The first version of this spec used him and broke
 * that assertion on the next run. */

const member = freshMember("trackers");

const scroll = (page: Page) => page.evaluate(() => {
  const main = document.querySelector<HTMLElement>(".main");
  return main ? { top: Math.round(main.scrollTop), scrollable: main.scrollHeight - main.clientHeight } : null;
});

async function scrollToBottom(page: Page) {
  await page.evaluate(() => {
    const main = document.querySelector<HTMLElement>(".main");
    if (main) main.scrollTop = main.scrollHeight;
  });
  const at = await scroll(page);
  expect(at?.scrollable ?? 0, "the view is not scrollable, so this test could not tell a fix from the defect").toBeGreaterThan(40);
  expect(at?.top ?? 0, "the view did not scroll, so this test could not tell a fix from the defect").toBeGreaterThan(20);
}

test.describe.serial("Progress screens return to the top", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await open(page, "/signup");
    await page.getByLabel("First name").fill(member.firstName);
    await page.getByLabel("Last name").fill(member.lastName);
    await page.getByLabel("Email", { exact: true }).fill(member.email);
    await page.getByPlaceholder("Enter your password").fill(member.password);
    await page.getByPlaceholder("Confirm your password").fill(member.password);
    await page.getByRole("button", { name: "Sign Up" }).click();
    await expect(page).toHaveURL(/\/(app|onboarding)/);
    await page.close();
  });

  test("Simple Quiz: submitting and retaking both bring the view back up", async ({ page }) => {
    await memberSignIn(page, member.email, member.password);
    await expectMemberDashboard(page);
    await open(page, "/app/progress/simple-quiz");

    // A member with no history opens on the form.
    await expect(page.locator("#simpleQuizRows .quiz-row").first()).toBeVisible();
    for (const row of await page.locator("#simpleQuizRows .quiz-row").all()) {
      await row.getByRole("button", { name: "No", exact: true }).click();
    }
    await scrollToBottom(page);
    await page.getByRole("button", { name: "Submit Quiz" }).click();

    await expect(page.locator("#simpleResultScore")).toBeVisible();
    const afterSubmit = await scroll(page);
    expect(afterSubmit?.scrollable ?? 0, "the result is not scrollable at this size").toBeGreaterThan(40);
    expect(afterSubmit?.top, "the result rendered above the fold and the member was left below it").toBe(0);

    // And back the other way: retaking must not leave the view part-way down.
    await scrollToBottom(page);
    await page.getByRole("button", { name: "Re-take quiz" }).click();
    await expect(page.locator("#simpleQuizRows .quiz-row").first()).toBeVisible();
    const afterRetake = await scroll(page);
    expect(afterRetake?.scrollable ?? 0, "the form is not scrollable at this size").toBeGreaterThan(40);
    expect(afterRetake?.top, "retaking the quiz left the view part-way down the form").toBe(0);
  });
});

/* The onboarding header: painted, and for a long time unclickable. */
test.describe("the onboarding header is reachable", () => {
  for (const width of [1440, 1366]) {
    test(`at ${width}px the logo and Back accept a click`, async ({ page }) => {
      // `.quiz__header` and `.quiz__main` both carried z-index 2, and
      // `.quiz__main` comes later in the document, so it won the tie and
      // covered the header from y=22 down. Nothing looked wrong — the controls
      // are painted in the padding above the question — but neither could be
      // clicked, and the only way out of a 12-question assessment was the
      // browser's own Back. (Below 1024px the header is static and was never
      // affected.)
      await page.setViewportSize({ width, height: 900 });
      await open(page, "/onboarding");
      await page.getByRole("button", { name: "Live a Healthier Lifestyle" }).click();
      await page.getByRole("button", { name: /^Next$/ }).click();

      // `trial` runs Playwright's actionability checks without acting: it fails
      // if the element does not receive the pointer event.
      await page.locator(".quiz__back").click({ trial: true, timeout: 5000 });
      await page.locator(".quiz__logo").click({ trial: true, timeout: 5000 });

      const topmost = await page.evaluate(() => {
        const at = (sel: string) => {
          const el = document.querySelector(sel)!;
          const r = el.getBoundingClientRect();
          const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          return top && (top === el || el.contains(top)) ? "reachable" : `covered by ${top?.tagName.toLowerCase()}`;
        };
        return { logo: at(".quiz__logo"), back: at(".quiz__back"), progress: at(".quiz__progress") };
      });
      expect(topmost).toEqual({ logo: "reachable", back: "reachable", progress: "reachable" });

      // And Back actually steps the flow back.
      await page.locator(".quiz__back").click();
      await expect(page.getByRole("button", { name: "Live a Healthier Lifestyle" })).toBeVisible();
    });
  }
});
