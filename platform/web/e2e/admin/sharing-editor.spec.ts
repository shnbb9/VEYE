import { expect, request, test, type Browser, type Page } from "@playwright/test";
import { ADMIN, API_URL, MAILPIT_URL, freshMember } from "../fixtures/accounts";
import { confirmDialog, adminSignIn, expectAdminHome, linkFrom, memberApi, open, signUpMember, toPath, waitForMail } from "../fixtures/helpers";

/* Settings → Product settings → Health sharing (architecture V2 §§4.2, 4.5),
   driven in the browser: the request email is drafted, previewed, sent to the
   administrator as a test and published, and what is typed — markup included
   — only ever reaches an email as text; a published version is what the next
   member is sent. Automatic mode asks a member once their address is
   verified, signed with the configured display name. A material change to the
   terms needs a confirmation, and a member who decided earlier is told a
   newer version exists. Each test puts the global settings back through the
   console API in `finally`, so no other spec meets changed wording. */

const SUBJECT = "VEYE: Review a request to share your health information";
const SETTINGS = "/api/v1/admin/settings/health-sharing";

type Doc = { blocks: unknown[] };
type Settings = {
  notification: { mode: "manual" | "automatic"; resend_interval_hours: number; sender_name: string; version: number };
  template: { value: { subject: string; body: Doc }; version: number };
  terms: { value: { summary: Doc; details: Doc; purpose: string; recipient: string }; version: number; label: string };
};

async function consolePage(browser: Browser): Promise<Page> {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await adminSignIn(page, ADMIN.email, ADMIN.password);
  await expectAdminHome(page);
  return page;
}

/** The console API with the session and CSRF token the page already holds. */
async function adminApi<T>(page: Page, method: "GET" | "PUT" | "POST", path: string, data?: unknown): Promise<T> {
  const csrf = (await page.context().cookies(API_URL)).find((cookie) => cookie.name === "veye_csrf")?.value;
  const response = await page.request.fetch(`${API_URL}${path}`, {
    method, data, headers: method !== "GET" && csrf ? { "X-Veye-Csrf": decodeURIComponent(csrf) } : {},
  });
  expect(response.status(), `${method} ${path}`).toBeLessThan(300);
  return (await response.json()) as T;
}

async function restoreTemplate(page: Page, original: Settings) {
  await adminApi(page, "PUT", `${SETTINGS}/template/draft`, original.template.value);
  const now = await adminApi<Settings>(page, "POST", `${SETTINGS}/template/publish`, {});
  expect(now.template.value.subject).toBe(original.template.value.subject);
}

async function restoreTerms(page: Page, original: Settings) {
  await adminApi(page, "PUT", `${SETTINGS}/terms/draft`, original.terms.value);
  const now = await adminApi<Settings>(page, "POST", `${SETTINGS}/terms/publish`, {});
  expect(now.terms.value.purpose).toBe(original.terms.value.purpose);
}

async function restoreNotification(page: Page, original: Settings) {
  const now = await adminApi<Settings>(page, "GET", SETTINGS);
  const wanted = original.notification;
  if (now.notification.mode === wanted.mode && now.notification.sender_name === wanted.sender_name
      && now.notification.resend_interval_hours === wanted.resend_interval_hours) return;
  await adminApi(page, "PUT", `${SETTINGS}/notification`,
    { mode: wanted.mode, resend_interval_hours: wanted.resend_interval_hours, sender_name: wanted.sender_name });
}

async function mailDetail(id: string): Promise<{ HTML: string; From: { Name: string; Address: string } }> {
  const mail = await request.newContext({ baseURL: MAILPIT_URL });
  try {
    return (await (await mail.get(`/api/v1/message/${id}`)).json()) as { HTML: string; From: { Name: string; Address: string } };
  } finally {
    await mail.dispose();
  }
}

async function verifiedMember(browser: Browser) {
  const member = freshMember("probe");
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await signUpMember(page, member);
  const verify = await waitForMail(member.email, "Verify your Veye email address");
  await open(page, toPath(linkFrom(verify.text, "verify-email")));
  await expect(page.getByText("Your email address is verified.")).toBeVisible();
  const me = await memberApi<{ member: { member_id: string } }>(page, "/api/v1/auth/me");
  return { member, page, memberId: me.member.member_id };
}

test.describe("health sharing settings in the browser", () => {
  test("the request email is drafted, previewed, tested and published; typed markup stays text", async ({ browser }) => {
    const admin = await consolePage(browser);
    const original = await adminApi<Settings>(admin, "GET", SETTINGS);
    const stamp = Date.now().toString(36);
    const subject = `Your sharing request <b>${stamp}</b>`;
    const typed = `Hello {{first_name}}, <img src=x onerror=alert(1)> ${stamp}`;
    const dialogs: string[] = [];
    admin.on("dialog", (dialog) => { dialogs.push(dialog.message()); void dialog.dismiss(); });
    try {
      await open(admin, "/admin/settings?section=product");
      const card = admin.getByTestId("sharing-template");
      await expect(card.getByTestId("sharing-subject")).toHaveValue(original.template.value.subject);

      await card.getByTestId("sharing-subject").fill(subject);
      const body = card.getByTestId("sharing-body").getByRole("textbox");
      await body.click();
      await admin.keyboard.press("ControlOrMeta+A");
      await admin.keyboard.type(typed);

      // The preview is rendered by the server from the document tree.
      const previewed = admin.waitForResponse((r) => r.url().endsWith(`${SETTINGS}/template/preview`));
      await card.getByTestId("sharing-template-preview").click();
      const preview = (await (await previewed).json()) as { subject: string; html: string };
      expect(preview.html).toContain("&lt;img src=x onerror=alert(1)&gt;");
      expect(preview.html).not.toMatch(/<img[^>]*onerror/i);
      const panel = card.getByTestId("sharing-template-preview-panel");
      await expect(panel).toContainText(`Subject: ${subject}`);
      await expect(admin.frameLocator('iframe[title="Email preview"]').locator("body")).toContainText("<img src=x onerror=alert(1)>");

      // A draft changes nothing members receive; a test goes to this administrator only.
      const saved = admin.waitForResponse((r) => r.url().endsWith(`${SETTINGS}/template/draft`) && r.request().method() === "PUT");
      await card.getByTestId("sharing-template-save").click();
      expect((await saved).status()).toBe(200);
      await expect(card.getByTestId("sharing-template-note")).toContainText("Draft saved");
      await card.getByTestId("sharing-template-test").click();
      await expect(card.getByTestId("sharing-template-note")).toContainText(`A test was sent to ${ADMIN.email}`);
      const testMail = await waitForMail(ADMIN.email, stamp);
      const testHtml = (await mailDetail(testMail.id)).HTML;
      expect(testHtml).toContain("&lt;img src=x onerror=alert(1)&gt;");
      expect(testHtml).not.toMatch(/<img[^>]*onerror/i);

      // Publishing makes a new version, and it is what the next member is sent.
      const published = admin.waitForResponse((r) => r.url().endsWith(`${SETTINGS}/template/publish`));
      await card.getByTestId("sharing-template-publish").click();
      const after = (await (await published).json()) as Settings;
      expect(after.template.version).toBe(original.template.version + 1);
      await expect(card.getByTestId("sharing-template-note")).toContainText(`Published as version ${after.template.version}`);

      const { member, memberId } = await verifiedMember(browser);
      await open(admin, `/admin/members/${memberId}`);
      const asked = admin.waitForResponse((r) => r.url().endsWith(`/members/${memberId}/health-permission/request`));
      await admin.getByTestId("sharing-ask").click();
      expect((await asked).status()).toBe(200);
      const sent = await waitForMail(member.email, stamp);
      const sentHtml = (await mailDetail(sent.id)).HTML;
      expect(sentHtml).toContain("&lt;img src=x onerror=alert(1)&gt;");
      expect(sentHtml).toContain(member.firstName);
      expect(dialogs, "nothing typed into the editor ever ran").toEqual([]);
    } finally {
      await restoreTemplate(admin, original);
    }
  });

  test("automatic mode asks a member once their address is verified, under the configured name", async ({ browser }) => {
    const admin = await consolePage(browser);
    const original = await adminApi<Settings>(admin, "GET", SETTINGS);
    const sender = `Veye Care Team ${Date.now().toString(36)}`;
    try {
      await open(admin, "/admin/settings?section=product");
      const mode = admin.getByTestId("sharing-mode");
      await mode.getByTestId("sharing-mode-automatic").check();
      await mode.getByTestId("sharing-sender-name").fill(sender);
      const published = admin.waitForResponse((r) => r.url().endsWith(`${SETTINGS}/notification`));
      await mode.getByTestId("sharing-mode-publish").click();
      const asked = await confirmDialog(admin);
      expect((await published).status()).toBe(200);
      expect(asked).toContain("Members who verified earlier are not emailed");
      await expect(mode).toContainText("Published as version");

      // Nobody asked from the console: verification alone sends the request.
      const { member, page } = await verifiedMember(browser);
      const mail = await waitForMail(member.email, SUBJECT);
      expect(mail.text).toContain("Review sharing request");
      expect((await mailDetail(mail.id)).From.Name).toBe(sender);
      const state = await memberApi<{ state: string }>(page, "/api/v1/members/me/health-permission");
      expect(state.state).toBe("requested");
    } finally {
      await restoreNotification(admin, original);
    }
  });

  test("a material change to the terms needs a confirmation, and an earlier decision says so", async ({ browser }) => {
    const admin = await consolePage(browser);
    const original = await adminApi<Settings>(admin, "GET", SETTINGS);
    try {
      // A member decides under the current terms.
      const { page, memberId } = await verifiedMember(browser);
      await open(admin, `/admin/members/${memberId}`);
      await admin.getByTestId("sharing-ask").click();
      await expect(admin.getByTestId("sharing-delivery")).toContainText("Email delivered");
      await open(page, "/app/settings");
      await expect(page.getByTestId("health-sharing-asked")).toContainText(`${ADMIN.firstName}`);
      await page.getByTestId("health-sharing-review").click();
      await expect(page.getByTestId("sharing-request-version"))
        .toContainText(`Terms version ${original.terms.version === 0 ? "1 (initial)" : original.terms.version}`);
      await page.getByTestId("sharing-allow").click();
      await expect(page.getByTestId("sharing-request-decided")).toContainText("Shared with the Veye team");

      // The console changes why the records are shared.
      await open(admin, "/admin/settings?section=product");
      const terms = admin.getByTestId("sharing-terms");
      await terms.getByTestId("terms-purpose").fill(`${original.terms.value.purpose} (e2e change ${Date.now().toString(36)})`);
      await terms.getByTestId("terms-preview").click();
      await expect(terms.getByTestId("terms-preview-panel")).toContainText("Material change");
      await terms.getByTestId("terms-save").click();
      await expect(terms.getByTestId("terms-note")).toContainText("Draft saved");
      // Preview again after saving, so the publish step knows it is material.
      await terms.getByTestId("terms-preview").click();
      await expect(terms.getByTestId("terms-preview-panel")).toContainText("Material change");
      const published = admin.waitForResponse((r) => r.url().endsWith(`${SETTINGS}/terms/publish`));
      await terms.getByTestId("terms-publish").click();
      const asked = await confirmDialog(admin);
      const after = (await (await published).json()) as Settings;
      expect(asked).toContain("This changes who receives the records or why");
      expect(after.terms.version).toBe(original.terms.version + 1);
      await expect(terms.getByTestId("terms-note")).toContainText(`Published as version ${after.terms.version}`);

      // The member's decision stands, and Settings says it was made against earlier words.
      await open(page, "/app/settings");
      await expect(page.getByTestId("health-sharing-state")).toContainText("Shared with the Veye team");
      await expect(page.getByTestId("health-sharing-older-terms")).toContainText(original.terms.label);
      await expect(page.getByTestId("health-sharing-older-terms")).toContainText(after.terms.label);
      const history = page.getByTestId("health-sharing-history");
      await expect(history).toContainText("asked to see your results");
      await expect(history).toContainText("You started sharing your results");
    } finally {
      await restoreTerms(admin, original);
    }
  });
});
