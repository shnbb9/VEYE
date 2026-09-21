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
const MEMBER = ["/app", "/app/progress", "/app/progress/health-assessment", "/app/progress/simple-quiz", "/app/mood", "/app/food-diary", "/app/companion", "/app/fitness", "/app/supplements", "/app/resources", "/app/settings"];
const ADMIN_PAGES = ["/admin", "/admin/members", "/admin/assessments", "/admin/care", "/admin/requests", "/admin/content", "/admin/insights", "/admin/settings", "/admin/companion/conversations", "/admin/companion/settings/guided-experiences"];

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
      }
      expect(errors).toEqual([]);
    });

    test(`admin pages`, async ({ page }) => {
      const errors = watchConsole(page);
      await adminSignIn(page, ADMIN.email, ADMIN.password);
      await expectAdminHome(page);
      for (const path of ADMIN_PAGES) {
        await open(page, path);
        await expect(page.locator("#main-content")).toBeVisible();
        await expectNoHorizontalOverflow(page);
      }
      expect(errors).toEqual([]);
    });
  });
}
