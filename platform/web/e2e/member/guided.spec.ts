import { expect, test, type Page } from "@playwright/test";
import { open } from "../fixtures/helpers";
import { freshMember } from "../fixtures/accounts";

/* Sprout's guided experiences through the real Companion screen: the
   first-arrival offer (Guide me / Explore on my own), the Introduction flow
   with typed replies and pause/resume, and the Progress Tracker Guide
   navigating the member to a REAL tracker (Health Assessment is connected
   now) and resuming afterwards. */

const member = freshMember("guided");

async function signUpAndOpenCompanion(page: Page) {
  await open(page, "/signup");
  await page.getByLabel("First name").fill(member.firstName);
  await page.getByLabel("Last name").fill(member.lastName);
  await page.getByLabel("Email", { exact: true }).fill(member.email);
  await page.getByPlaceholder("Enter your password").fill(member.password);
  await page.getByPlaceholder("Confirm your password").fill(member.password);
  await page.getByRole("button", { name: "Sign Up" }).click();
  await expect(page).toHaveURL(/\/(app|onboarding)/);
}

/** Type a reply and send it with Enter. Sending is blocked while Sprout is
 *  still applying the previous step (the submit button is disabled, so an
 *  early Enter is silently dropped) — wait for it to be accepted first. */
async function reply(page: Page, text: string) {
  const input = page.locator("#chatInput");
  await input.fill(text);
  await expect(page.locator(".chat-send")).toBeEnabled();
  await input.press("Enter");
}

test.describe.serial("Guided experiences", () => {
  test("first arrival: the dashboard offers Guided setup and the Introduction flow runs with typed replies, pause and resume", async ({ page }) => {
    await signUpAndOpenCompanion(page);
    await open(page, "/app");
    const guided = page.getByRole("button", { name: "Guided setup" });
    await expect(guided).toBeVisible();
    await expect(page.getByRole("button", { name: "Explore on my own" })).toBeVisible();
    await guided.click();
    await expect(page).toHaveURL(/\/app\/companion\?flow=first_time_user/);

    // The intro decision: WHY TO / HOW TO — Cara's words, as buttons.
    const choices = page.locator("#guidedChoices");
    await expect(choices.getByRole("button", { name: /why to/i })).toBeVisible();
    await choices.getByRole("button", { name: /why to/i }).click();
    await expect(page.locator(".guided-bar")).toContainText("First-Time User · WHY TO");

    // A typed reply that maps to an option advances; nonsense asks for clarification.
    await reply(page, "hmm not sure what you mean");
    await expect(page.getByText("I want to be sure I follow you")).toBeVisible();
    await reply(page, "yes");
    await expect(page.locator("#guidedChoices .qr-btn--guided").first()).toBeVisible();

    // A question mid-step is answered and the step is preserved.
    await reply(page, "what is inflammation?");
    await expect(page.getByText(/Back to where we were/)).toBeVisible();

    // Pause, then resume from the dashboard card.
    await page.getByRole("button", { name: "Pause" }).click();
    await expect(page.getByText(/Paused\./)).toBeVisible();
    await open(page, "/app");
    await expect(page.getByRole("button", { name: /Continue the introduction/ })).toBeVisible();
    await page.getByRole("button", { name: /Continue the introduction/ }).click();
    await expect(page.locator("#guidedChoices .qr-btn--guided").first()).toBeVisible();
  });

  test("Progress Tracker Guide: Yes to labs opens Blood Markers, the guide resumes, and Health Assessment is a real destination", async ({ page }) => {
    await open(page, "/login");
    await page.getByLabel("Your Email").fill(member.email);
    await page.getByPlaceholder("Your Password").fill(member.password);
    await page.getByRole("button", { name: "Login" }).click();
    await expect(page).toHaveURL(/\/(app|onboarding)/);

    await open(page, "/app/companion?flow=progress_tracker_guide");
    await expect(page.getByText(/Do you have any recent lab results you can enter\?/)).toBeVisible();
    await page.locator("#guidedChoices").getByRole("button", { name: "Yes", exact: true }).click();
    // NAVIGATION: the browser goes to the real tracker (the server only names it).
    await expect(page).toHaveURL(/\/app\/progress\/blood-markers/, { timeout: 15_000 });

    // Back to Sprout: the session resumes at "more than one tracker?".
    await open(page, "/app/companion?flow=progress_tracker_guide");
    await expect(page.getByText("Would you like to do more than one progress tracker?")).toBeVisible();
    await page.locator("#guidedChoices").getByRole("button", { name: "Yes", exact: true }).click();
    await expect(page.getByText("Would you like to do a BMI analysis?")).toBeVisible();
    await page.locator("#guidedChoices").getByRole("button", { name: "No", exact: true }).click();
    await expect(page.getByText(/Health Status Report\?/)).toBeVisible();
    // Health Assessment is connected: Yes opens the real tracker instead of "not connected".
    await page.locator("#guidedChoices").getByRole("button", { name: "Yes", exact: true }).click();
    await expect(page.getByText(/open the Health Status Report in My Progress/)).toBeVisible();
    await expect(page).toHaveURL(/\/app\/progress\/health-assessment/, { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: "Health Assessment" })).toBeVisible();
  });
});
