import { expect, test } from "@playwright/test";
import { ADITYA, ADMIN } from "./fixtures/accounts";
import { adminSignIn, expectAdminHome, expectMemberDashboard, memberSignIn, open } from "./fixtures/helpers";

/* The headers a browser actually receives, and the CSRF token the client
   carries. Asserted on real responses rather than on the config, because a
   header that is configured but not served protects nobody. */

test.describe("Security headers and CSRF", () => {
  test("every page is served with the headers that stop framing and sniffing", async ({ page }) => {
    for (const path of ["/", "/login", "/admin/login"]) {
      const response = await page.goto(path);
      expect(response, `no response for ${path}`).not.toBeNull();
      const headers = response!.headers();
      expect(headers["x-content-type-options"], path).toBe("nosniff");
      expect(headers["x-frame-options"], path).toBe("DENY");
      expect(headers["referrer-policy"], path).toBe("no-referrer");
      expect(headers["content-security-policy"], path).toContain("frame-ancestors 'none'");
      expect(headers["content-security-policy"], path).toContain("object-src 'none'");
      expect(headers["permissions-policy"], path).toContain("camera=()");
    }
  });

  test("the production bundle runs without unsafe-eval, and still hydrates", async ({ page }) => {
    /* Two halves of one claim. Removing a directive is only an improvement if
       the application works without it, so this asserts the header AND that
       the pages it covers come up clean — a CSP violation surfaces as a
       console error, and so does a hydration failure. */
    const problems: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") problems.push(`${page.url()} :: ${message.text()}`);
    });
    page.on("pageerror", (error) => problems.push(`${page.url()} :: ${error.message}`));

    for (const path of ["/", "/why-veye", "/help", "/login", "/admin/login"]) {
      const response = await page.goto(path);
      const csp = response!.headers()["content-security-policy"] ?? "";
      expect(csp, `${path} has no CSP`).toContain("script-src");
      expect(csp, `${path} still allows unsafe-eval`).not.toContain("unsafe-eval");
      // The directives that are load-bearing today.
      expect(csp, path).toContain("base-uri 'self'");
      expect(csp, path).toContain("form-action 'self'");
      await page.waitForLoadState("networkidle");
    }

    const violations = problems.filter((p) => /content security policy|refused to (evaluate|execute)/i.test(p));
    expect(violations, "the page broke its own CSP").toEqual([]);
    expect(problems, "errors on pages served under the tightened CSP").toEqual([]);
  });

  test("the CSP still admits what the approved design actually needs", async ({ page }) => {
    /* Honest about what is NOT locked down: inline script and inline style are
       still permitted. If a future change removes either, this test should be
       updated deliberately rather than discovered by a blank page. */
    const response = await page.goto("/");
    const csp = response!.headers()["content-security-policy"] ?? "";
    expect(csp).toContain("'unsafe-inline'");
    expect(csp).toContain("https://www.youtube-nocookie.com");
    expect(csp).toContain("https://fonts.gstatic.com");
  });

  test("the pages a signed-in member and administrator see are covered too", async ({ page }) => {
    await memberSignIn(page, ADITYA.email, ADITYA.password);
    await expectMemberDashboard(page);
    const member = await page.goto("/app/settings");
    expect(member!.headers()["x-frame-options"]).toBe("DENY");

    await adminSignIn(page, ADMIN.email, ADMIN.password);
    await expectAdminHome(page);
    const admin = await page.goto("/admin/settings?section=administrators");
    expect(admin!.headers()["x-frame-options"]).toBe("DENY");
  });

  test("the API hands the browser a readable CSRF token and the client sends it back", async ({ page }) => {
    await memberSignIn(page, ADITYA.email, ADITYA.password);
    await expectMemberDashboard(page);

    // Readable by script on purpose: that is what makes the double submit work.
    const token = await page.evaluate(() => document.cookie.match(/veye_csrf=([^;]*)/)?.[1] ?? null);
    expect(token).toBeTruthy();

    // A state-changing call made the way the application makes it succeeds…
    const sent = await page.evaluate(async (api) => {
      const csrf = document.cookie.match(/veye_csrf=([^;]*)/)?.[1] ?? "";
      const response = await fetch(`${api}/api/v1/members/me/sessions/revoke-others`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json", "X-Veye-Csrf": decodeURIComponent(csrf) },
        body: "{}",
      });
      return response.status;
    }, process.env.E2E_API_URL ?? "http://localhost:8001");
    expect(sent).toBe(200);

    // …and the same call without the token — what a forged cross-site request
    // looks like, since that page could not read the cookie — is refused.
    const forged = await page.evaluate(async (api) => {
      const response = await fetch(`${api}/api/v1/members/me/sessions/revoke-others`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: "{}",
      });
      return response.status;
    }, process.env.E2E_API_URL ?? "http://localhost:8001");
    expect(forged).toBe(403);
  });

  test("the application still works end to end with the token in place", async ({ page }) => {
    // A pass through the journeys that mutate: the token must be invisible.
    await memberSignIn(page, ADITYA.email, ADITYA.password);
    await expectMemberDashboard(page);
    await open(page, "/app/settings");
    // The form only enables when something actually changed; set the value
    // back afterwards so the seeded member is left as the suite found them.
    await page.getByTestId("settings-phone").fill("555 0100");
    await page.getByTestId("settings-save").click();
    await expect(page.getByTestId("settings-profile-note")).toContainText(/saved/i);
    await page.getByTestId("settings-phone").fill("");
    await page.getByTestId("settings-save").click();
    await expect(page.getByTestId("settings-profile-note")).toContainText(/saved/i);
  });
});
