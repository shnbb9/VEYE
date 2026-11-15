import { expect, test, type Page } from "@playwright/test";
import { API_URL, freshMember } from "../fixtures/accounts";
import { open, signUpMember } from "../fixtures/helpers";

/* "Snap a photo" on a computer: the webcam (owner request, 15 Nov 2026).
   Chromium's fake camera stands in for a real one (a moving test pattern) and
   the permission is granted up front. Browser launch switches have to be set
   for the whole file, so these tests live apart from food-diary-photo.spec.ts.
   Chromium only: this file is never part of the WebKit pass. */
test.use({
  permissions: ["camera"],
  launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] },
});

async function dayMeals(page: Page): Promise<{ id: string; photo_version: string | null }[]> {
  return page.evaluate(async (api) => {
    const today = new Date();
    const key = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    return (await (await fetch(`${api}/api/v1/members/me/food-diary?date=${key}`, { credentials: "include" })).json()).meals;
  }, API_URL);
}

test("Snap a photo: take it, use it, and it is kept with the meal", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "the fake camera is a Chromium switch");
  await signUpMember(page, freshMember("photo"));
  await open(page, "/app/food-diary");
  await page.getByTestId("diary-snap").click();
  const camera = page.getByTestId("camera-dialog");
  await expect(camera).toBeVisible();
  await expect(page.getByTestId("camera-take")).toBeEnabled();
  await page.getByTestId("camera-take").click();
  await page.getByTestId("camera-use").click();
  await expect(camera).toBeHidden();
  await expect(page.getByTestId("diary-photo-pending").locator("img")).toBeVisible();
  await page.locator("#fdxWhat").fill("Snapped stir fry");
  await page.locator("#fdxTime").fill("19:05");
  await page.locator("#fdxAdd").click();
  await expect(page.getByTestId("diary-meal-photo")).toBeVisible();

  const [meal] = await dayMeals(page);
  expect(meal.photo_version).toBeTruthy();
  const kept = await page.evaluate(async ({ api, id }) => {
    const response = await fetch(`${api}/api/v1/members/me/food-diary/${id}/photo?size=full`, { credentials: "include" });
    const bitmap = await createImageBitmap(await response.blob());
    return { status: response.status, type: response.headers.get("content-type"), width: bitmap.width };
  }, { api: API_URL, id: meal.id });
  expect(kept.status).toBe(200);
  expect(kept.type).toBe("image/jpeg");
  expect(kept.width).toBeGreaterThan(0);
});

test("Cancel switches the camera off and adds nothing", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "the fake camera is a Chromium switch");
  await signUpMember(page, freshMember("photo"));
  await open(page, "/app/food-diary");
  await page.getByTestId("diary-snap").click();
  await expect(page.getByTestId("camera-take")).toBeEnabled();
  // Hold on to the camera's track, so its state can be read after the dialog is gone.
  const live = await page.getByTestId("camera-preview").evaluate((video: HTMLVideoElement) => {
    const track = (video.srcObject as MediaStream | null)?.getVideoTracks()[0];
    (window as unknown as { cameraTrack?: MediaStreamTrack }).cameraTrack = track;
    return track?.readyState ?? "none";
  });
  expect(live).toBe("live");
  await page.getByTestId("camera-dialog").getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByTestId("camera-dialog")).toBeHidden();
  expect(await page.evaluate(() => (window as unknown as { cameraTrack?: MediaStreamTrack }).cameraTrack?.readyState)).toBe("ended");
  await expect(page.getByTestId("diary-photo-pending")).toHaveCount(0);
});
