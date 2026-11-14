import { expect, request, test, type Browser, type Page } from "@playwright/test";
import { ADMIN, MAILPIT_URL, freshMember } from "../fixtures/accounts";
import { adminSignIn, answerOnboarding, expectAdminHome, linkFrom, open, toPath, waitForMail } from "../fixtures/helpers";

/* The console's half of saved results (architecture V2 §§2.4, 3), control by
   control. The owner's retention choices: Forever cannot be published without
   its confirmation; a shorter policy reaches existing results only when it is
   applied explicitly, and then only moves expiry earlier; cleanup previews
   before it removes. The Prospects list: sorting, a details drawer that never
   carries the answers or the number, and deletion with a reason. Then a
   visitor deletes their own result from the result screen, and asks for a
   fresh link from a device that has none. Saving is switched back to Never in
   every test's `finally`, so no other spec meets a changed gate. */

type ProspectRow = { id: string; status: string; expires_at: string | null; retention_label: string; email_masked: string };
type ProspectsPage = { total: number; rows: ProspectRow[] };

const DAY = 24 * 60 * 60 * 1000;
const CONFIRM_SUBJECT = "Confirm your email address for Veye";

async function adminPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await adminSignIn(page, ADMIN.email, ADMIN.password);
  await expectAdminHome(page);
  return page;
}

async function privacyCard(page: Page) {
  await open(page, "/admin/settings?section=product");
  const card = page.getByTestId("privacy-prospects");
  await expect(card.getByTestId("retention-current")).toBeVisible();
  return card;
}

async function setRetention(page: Page, testId: string) {
  const card = await privacyCard(page);
  const option = card.getByTestId(testId);
  if (await option.isChecked()) return;
  await option.check({ force: true });
  await expect(card.getByTestId("retention-impact")).toBeVisible();
  const published = page.waitForResponse((r) => r.url().endsWith("/api/v1/admin/settings/privacy") && r.request().method() === "PUT");
  await page.getByTestId("retention-publish").click();
  expect((await published).status()).toBe(200);
  await expect(card.getByTestId("retention-message")).toContainText("Published as version");
}

/** A visitor finishes the assessment in their own browser and ticks the box. */
async function saveResult(browser: Browser, email: string): Promise<Page> {
  const tab = await (await browser.newContext()).newPage();
  await open(tab, "/onboarding");
  await answerOnboarding(tab);
  await expect(tab.getByRole("dialog", { name: "Your Health Number is Ready" })).toBeVisible();
  await tab.getByTestId("save-consent").check();
  await tab.getByLabel("Email Address").fill(email);
  const saved = tab.waitForResponse((r) => r.url().endsWith("/api/v1/prospects/assessment"));
  await tab.getByTestId("gate-submit").click();
  expect((await saved).status()).toBe(201);
  await expect(tab.getByTestId("saved-status")).toContainText("Saved until");
  return tab;
}

/** The console's exact-address search, read back from the response it got. */
async function findProspect(admin: Page, email: string): Promise<ProspectsPage> {
  await open(admin, "/admin/members/prospects");
  await expect(admin.getByTestId("prospects-counts")).toBeVisible();
  const listed = admin.waitForResponse((r) => r.url().includes("/api/v1/admin/prospects?") && r.url().includes(encodeURIComponent(email)));
  await admin.getByTestId("prospects-search").fill(email);
  return (await (await listed).json()) as ProspectsPage;
}

async function mailCount(to: string, subjectPart: string): Promise<number> {
  const mail = await request.newContext({ baseURL: MAILPIT_URL });
  try {
    const search = await mail.get(`/api/v1/search?query=${encodeURIComponent(`to:${to}`)}&limit=50`);
    const body = (await search.json()) as { messages: { Subject: string }[] };
    return body.messages.filter((m) => m.Subject.includes(subjectPart)).length;
  } finally {
    await mail.dispose();
  }
}

/** The newest matching message that is not `notId` (waitForMail returns the newest). */
async function anotherMail(to: string, subjectPart: string, notId: string) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const mail = await waitForMail(to, subjectPart);
    if (mail.id !== notId) return mail;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`No second "${subjectPart}" message reached ${to}`);
}

test.describe("saved results in the console", () => {
  test("retention controls, and one saved result read, sorted and deleted without its answers", async ({ browser }) => {
    const admin = await adminPage(browser);
    const visitor = freshMember("journey");
    try {
      await setRetention(admin, "retention-days45");
      await saveResult(browser, visitor.email);

      let found = await findProspect(admin, visitor.email);
      expect(found.total).toBe(1);
      expect(found.rows[0].retention_label).toBe("45 days");
      const agreedExpiry = Date.parse(found.rows[0].expires_at ?? "");
      expect(agreedExpiry - Date.now()).toBeGreaterThan(44 * DAY);

      // Forever cannot be published without its confirmation.
      let card = await privacyCard(admin);
      const publish = admin.getByTestId("retention-publish");
      await card.getByTestId("retention-forever").check({ force: true });
      await expect(card.getByTestId("retention-impact")).toBeVisible();
      await expect(publish).toBeDisabled();
      await card.getByTestId("retention-forever-ack").check();
      await expect(publish).toBeEnabled();
      await card.getByTestId("retention-forever-ack").uncheck();
      await expect(publish).toBeDisabled();

      // A shorter policy: the preview says what applying it would do, and
      // publishing it changes nothing that already exists.
      await card.getByTestId("retention-days15").check({ force: true });
      await expect(card.getByTestId("retention-forever-ack")).toHaveCount(0);
      await expect(card.getByTestId("retention-impact")).toContainText(/would shorten [1-9]\d* and delete \d+ at once/);
      const published = admin.waitForResponse((r) => r.url().endsWith("/api/v1/admin/settings/privacy") && r.request().method() === "PUT");
      await publish.click();
      expect((await published).status()).toBe(200);
      await expect(card.getByTestId("retention-message")).toContainText("Published as version");
      found = await findProspect(admin, visitor.email);
      expect(Date.parse(found.rows[0].expires_at ?? "")).toBe(agreedExpiry);

      // Applying it is a separate, confirmed step, and it only moves expiry earlier.
      card = await privacyCard(admin);
      let asked = "";
      admin.once("dialog", (dialog) => { asked = dialog.message(); void dialog.accept(); });
      const applied = admin.waitForResponse((r) => r.url().endsWith("/api/v1/admin/settings/privacy/apply-shorter"));
      await card.getByTestId("retention-apply").click();
      expect((await applied).status()).toBe(200);
      expect(asked).toContain("Expiry only ever moves earlier");
      await expect(card.getByTestId("retention-message")).toContainText("now expire earlier");
      found = await findProspect(admin, visitor.email);
      const shortened = Date.parse(found.rows[0].expires_at ?? "");
      expect(shortened).toBeLessThan(agreedExpiry);
      expect(shortened - Date.now()).toBeLessThanOrEqual(15 * DAY + 60_000);

      // Sorting reaches the API; the drawer shows what happened and what was
      // agreed, never the answers or the number.
      const sorted = admin.waitForResponse((r) => r.url().includes("/api/v1/admin/prospects?") && r.url().includes("sort=expires_asc"));
      await admin.getByTestId("prospects-sort").selectOption("expires_asc");
      expect((await sorted).status()).toBe(200);
      await expect(admin.getByTestId("prospect-row")).toHaveCount(1);
      const detailLoaded = admin.waitForResponse((r) => /\/api\/v1\/admin\/prospects\/[0-9a-f-]{36}$/.test(r.url()));
      await admin.getByTestId("prospect-open").click();
      expect(JSON.stringify(await (await detailLoaded).json())).not.toMatch(/displayed_score|interpretation|answers|payload/);
      const drawer = admin.getByRole("dialog");
      await expect(drawer.getByTestId("prospect-detail")).toContainText("45 days");
      await expect(drawer.getByTestId("prospect-events")).toContainText("Saved by the visitor");
      await expect(drawer.getByTestId("prospect-events")).toContainText("Expiry moved earlier by a shorter retention policy");
      await expect(drawer).not.toContainText(/Health Number is|\b\d\.\d\b out of/);

      // Deleting needs a second click and keeps the reason; the address goes with it.
      await drawer.getByTestId("prospect-erase-open").click();
      await drawer.getByLabel("Why (optional, kept in the audit log)").fill("Asked by phone (e2e)");
      const erased = admin.waitForResponse((r) => /\/api\/v1\/admin\/prospects\/[0-9a-f-]{36}\/erase$/.test(r.url()));
      await drawer.getByTestId("prospect-erase-confirm").click();
      const erasedRow = (await (await erased).json()) as ProspectRow;
      expect(erasedRow.status).toBe("erased");
      await expect(admin.getByTestId("prospects-notice")).toContainText("was deleted");
      expect((await findProspect(admin, visitor.email)).total).toBe(0);

      // The visitor's emailed link now leads nowhere. Asking for a new one
      // answers exactly as it would for any address, and sends nothing.
      const mail = await waitForMail(visitor.email, CONFIRM_SUBJECT);
      const device = await (await browser.newContext()).newPage();
      await open(device, toPath(linkFrom(mail.text, "saved-result")));
      await expect(device.getByTestId("saved-result-gone")).toBeVisible();
      await device.getByTestId("saved-result-recover-email").fill(visitor.email);
      const recovered = device.waitForResponse((r) => r.url().endsWith("/api/v1/prospects/recover"));
      await device.getByTestId("saved-result-recover").click();
      expect((await recovered).status()).toBe(202);
      await expect(device.getByTestId("saved-result-recover-note")).toContainText("If a saved result exists for that address");
      expect(await mailCount(visitor.email, CONFIRM_SUBJECT)).toBe(1);

      // Cleanup previews before it removes anything, and each run is recorded.
      card = await privacyCard(admin);
      const dry = admin.waitForResponse((r) => r.url().endsWith("/api/v1/admin/settings/privacy/cleanup"));
      await card.getByTestId("retention-dry-run").click();
      expect((await dry).status()).toBe(200);
      await expect(card.getByTestId("retention-message")).toContainText("Nothing was changed.");
      await expect(card.getByTestId("retention-last-run")).toContainText("dry run");
      const run = admin.waitForResponse((r) => r.url().endsWith("/api/v1/admin/settings/privacy/cleanup"));
      await card.getByTestId("retention-run").click();
      expect((await run).status()).toBe(200);
      await expect(card.getByTestId("retention-message")).toContainText(/^Removed \d+ expired saved result/);
      await expect(card.getByTestId("retention-last-run")).not.toContainText("dry run");

      // Every published version stays readable.
      await card.locator("summary", { hasText: "Version history" }).click();
      await expect(card.getByTestId("retention-history")).toContainText("15 days");
      await expect(card.getByTestId("retention-history")).toContainText("45 days");
    } finally {
      await setRetention(admin, "retention-never");
    }
  });

  test("a visitor deletes their own result, and gets a fresh link on a device that has none", async ({ browser }) => {
    const admin = await adminPage(browser);
    const first = freshMember("journey");
    const second = freshMember("journey");
    try {
      await setRetention(admin, "retention-days30");

      // From the result screen itself.
      const tab = await saveResult(browser, first.email);
      let asked = "";
      tab.once("dialog", (dialog) => { asked = dialog.message(); void dialog.accept(); });
      const erased = tab.waitForResponse((r) => r.url().endsWith("/api/v1/prospects/erase"));
      await tab.getByTestId("saved-erase").click();
      expect((await erased).status()).toBe(200);
      expect(asked).toContain("This cannot be undone");
      await expect(tab.getByTestId("saved-status")).toContainText("have been deleted");
      expect((await findProspect(admin, first.email)).total).toBe(0);

      // A device with no link asks for one; the new link works and the old one stops.
      await saveResult(browser, second.email);
      const original = await waitForMail(second.email, CONFIRM_SUBJECT);
      const device = await (await browser.newContext()).newPage();
      await open(device, "/saved-result");
      await expect(device.getByTestId("saved-result-gone")).toContainText("This page needs the link from your email.");
      await device.getByTestId("saved-result-recover-email").fill(second.email);
      await device.getByTestId("saved-result-recover").click();
      await expect(device.getByTestId("saved-result-recover-note")).toContainText("If a saved result exists for that address");
      const fresh = await anotherMail(second.email, CONFIRM_SUBJECT, original.id);
      await open(device, toPath(linkFrom(fresh.text, "saved-result")));
      await expect(device.getByTestId("saved-result-status")).toContainText("saved for");

      const stale = await (await browser.newContext()).newPage();
      await open(stale, toPath(linkFrom(original.text, "saved-result")));
      await expect(stale.getByTestId("saved-result-gone")).toBeVisible();

      // And deleting it from that page.
      let confirmText = "";
      device.once("dialog", (dialog) => { confirmText = dialog.message(); void dialog.accept(); });
      await device.getByTestId("saved-result-erase").click();
      await expect(device.getByTestId("saved-result-erased")).toContainText("have been deleted");
      expect(confirmText).toContain("cannot be undone");
      expect((await findProspect(admin, second.email)).total).toBe(0);
    } finally {
      await setRetention(admin, "retention-never");
    }
  });
});
