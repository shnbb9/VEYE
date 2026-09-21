import { expect, test, type Page } from "@playwright/test";
import { ADITYA, ADMIN, DUAL, MAYA, freshMember } from "../fixtures/accounts";
import { adminSignIn, expectAdminHome, expectMemberDashboard, memberSignIn, open, portalSessions, signUpMember } from "../fixtures/helpers";

// A valid 1×1 PNG — enough for the server's magic-byte check.
const PNG_1PX = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4DwABAQEAG92NtAAAAABJRU5ErkJggg==", "base64");

/* Settings → Profile: every value on the card (photo initial, name, email,
   status, tenure) and the topbar avatar come from the ONE member signed into
   the member portal. An administrator session in the same browser — even
   Cara's — must never leak into a member's Settings. */

async function expectProfileOf(page: Page, account: { email: string; firstName: string }, lastName: string) {
  await open(page, "/app/settings");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(page.getByTestId("settings-name")).toHaveValue(`${account.firstName} ${lastName}`);
  await expect(page.getByTestId("settings-first-name")).toHaveValue(account.firstName);
  await expect(page.getByTestId("settings-email")).toHaveValue(account.email);
  // both avatars are the SAME member's face: the uploaded photo when one exists, else this member's initial
  const hasPhoto = await page.getByTestId("settings-photo").getAttribute("data-has-photo");
  await expect(page.getByTestId("topbar-avatar")).toHaveAttribute("data-has-photo", hasPhoto ?? "false");
  if (hasPhoto !== "true") {
    await expect(page.getByTestId("settings-photo")).toHaveText(account.firstName[0]);
    await expect(page.getByTestId("topbar-avatar")).toHaveText(account.firstName[0]);
  } else {
    await expect(page.getByTestId("settings-photo")).toHaveAttribute("aria-label", `Profile photo: ${account.firstName} ${lastName}`);
  }
  await expect(page.getByRole("button", { name: "Change photo" })).toBeVisible();
  // nothing of the administrator's identity anywhere on the page
  await expect(page.locator("main")).not.toContainText(/cara|hogue/i);
}

test.describe("Settings profile identity", () => {
  test("shows one member's own details, with an admin session open alongside", async ({ page }) => {
    await adminSignIn(page, ADMIN.email, ADMIN.password);
    await expectAdminHome(page);

    await memberSignIn(page, ADITYA.email, ADITYA.password);
    await expectMemberDashboard(page);
    const sessions = await portalSessions(page);
    expect(sessions.admin?.email).toBe(ADMIN.email);
    expect(sessions.member?.email).toBe(ADITYA.email);
    await expectProfileOf(page, ADITYA, "Demo");
  });

  test("profile edits and the photo persist on the server and show on both avatars", async ({ page }) => {
    const member = freshMember("photo");
    await signUpMember(page, member);
    await open(page, "/app/settings");

    // Name / phone / postal code save to the account and survive a reload.
    await page.getByTestId("settings-first-name").fill("Emberly");
    await page.getByTestId("settings-phone").fill("+1 555 0100");
    await page.getByTestId("settings-postal").fill("94110");
    await page.getByTestId("settings-save").click();
    await expect(page.getByTestId("settings-profile-note")).toHaveText("Profile saved.");
    await open(page, "/app/settings");
    await expect(page.getByTestId("settings-first-name")).toHaveValue("Emberly");
    await expect(page.getByTestId("settings-phone")).toHaveValue("+1 555 0100");
    await expect(page.getByTestId("settings-name")).toHaveValue(`Emberly ${member.lastName}`);
    await expect(page.getByTestId("topbar-avatar")).toHaveText("E");
    await open(page, "/app");
    await expect(page.getByRole("heading", { name: "Welcome back Emberly" })).toBeVisible();

    // Photo: a real PNG through the file input → stored via ObjectStorage → both avatars show it.
    await open(page, "/app/settings");
    await page.getByTestId("settings-photo-input").setInputFiles({ name: "me.png", mimeType: "image/png", buffer: PNG_1PX });
    await expect(page.getByTestId("settings-profile-note")).toHaveText("Profile photo updated.");
    await expect(page.getByTestId("settings-photo")).toHaveAttribute("data-has-photo", "true");
    await expect(page.getByTestId("topbar-avatar")).toHaveAttribute("data-has-photo", "true");
    const loaded = await page.locator(".member-avatar--photo img").evaluateAll((images) => images.map((img) => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0));
    expect(loaded).toEqual([true, true]);
    // a text file declared as PNG is refused
    await page.getByTestId("settings-photo-input").setInputFiles({ name: "x.png", mimeType: "image/png", buffer: Buffer.from("not an image") });
    await expect(page.getByTestId("settings-profile-note")).toContainText(/JPG, PNG or WebP/);
    // after a reload the photo is still there; removing it brings the initial back
    await open(page, "/app/settings");
    await expect(page.getByTestId("settings-photo")).toHaveAttribute("data-has-photo", "true");
    await page.getByRole("button", { name: "Remove photo" }).click();
    await expect(page.getByTestId("settings-photo")).toHaveAttribute("data-has-photo", "false");
    await expect(page.getByTestId("topbar-avatar")).toHaveText("E");

    // Download my data: the member's own JSON export.
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("settings-export").click()]);
    expect(download.suggestedFilename()).toMatch(/veye-my-data-.*\.json/);
    const path = await download.path();
    const exported = JSON.parse(require("node:fs").readFileSync(path!, "utf8")) as { account: { email: string; first_name: string } };
    expect(exported.account.email).toBe(member.email);
    expect(exported.account.first_name).toBe("Emberly");
  });

  test("a second member sees only their own profile", async ({ page }) => {
    await memberSignIn(page, MAYA.email, MAYA.password);
    await expectMemberDashboard(page);
    await expectProfileOf(page, MAYA, "Demo");
  });

  test("a dual-access person sees their member profile, not an admin identity", async ({ page }) => {
    await adminSignIn(page, ADMIN.email, ADMIN.password);
    await expectAdminHome(page);
    await memberSignIn(page, DUAL.email, DUAL.password);
    await expectMemberDashboard(page);
    await expectProfileOf(page, DUAL, "Dual");
  });

  test("the profile row is one cohesive unit at desktop width and stacks on a phone", async ({ page }) => {
    await memberSignIn(page, ADITYA.email, ADITYA.password);
    await expectMemberDashboard(page);

    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, "/app/settings");
    const photo = page.getByTestId("settings-photo");
    const firstField = page.getByTestId("settings-first-name");
    const [photoBox, fieldBox, buttonBox] = await Promise.all([
      photo.boundingBox(), firstField.locator("xpath=..").boundingBox(), page.getByRole("button", { name: "Change photo" }).boundingBox(),
    ]);
    expect(photoBox && fieldBox && buttonBox).toBeTruthy();
    // photo column beside the fields, aligned to the top of the first field row
    expect(Math.abs(photoBox!.y - fieldBox!.y)).toBeLessThanOrEqual(2);
    expect(photoBox!.x + photoBox!.width).toBeLessThan(fieldBox!.x);
    expect(photoBox!.width).toBeGreaterThanOrEqual(104);
    expect(photoBox!.width).toBeLessThanOrEqual(120);
    // Change photo sits directly below the image
    expect(buttonBox!.y).toBeGreaterThan(photoBox!.y + photoBox!.height);
    expect(buttonBox!.y - (photoBox!.y + photoBox!.height)).toBeLessThan(24);
    // two field columns
    const columns = await page.getByTestId("settings-profile").locator(".settings-fields").evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length);
    expect(columns).toBe(2);

    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const [stackedPhoto, stackedField] = await Promise.all([photo.boundingBox(), firstField.boundingBox()]);
    expect(stackedField!.y).toBeGreaterThan(stackedPhoto!.y + stackedPhoto!.height);
    const clipped = await page.locator(".settings-fields input").evaluateAll((inputs) => inputs.some((i) => i.scrollWidth > i.clientWidth));
    expect(clipped).toBe(false);
  });
});
