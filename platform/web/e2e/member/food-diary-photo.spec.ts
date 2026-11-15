import { expect, test, type Page } from "@playwright/test";
import { API_URL, freshMember } from "../fixtures/accounts";
import { open, signUpMember } from "../fixtures/helpers";

/* Food Diary photos (owner request, 15 Nov 2026): the prototype's photo row
   said "In Development"; now Snap a photo, Choose file and a pasted link all
   end in the meal's one kept photo. Each journey is read back from the API —
   the photo is real bytes the member's session can fetch, not a preview. */

/** A real JPEG drawn by the browser. */
async function jpeg(page: Page, rgb: [number, number, number], width = 640, height = 480): Promise<Buffer> {
  const base64 = await page.evaluate(({ rgb, width, height }) => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = `rgb(${rgb.join(",")})`;
    ctx.fillRect(0, 0, width, height);
    return canvas.toDataURL("image/jpeg", 0.92).split(",")[1];
  }, { rgb, width, height });
  return Buffer.from(base64, "base64");
}

async function logMeal(page: Page, what: string, time = "12:30") {
  await page.locator("#fdxWhat").fill(what);
  await page.locator("#fdxTime").fill(time);
}

async function dayMeals(page: Page): Promise<{ id: string; description: string; photo_version: string | null }[]> {
  return page.evaluate(async (api) => {
    const today = new Date();
    const key = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    return (await (await fetch(`${api}/api/v1/members/me/food-diary?date=${key}`, { credentials: "include" })).json()).meals;
  }, API_URL);
}

async function photoSize(page: Page, mealId: string): Promise<{ status: number; type: string | null; width: number }> {
  return page.evaluate(async ({ api, mealId }) => {
    const response = await fetch(`${api}/api/v1/members/me/food-diary/${mealId}/photo?size=full`, { credentials: "include" });
    if (!response.ok) return { status: response.status, type: null, width: 0 };
    const bitmap = await createImageBitmap(await response.blob());
    return { status: response.status, type: response.headers.get("content-type"), width: bitmap.width };
  }, { api: API_URL, mealId });
}

test.describe("Food Diary photos", () => {
  test("the photo row works: nothing says In Development any more", async ({ page }) => {
    await signUpMember(page, freshMember("photo"));
    await open(page, "/app/food-diary");
    await expect(page.locator(".fdx-photo")).not.toContainText(/In Development/i);
    await expect(page.getByTestId("diary-snap")).toBeEnabled();
    await expect(page.getByLabel("Meal photo url")).toBeEnabled();
    await expect(page.getByRole("button", { name: "Choose file" })).toBeEnabled();
  });

  test("Choose file: the photo is kept with the meal and opens full size", async ({ page }) => {
    await signUpMember(page, freshMember("photo"));
    await open(page, "/app/food-diary");
    await page.getByTestId("diary-photo-file").setInputFiles({ name: "lunch.jpg", mimeType: "image/jpeg", buffer: await jpeg(page, [40, 160, 70], 2400, 1800) });
    await expect(page.getByTestId("diary-photo-pending").locator("img")).toBeVisible();
    await logMeal(page, "Grilled chicken salad with avocado");
    await page.locator("#fdxAdd").click();

    const thumb = page.getByTestId("diary-meal-photo");
    await expect(thumb).toBeVisible();
    await expect(thumb.locator("img")).toHaveJSProperty("complete", true);
    expect(await thumb.locator("img").evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(400);
    await expect(page.getByTestId("diary-photo-pending")).toHaveCount(0);   // the form is clear again

    const [meal] = await dayMeals(page);
    expect(meal.photo_version).toBeTruthy();
    expect(await photoSize(page, meal.id)).toEqual({ status: 200, type: "image/jpeg", width: 1600 });

    await thumb.click();
    const viewer = page.getByTestId("diary-photo-view");
    await expect(viewer.getByRole("img")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(viewer).toBeHidden();
  });

  test("a pasted link is fetched by Veye and kept as its own copy; a private address is refused and the meal stays", async ({ page }) => {
    await signUpMember(page, freshMember("photo"));
    await open(page, "/app/food-diary");

    // Refused: an address on this machine. The meal is saved; the form says why
    // and stays on it so the link can be fixed.
    await page.getByLabel("Meal photo url").fill("http://127.0.0.1/photo.jpg");
    await expect(page.getByTestId("diary-photo-pending")).toContainText("Veye fetches the picture at this link");
    await logMeal(page, "Porridge with berries", "08:15");
    await page.locator("#fdxAdd").click();
    await expect(page.locator("#fdxErr")).toContainText("Your meal is saved, but the photo was not added");
    await expect(page.locator("#fdxErr")).toContainText("private or local address");
    await expect(page.locator("#fdxAdd")).toHaveText("Update Entry");
    let meals = await dayMeals(page);
    expect(meals.map((m) => [m.description, m.photo_version])).toEqual([["Porridge with berries", null]]);

    // Fixed: a picture this stack serves itself (the API's one trusted private
    // host, compose.local.yaml) — the whole link journey without the internet.
    await page.getByLabel("Meal photo url").fill("http://web:3000/assets/web/img/supplements.png");
    await page.locator("#fdxAdd").click();
    await expect(page.getByTestId("diary-meal-photo")).toBeVisible();
    await expect(page.locator("#fdxErr")).toBeHidden();
    meals = await dayMeals(page);
    expect(meals[0].photo_version).toBeTruthy();
    const kept = await photoSize(page, meals[0].id);
    expect(kept.status).toBe(200);
    expect(kept.type).toBe("image/png");
  });

  test("editing a meal can replace or remove its photo", async ({ page }) => {
    await signUpMember(page, freshMember("photo"));
    await open(page, "/app/food-diary");
    await page.getByTestId("diary-photo-file").setInputFiles({ name: "a.jpg", mimeType: "image/jpeg", buffer: await jpeg(page, [200, 40, 40]) });
    await logMeal(page, "Lentil soup");
    await page.locator("#fdxAdd").click();
    await expect(page.getByTestId("diary-meal-photo")).toBeVisible();
    const first = (await dayMeals(page))[0].photo_version;

    await page.locator("[data-fdx-edit='0']").click();
    await expect(page.getByTestId("diary-photo-pending").locator("img")).toBeVisible();   // the meal's own photo
    await page.getByTestId("diary-photo-file").setInputFiles({ name: "b.jpg", mimeType: "image/jpeg", buffer: await jpeg(page, [40, 40, 200]) });
    await page.locator("#fdxAdd").click();
    await expect(page.locator("#fdxAdd")).toHaveText("Add Entry");
    const second = (await dayMeals(page))[0].photo_version;
    expect(second).toBeTruthy();
    expect(second).not.toBe(first);

    await page.locator("[data-fdx-edit='0']").click();
    await page.getByRole("button", { name: "Remove photo" }).click();
    await expect(page.getByTestId("diary-photo-pending")).toContainText("removed when you update");
    await page.locator("#fdxAdd").click();
    await expect(page.getByTestId("diary-meal-photo")).toHaveCount(0);
    expect((await dayMeals(page))[0].photo_version).toBeNull();
  });

  test("a computer whose camera is refused says why and offers a file instead", async ({ page }) => {
    // This file runs without the fake-camera switches (food-diary-camera.spec.ts
    // has them), so the browser refuses the camera as a real one may.
    await signUpMember(page, freshMember("photo"));
    await open(page, "/app/food-diary");
    await page.getByTestId("diary-snap").click();
    const camera = page.getByTestId("camera-dialog");
    await expect(camera.getByRole("alert")).toContainText(/Camera access was blocked|No camera was found|could not be started/);
    await expect(page.getByTestId("camera-take")).toHaveCount(0);
    const chooser = page.waitForEvent("filechooser");
    await page.getByTestId("camera-choose-file").click();
    await (await chooser).setFiles({ name: "plate.jpg", mimeType: "image/jpeg", buffer: await jpeg(page, [120, 90, 40]) });
    await expect(camera).toBeHidden();
    await expect(page.getByTestId("diary-photo-pending").locator("img")).toBeVisible();
  });

  test("only pictures under 10 MB are offered for upload", async ({ page }) => {
    await signUpMember(page, freshMember("photo"));
    await open(page, "/app/food-diary");
    await page.getByTestId("diary-photo-file").setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
    await expect(page.locator("#fdxErr")).toHaveText("Please choose a JPG, PNG or WebP image.");
    await page.getByTestId("diary-photo-file").setInputFiles({ name: "huge.jpg", mimeType: "image/jpeg", buffer: Buffer.alloc(10_000_001) });
    await expect(page.locator("#fdxErr")).toHaveText("The photo is too large. Please use an image under 10 MB.");
    await expect(page.getByTestId("diary-photo-pending")).toHaveCount(0);
  });
});
