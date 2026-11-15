import { expect, test, type APIRequestContext } from "@playwright/test";
import { ADMIN, freshMember } from "../fixtures/accounts";
import { adminSignIn, apiContext, csrfHeaders, expectAdminHome, open, signUpMember } from "../fixtures/helpers";

/* The Fitness library (owner request, 15 Nov 2026): the console fills the
   member Fitness screen's four goals with YouTube or Vimeo links and picks
   each goal's main video; members see the main video in the big player, the
   rest nine to a page, and any card plays in the big player.

   The local database is shared and outlives this run, so every video here
   has its own stamped id and title, the goal's earlier main video is put
   back, and everything this test adds is removed again — even on failure. */

const GOAL = { key: "fit", label: "Get Fit" } as const;
const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
/** A valid-looking YouTube id (11 of [A-Za-z0-9_-]), unique per run and per
 *  video: 8 characters of this run's stamp, then the video's number. */
const runKey = stamp.replace(/[^A-Za-z0-9]/g, "").padStart(8, "0").slice(-8);
const videoId = (n: number) => `${runKey}${n.toString(36).padStart(3, "0")}`;
const titleOf = (n: number) => `E2E ${stamp} video ${n}`;

type Video = { id: string; title: string; is_main: boolean; published: boolean };

let admin: APIRequestContext;
let previousMain: string | null = null;

async function library(): Promise<Video[]> {
  return (await (await admin.get(`/api/v1/admin/fitness/videos?goal=${GOAL.key}`)).json()).videos;
}

test.beforeAll(async () => {
  admin = await apiContext();
  const signedIn = await admin.post("/api/v1/auth/admin/sign-in", { data: { email: ADMIN.email, password: ADMIN.password, remember: false } });
  expect(signedIn.status()).toBe(200);
  previousMain = (await library()).find((v) => v.is_main)?.id ?? null;
});

test.afterAll(async () => {
  for (const video of (await library()).filter((v) => v.title.startsWith(`E2E ${stamp}`))) {
    await admin.delete(`/api/v1/admin/fitness/videos/${video.id}`, { headers: await csrfHeaders(admin) });
  }
  if (previousMain && (await library()).some((v) => v.id === previousMain && !v.is_main)) {
    await admin.post(`/api/v1/admin/fitness/videos/${previousMain}/main`, { headers: await csrfHeaders(admin), data: {} });
  }
  await admin.dispose();
});

test("the console fills a goal, picks its main video, and members see it: main first, nine to a page", async ({ page, browser }) => {
  // ---- the console: one video through the form, the rest through the API ----
  await adminSignIn(page, ADMIN.email, ADMIN.password);
  await expectAdminHome(page);
  await open(page, "/admin/care/fitness-library");
  await page.getByTestId("fitness-goals").getByRole("button", { name: new RegExp(`^${GOAL.label}`) }).click();
  await page.getByLabel("YouTube or Vimeo link").fill(`https://www.youtube.com/watch?v=${videoId(1)}`);
  await page.getByLabel(/^Title members see/).fill(titleOf(1));
  await page.getByLabel("Subtitle").fill("Added through the form");
  await page.getByRole("button", { name: "Add video" }).click();
  await expect(page.getByTestId("fitness-note")).toContainText(`“${titleOf(1)}” is in ${GOAL.label}.`);
  const row = page.getByTestId("fitness-row").filter({ hasText: titleOf(1) });
  await expect(row).toBeVisible();

  // A link that is not YouTube or Vimeo is refused, in words.
  await page.getByLabel("YouTube or Vimeo link").fill("https://example.com/workout.mp4");
  await page.getByLabel(/^Title members see/).fill("Not a video link");
  await page.getByRole("button", { name: "Add video" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Only YouTube and Vimeo links can be added" })).toBeVisible();

  for (let n = 2; n <= 11; n++) {
    const added = await admin.post("/api/v1/admin/fitness/videos", {
      headers: await csrfHeaders(admin), data: { goal: GOAL.key, url: `https://youtu.be/${videoId(n)}`, title: titleOf(n), subtitle: `Session ${n}` } });
    expect(added.status(), await added.text()).toBe(201);
  }
  await page.reload();
  await page.getByTestId("fitness-goals").getByRole("button", { name: new RegExp(`^${GOAL.label}`) }).click();

  // Video 3 becomes the main video; video 11 is hidden from members.
  await page.getByTestId("fitness-row").filter({ hasText: titleOf(3) }).getByTestId("fitness-make-main").click();
  await expect(page.getByTestId("fitness-note")).toContainText(`“${titleOf(3)}” is now the main video.`);
  await expect(page.getByTestId("fitness-row").first()).toContainText(titleOf(3));
  await expect(page.getByTestId("fitness-row").first()).toContainText("Main video");
  await page.getByTestId("fitness-row").filter({ hasText: titleOf(11) }).getByRole("button", { name: "Hide" }).click();
  await expect(page.getByTestId("fitness-row").filter({ hasText: titleOf(11) })).toContainText("Hidden");

  // ---- a member ----
  const member = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await signUpMember(member, freshMember("e2e"));
  await open(member, "/app/fitness");
  const libraryCard = member.getByTestId("fitness-library");
  await libraryCard.getByRole("tab", { name: new RegExp(`^${GOAL.label}`) }).click();
  await expect(libraryCard.getByRole("tab", { name: new RegExp(`^${GOAL.label}`) })).toHaveAttribute("aria-selected", "true");

  const player = member.getByTestId("fitness-player");
  await expect(player.locator("figcaption strong")).toHaveText(titleOf(3));
  await expect(player.locator("iframe")).toHaveCount(0);      // nothing from YouTube until play
  await member.getByTestId("fitness-play").click();
  await expect(player.locator("iframe")).toHaveAttribute("src", `https://www.youtube-nocookie.com/embed/${videoId(3)}?autoplay=1`);

  // The member's view of this goal: our ten shown videos (plus whatever the
  // shared stack already holds), main first, nine to a page.
  const cards = member.getByTestId("fitness-video");
  await expect(cards).toHaveCount(9);
  await expect(cards.first()).toContainText(titleOf(3));
  await expect(cards.first()).toContainText("Featured");
  await expect(member.getByTestId("fitness-pages")).toBeVisible();
  const allTitles: string[] = [];
  const pages = await member.getByTestId("fitness-pages").getByRole("button", { name: /^Page \d+$/ }).count();
  for (let n = 1; n <= pages; n++) {
    await member.getByTestId("fitness-pages").getByRole("button", { name: `Page ${n}` }).click();
    await expect(member.getByTestId("fitness-pages").getByRole("button", { name: `Page ${n}` })).toHaveAttribute("aria-current", "page");
    allTitles.push(...await cards.locator(".fit-thumb__cap b").allTextContents());
  }
  const ours = allTitles.filter((t) => t.startsWith(`E2E ${stamp}`));
  expect(ours).toHaveLength(10);
  expect(ours).not.toContain(titleOf(11));                   // hidden from members

  // Any card plays in the big player and says so.
  await member.getByTestId("fitness-pages").getByRole("button", { name: "Page 1" }).click();
  const fifth = cards.filter({ hasText: titleOf(5) });
  await fifth.click();
  await expect(player.locator("figcaption strong")).toHaveText(titleOf(5));
  await expect(player.locator("iframe")).toHaveAttribute("src", new RegExp(`/embed/${videoId(5)}\\?autoplay=1$`));
  await expect(fifth).toHaveAttribute("aria-pressed", "true");
  await expect(fifth.locator(".fit-thumb__playing")).toHaveText("Now Playing");
  await member.context().close();
});
