import { expect, test, type Page } from "@playwright/test";
import { API_URL, freshMember } from "../fixtures/accounts";
import { open, signUpMember } from "../fixtures/helpers";

/* The circular crop (owner request, 15 Nov 2026): "crop it exactly like it's
   going to appear in my avatar". Proven on the SAVED picture's pixels, not on
   the screen alone: a four-colour picture makes a square that lands anywhere
   but where the frame showed it come back the wrong colour. The original is
   kept, so "Adjust photo" re-crops it without a new upload. */

const PICTURE = { width: 400, height: 300, splitX: 200, splitY: 150 };
const COLOURS = { tl: [220, 30, 30], tr: [30, 200, 60], bl: [40, 60, 220], br: [240, 220, 20] };

/** A real PNG, drawn by the browser itself. */
async function quadrants(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate(({ p, c }) => {
    const canvas = document.createElement("canvas");
    canvas.width = p.width;
    canvas.height = p.height;
    const ctx = canvas.getContext("2d")!;
    const fill = (rgb: number[], x: number, y: number, w: number, h: number) => { ctx.fillStyle = `rgb(${rgb.join(",")})`; ctx.fillRect(x, y, w, h); };
    fill(c.br, 0, 0, p.width, p.height);
    fill(c.tl, 0, 0, p.splitX, p.splitY);
    fill(c.tr, p.splitX, 0, p.width - p.splitX, p.splitY);
    fill(c.bl, 0, p.splitY, p.splitX, p.height - p.splitY);
    return canvas.toDataURL("image/png").split(",")[1];
  }, { p: PICTURE, c: COLOURS });
  return Buffer.from(base64, "base64");
}

const colourAt = (x: number, y: number) =>
  x < PICTURE.splitX ? (y < PICTURE.splitY ? COLOURS.tl : COLOURS.bl) : (y < PICTURE.splitY ? COLOURS.tr : COLOURS.br);

/** One pixel of the saved avatar, read with the member's own session. */
async function avatarPixel(page: Page, fx: number, fy: number): Promise<number[]> {
  return page.evaluate(async ({ api, fx, fy }) => {
    const response = await fetch(`${api}/api/v1/members/me/photo?size=full&t=${Date.now()}`, { credentials: "include" });
    const bitmap = await createImageBitmap(await response.blob());
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(bitmap, 0, 0);
    const p = ctx.getImageData(Math.floor(bitmap.width * fx), Math.floor(bitmap.height * fy), 1, 1).data;
    return [p[0], p[1], p[2]];
  }, { api: API_URL, fx, fy });
}

async function frameCrop(page: Page) {
  const [x, y, size] = ((await page.getByTestId("crop-frame").getAttribute("data-crop")) ?? "").split(",").map(Number);
  return { x, y, size };
}

async function savedCrop(page: Page) {
  return page.evaluate(async (api) => (await (await fetch(`${api}/api/v1/auth/me`, { credentials: "include" })).json()).member.photo_crop, API_URL);
}

/** Every sample of the avatar is the original's colour at the same place in the chosen square. */
async function expectAvatarIsTheSquare(page: Page, crop: { x: number; y: number; size: number }) {
  for (const [fx, fy] of [[0.2, 0.2], [0.8, 0.2], [0.2, 0.8], [0.8, 0.8], [0.5, 0.5], [0.35, 0.65]]) {
    const ox = crop.x + crop.size * fx, oy = crop.y + crop.size * fy;
    // A sample right on a colour boundary is a blend after resampling.
    if (Math.abs(ox - PICTURE.splitX) < 4 || Math.abs(oy - PICTURE.splitY) < 4) continue;
    const got = await avatarPixel(page, fx, fy);
    const want = colourAt(ox, oy);
    expect(got.every((v, i) => Math.abs(v - want[i]) <= 30), `avatar ${fx},${fy} = ${got}; original ${Math.round(ox)},${Math.round(oy)} = ${want}`).toBe(true);
  }
}

test("the avatar is exactly the square chosen in the frame, and Adjust re-crops the kept original", async ({ page }) => {
  await signUpMember(page, freshMember("photo"));
  await open(page, "/app/settings");
  await page.getByTestId("settings-photo-input").setInputFiles({ name: "me.png", mimeType: "image/png", buffer: await quadrants(page) });

  const dialog = page.getByTestId("crop-dialog");
  const frame = page.getByTestId("crop-frame");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Crop your new photo" })).toBeVisible();
  await expect(frame).toHaveAttribute("data-crop", "50,0,300");   // the centred square to begin with

  // Zoom in from the keyboard, then drag the picture down and to the right
  // with the mouse (the circle moves towards the top-left of the picture).
  await frame.focus();
  for (let i = 0; i < 6; i++) await page.keyboard.press("+");
  const zoomed = await frameCrop(page);
  expect(zoomed.size).toBeLessThan(200);
  const box = (await frame.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 90, box.y + box.height / 2 + 40, { steps: 10 });
  await page.mouse.up();
  const chosen = await frameCrop(page);
  expect(chosen.x).toBeLessThan(zoomed.x);
  expect(chosen.y).toBeLessThan(zoomed.y);
  // The square straddles the picture's colour boundaries, so position errors show.
  expect(chosen.x < PICTURE.splitX && chosen.x + chosen.size > PICTURE.splitX).toBe(true);

  // The preview is drawn from the same square that will be saved.
  const [px, py] = (await page.getByTestId("crop-preview").evaluate((el) => getComputedStyle(el).backgroundPosition))
    .split(" ").map(parseFloat);
  const k = 96 / chosen.size;
  expect(px).toBeCloseTo(-chosen.x * k, 1);
  expect(py).toBeCloseTo(-chosen.y * k, 1);

  const saved = page.waitForResponse((r) => r.url().endsWith("/api/v1/members/me/photo") && r.request().method() === "POST");
  await page.getByTestId("crop-save").click();
  expect((await saved).status()).toBe(201);
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId("settings-profile-note")).toHaveText("Profile photo updated.");
  await expect(page.getByTestId("topbar-avatar")).toHaveAttribute("data-has-photo", "true");

  expect(await savedCrop(page)).toEqual({ width: 400, height: 300, ...chosen });
  await expectAvatarIsTheSquare(page, chosen);

  // Adjust: the kept original reopens exactly where it was left.
  await page.getByTestId("settings-photo-adjust").click();
  await expect(dialog.getByRole("heading", { name: "Adjust your photo" })).toBeVisible();
  await expect(frame).toHaveAttribute("data-crop", `${chosen.x},${chosen.y},${chosen.size}`);
  await frame.focus();
  for (let i = 0; i < 6; i++) await page.keyboard.press("Shift+ArrowLeft");  // the picture slides left: the circle shows more of its right
  for (let i = 0; i < 3; i++) await page.keyboard.press("Shift+ArrowUp");
  const moved = await frameCrop(page);
  expect(moved.x).toBeGreaterThan(chosen.x);
  expect(moved.size).toBe(chosen.size);

  const recropped = page.waitForResponse((r) => r.url().endsWith("/api/v1/members/me/photo/crop") && r.request().method() === "PUT");
  await page.getByTestId("crop-save").click();
  expect((await recropped).status()).toBe(200);
  await expect(dialog).toBeHidden();
  expect(await savedCrop(page)).toEqual({ width: 400, height: 300, ...moved });
  await expectAvatarIsTheSquare(page, moved);
});

test("the crop editor is a proper dialog: Escape and Cancel leave the old picture alone", async ({ page }) => {
  await signUpMember(page, freshMember("photo"));
  await open(page, "/app/settings");
  await page.getByTestId("settings-photo-input").setInputFiles({ name: "me.png", mimeType: "image/png", buffer: await quadrants(page) });
  await expect(page.getByTestId("crop-dialog")).toBeVisible();
  await expect(page.getByTestId("crop-frame")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("crop-dialog")).toBeHidden();
  await expect(page.getByTestId("settings-photo")).toHaveAttribute("data-has-photo", "false");

  // Too large is said before anything is uploaded.
  await page.getByTestId("settings-photo-input").setInputFiles({ name: "huge.png", mimeType: "image/png", buffer: Buffer.alloc(10_000_001) });
  await expect(page.getByTestId("settings-profile-note")).toHaveText("The photo is too large. Please use an image under 10 MB.");
  await expect(page.getByTestId("crop-dialog")).toBeHidden();
});
