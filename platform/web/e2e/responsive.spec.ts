import { expect, test, type Page } from "@playwright/test";
import { ADITYA, ADMIN } from "./fixtures/accounts";
import { adminSignIn, expectAdminHome, expectMemberDashboard, expectNoHorizontalOverflow, memberSignIn, open } from "./fixtures/helpers";

/* Responsive acceptance at the four agreed widths: no console errors and no
   horizontal page overflow on the public, member and admin screens a beta
   tester reaches. Content checks live in the journey specs; this one only
   guards layout and cleanliness so it stays fast. */

const WIDTHS = [
  { name: "1440", width: 1440, height: 900 },
  { name: "1366", width: 1366, height: 768 },
  { name: "768", width: 768, height: 1024 },
  { name: "390", width: 390, height: 844 },
];
const PUBLIC = ["/", "/why-veye", "/about", "/help", "/pricing", "/login", "/signup", "/onboarding"];
/** The pages that carry the public navigation; the auth screens use AuthFrame. */
const MARKETING = ["/", "/why-veye", "/about", "/help", "/pricing"];
const MEMBER = ["/app", "/app/progress", "/app/progress/health-assessment", "/app/progress/simple-quiz", "/app/mood", "/app/food-diary", "/app/food-choices", "/app/companion", "/app/fitness", "/app/supplements", "/app/resources", "/app/settings"];
const ADMIN_PAGES = ["/admin", "/admin/members", "/admin/assessments", "/admin/care", "/admin/requests", "/admin/content", "/admin/insights", "/admin/settings", "/admin/companion/conversations", "/admin/companion/settings/guided-experiences"];

/** Headings must step down one level at a time, in document order.
 *
 *  My Progress went h1 -> h3 (its module tiles use no headings at all, so the
 *  Health Number card was the first one below the title) and Resources went
 *  h1 -> h3 five times before reaching its h2. A reader navigating by heading
 *  is told there is a level in between that does not exist. */
async function expectHeadingOrder(page: Page, path: string) {
  const jumps = await page.evaluate(() => {
    const out: string[] = [];
    let previous = 0;
    for (const h of document.querySelectorAll("h1,h2,h3,h4,h5,h6")) {
      const style = getComputedStyle(h);
      if (style.display === "none" || style.visibility === "hidden") continue;
      const level = Number(h.tagName[1]);
      if (previous && level > previous + 1) out.push(`h${previous} -> h${level} at "${(h.textContent ?? "").trim().slice(0, 40)}"`);
      previous = level;
    }
    return out;
  });
  expect(jumps, `${path}: heading levels skip a step`).toEqual([]);
}

function watchConsole(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error" && !/hmr|favicon|ERR_CONNECTION_REFUSED.*ws/i.test(message.text())) errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  return errors;
}

for (const size of WIDTHS) {
  test.describe(`${size.name}px`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    test(`public pages`, async ({ page }) => {
      const errors = watchConsole(page);
      for (const path of PUBLIC) {
        await open(page, path);
        await expectNoHorizontalOverflow(page);
        await expectHeadingOrder(page, path);
        // The site's only call to action has to be findable by its name at
        // every width. `.nav__cta span { display: none }` hid BOTH spans below
        // 920px — the "Get Started" label and the arrow glyph meant to replace
        // it — leaving a 34x16 bordered pill with nothing inside and no
        // accessible name: getByRole found nothing at 920, 768 or 390.
        if (MARKETING.includes(path)) {
          const cta = page.getByRole("link", { name: /^Get Started$/i }).first();
          await expect(cta, `${path} at ${size.name}: the nav CTA has no accessible name`).toHaveCount(1);
          const box = await cta.boundingBox();
          expect(box?.width ?? 0, `${path} at ${size.name}: the nav CTA collapsed to an empty pill`).toBeGreaterThan(50);
        }
      }
      expect(errors).toEqual([]);
    });

    test(`member pages`, async ({ page }) => {
      const errors = watchConsole(page);
      await memberSignIn(page, ADITYA.email, ADITYA.password);
      await expectMemberDashboard(page);
      for (const path of MEMBER) {
        await open(page, path);
        await expect(page.locator("main")).toBeVisible();
        await expectNoHorizontalOverflow(page);
        await expectHeadingOrder(page, path);
      }
      expect(errors).toEqual([]);
    });

    test(`admin pages`, async ({ page }) => {
      const errors = watchConsole(page);
      await adminSignIn(page, ADMIN.email, ADMIN.password);
      await expectAdminHome(page);

      // Between 761px and 1024px the rail is icon-only
      // (`.nav-link span { display: none }`), and the accessible name went with
      // the label: nine links and a Sign out button announcing nothing at all.
      // navigation.spec.ts addresses the rail by name but only at the default
      // width, so it never saw this.
      const rail = page.getByRole("navigation", { name: "Main" });
      for (const label of ["Home", "Members", "Care Studio", "Assessments", "Companion", "Requests & Inbox", "Content", "Insights", "Settings"]) {
        await expect(rail.getByRole("link", { name: label, exact: true }),
                     `the rail's "${label}" has no accessible name at ${size.name}px`).toHaveCount(1);
      }

      for (const path of ADMIN_PAGES) {
        await open(page, path);
        await expect(page.locator("#main-content")).toBeVisible();
        await expectNoHorizontalOverflow(page);
        await expectHeadingOrder(page, path);
      }
      expect(errors).toEqual([]);
    });
  });
}
