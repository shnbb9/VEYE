import { expect, test, type Page } from "@playwright/test";
import { ADMIN } from "../fixtures/accounts";
import { adminSignIn, expectAdminHome, open } from "../fixtures/helpers";

/* Every filter, sort and pager on the console's list screens.
 *
 * `console.spec.ts` searches the member directory and exercises the Content
 * lifecycle; `console-shape.spec.ts` clicks the audit log's Newer and Older.
 * Nothing touched the rest: three select filters on Members, four sortable
 * column headers, Clear, the Requests view tabs and kind filter, or the
 * caption that tells the administrator how much of the list they are looking
 * at — and a caption that disagrees with the rows is how a reader is misled
 * about what they have seen.
 *
 * The seed is smaller than one page, so these assert the states that are
 * reachable: a pager that is absent when there is nothing to page to, a
 * caption whose numbers match the rows rendered, every filter changing the set
 * and Clear restoring it exactly, and every sort header reordering, reversing
 * and reporting itself through aria-sort.
 */

/* Every control here refetches the list, so a read taken straight after the
   click can see the OLD rows and the NEW caption — or the reverse. The first
   version of this spec did exactly that and reported "claims 8 rows but 0 are
   rendered", which was the test racing the refetch rather than a defect. Each
   change now waits for its own response. */
async function settled(page: Page, pathPart: string, act: () => Promise<unknown>) {
  const response = page.waitForResponse(
    (r) => r.url().includes(pathPart) && r.request().method() === "GET", { timeout: 15_000 });
  await act();
  await response;
  // One frame for React to commit the new rows.
  await page.waitForTimeout(150);
}

async function rowKeys(page: Page, testId: string): Promise<string[]> {
  return page.getByTestId(testId).locator("tbody tr").evaluateAll(
    (rows) => rows.map((row) => (row.textContent ?? "").replace(/\s+/g, " ").trim()));
}

/** The two numbers in "Showing N of M …" must be the rows and the total. */
async function expectCaptionMatchesRows(page: Page, testId: string) {
  const caption = await page.locator(".pager__info").first().innerText();
  const [shown, total] = (caption.match(/\d+/g) ?? []).map(Number);
  const rendered = await page.getByTestId(testId).locator("tbody tr").count();
  expect(shown, `"${caption}" claims ${shown} rows but ${rendered} are rendered`).toBe(rendered);
  expect(total, `"${caption}" claims a total below the rows shown`).toBeGreaterThanOrEqual(shown);
  return { shown, total };
}

/** A pager must exist only when there is somewhere to go. */
async function expectPagerAgreesWithTotal(page: Page, shown: number, total: number) {
  const previous = page.getByRole("button", { name: "Previous", exact: true });
  if (total <= shown) {
    await expect(previous, "a pager is offered with only one page of rows").toHaveCount(0);
    return;
  }
  await expect(previous).toBeVisible();
  await expect(previous, "Previous is enabled on page 1").toBeDisabled();
}

test.describe("Console list controls", () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test.beforeEach(async ({ page }) => {
    await open(page, "/admin/login");
    await adminSignIn(page, ADMIN.email, ADMIN.password);
    await expectAdminHome(page);
  });

  test("Members: every filter narrows, Clear restores, and the caption matches the rows", async ({ page }) => {
    await open(page, "/admin/members");
    await expect(page.getByTestId("members-table")).toBeVisible();

    const all = await rowKeys(page, "members-table");
    expect(all.length, "the seed should list some members").toBeGreaterThan(2);
    const { shown, total } = await expectCaptionMatchesRows(page, "members-table");
    await expectPagerAgreesWithTotal(page, shown, total);

    // Each select, each option: the set it produces is a subset of the whole,
    // and the caption keeps agreeing with what is rendered.
    const filters: { label: string; options: string[] }[] = [
      { label: "Member status", options: ["active", "inactive", "unverified"] },
      { label: "Onboarding status", options: ["complete", "not_started"] },
      { label: "Last activity", options: ["week", "month", "longer", "never"] },
    ];
    for (const filter of filters) {
      for (const option of filter.options) {
        await settled(page, "/api/v1/admin/members", () => page.getByLabel(filter.label).selectOption(option));
        await expect(page.getByTestId("members-table").or(page.locator(".state"))).toBeVisible();
        const rows = await rowKeys(page, "members-table");
        expect(rows.length, `${filter.label}=${option} returned more rows than the unfiltered list`).toBeLessThanOrEqual(all.length);
        for (const row of rows) expect(all, `${filter.label}=${option} produced a row the unfiltered list does not have`).toContain(row);
        if (rows.length) await expectCaptionMatchesRows(page, "members-table");
        // The count of active filters is shown, so the reader knows the list
        // is not everything.
        await expect(page.locator(".filtercount")).toContainText(/1 filter active/);
      }
      await settled(page, "/api/v1/admin/members", () => page.getByLabel(filter.label).selectOption("any"));
    }

    // Two filters at once, then Clear restores exactly the original set.
    await settled(page, "/api/v1/admin/members", () => page.getByLabel("Member status").selectOption("active"));
    await settled(page, "/api/v1/admin/members", () => page.getByLabel("Onboarding status").selectOption("complete"));
    await expect(page.locator(".filtercount")).toContainText(/2 filters active/);
    await settled(page, "/api/v1/admin/members", () => page.getByRole("button", { name: "Clear", exact: true }).click());
    await expect(page.locator(".filtercount")).toHaveCount(0);
    expect(await rowKeys(page, "members-table"), "Clear did not restore the list").toEqual(all);
  });

  test("Members: every column header sorts, reverses, and says so", async ({ page }) => {
    await open(page, "/admin/members");
    await expect(page.getByTestId("members-table")).toBeVisible();
    const all = await rowKeys(page, "members-table");

    for (const label of ["Member", "Joined", "Health Number", "Last active"]) {
      const header = page.getByRole("button", { name: `Sort by ${label}` });
      if (await header.count() === 0) continue;   // a column hidden at this width
      await settled(page, "/api/v1/admin/members", () => header.click());
      const ascending = await rowKeys(page, "members-table");
      expect(ascending.slice().sort(), `sorting by ${label} lost or added a row`).toEqual(all.slice().sort());
      const cell = page.locator("th", { has: header });
      await expect(cell, `${label} does not report its sort through aria-sort`).toHaveAttribute("aria-sort", /ascending|descending/);

      await settled(page, "/api/v1/admin/members", () => header.click());
      const reversed = await rowKeys(page, "members-table");
      expect(reversed.slice().sort(), `reversing ${label} lost or added a row`).toEqual(all.slice().sort());
      if (all.length > 1) {
        expect(reversed, `clicking ${label} twice did not reverse the order`).not.toEqual(ascending);
      }
    }
  });

  test("Requests: each view tab and the kind filter change the list honestly", async ({ page }) => {
    await open(page, "/admin/requests");
    // The list is `[data-testid="requests-list"]`, whose rows are `button.flag`.
    const list = page.getByTestId("requests-list").locator("button.flag");
    await expect(page.getByRole("tablist", { name: "Which requests" })).toBeVisible();

    /* Counts are NOT compared between views. Other specs in this suite create
       requests, so "All shows at least as many as Resolved" can fail on a
       shared database for reasons that have nothing to do with the control —
       it did. What is asserted instead holds whatever else is in the table:
       every row shown under a view or a kind really belongs to it. */
    for (const view of ["Open", "All", "Resolved"]) {          // VIEWS, in order
      const tab = page.getByRole("tab", { name: view, exact: true });
      // Clicking the tab already selected changes no state, so there is no
      // refetch to wait for. "Open" is the default view, so whether that is
      // true depends on what ran before — which made this test order-dependent
      // until it asked.
      if (await tab.getAttribute("aria-selected") === "true") {
        await tab.click();
      } else {
        await settled(page, "/api/v1/admin/requests", () => tab.click());
      }
      await expect(tab).toHaveAttribute("aria-selected", "true");
      const rows = await list.count();
      // Either rows or a stated empty state — never a blank panel.
      if (rows === 0) await expect(page.locator(".state")).toBeVisible();
      // Resolved requests are not new, so that chip may not appear there.
      if (view === "Resolved") {
        await expect(page.getByTestId("requests-list").locator(".chip--attention"),
                     "the Resolved view listed a request still marked New").toHaveCount(0);
      }
    }

    // The kind filter: every row left on screen carries the chosen kind.
    const allTab = page.getByRole("tab", { name: "All", exact: true });
    if (await allTab.getAttribute("aria-selected") !== "true") {
      await settled(page, "/api/v1/admin/requests", () => allTab.click());
    }
    const kind = page.getByLabel("Kind");
    const options = await kind.locator("option").evaluateAll(
      (nodes) => nodes.map((node) => ({ value: (node as HTMLOptionElement).value, label: node.textContent ?? "" })));
    expect(options.length, "the kind filter offers nothing to choose").toBeGreaterThan(1);
    for (const option of options) {
      // Selecting the value already chosen fires no change event, so there is
      // no refetch to wait for — waiting for one timed out.
      if (await kind.inputValue() === option.value) continue;
      await settled(page, "/api/v1/admin/requests", () => kind.selectOption(option.value));
      const rows = await list.count();
      if (rows === 0) {
        await expect(page.locator(".state")).toBeVisible();
        continue;
      }
      if (option.value === "") continue;                       // "All kinds"
      const labels = await list.locator(".t-support").allInnerTexts();
      for (const text of labels) {
        expect(text, `kind=${option.value} left a row labelled "${text.split(" · ")[0]}" on screen`)
          .toContain(option.label);
      }
    }
  });

  test("Assessments: the attempts list captions itself and offers no pager it cannot use", async ({ page }) => {
    await open(page, "/admin/assessments");
    await page.getByRole("link", { name: /Health Number/ }).first().click();
    await expect(page).toHaveURL(/\/admin\/assessments\/health_number/);
    const info = page.locator(".pager__info");
    await expect(info).toBeVisible();
    const [shown, total] = ((await info.innerText()).match(/\d+/g) ?? []).map(Number);
    const rendered = await page.locator("tbody tr").count();
    expect(shown, `the caption claims ${shown} results but ${rendered} rows are rendered`).toBe(rendered);
    await expectPagerAgreesWithTotal(page, shown, total);
  });
});

/* The same controls on a narrow screen.
 *
 * `responsive.spec.ts` asserts no overflow, no heading skipped and a named
 * rail at four widths. None of that says the filters can still be USED: at
 * 768 the rail collapses to icons, the findbar wraps, and the members table
 * hides its low-priority columns, so a sort header can disappear and a select
 * can end up under something. These drive them.
 */
for (const width of [768, 390]) {
  test.describe(`Console list controls at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });
    test.beforeEach(async ({ page }) => {
      await open(page, "/admin/login");
      await adminSignIn(page, ADMIN.email, ADMIN.password);
      await expectAdminHome(page);
    });

    test("every Members filter is still reachable and still filters", async ({ page }) => {
      await open(page, "/admin/members");
      await expect(page.getByTestId("members-table")).toBeVisible();
      const all = await rowKeys(page, "members-table");

      for (const [label, option] of [["Member status", "active"], ["Onboarding status", "complete"],
                                     ["Last activity", "week"]] as const) {
        const control = page.getByLabel(label);
        // Reachable: Playwright's actionability checks fail if it is covered,
        // off-screen or zero-sized at this width.
        await control.click({ trial: true, timeout: 5000 });
        await settled(page, "/api/v1/admin/members", () => control.selectOption(option));
        const rows = await rowKeys(page, "members-table");
        for (const row of rows) expect(all, `${label}=${option} at ${width}px produced an unexpected row`).toContain(row);
        await settled(page, "/api/v1/admin/members", () => control.selectOption("any"));
      }
      expect(await rowKeys(page, "members-table")).toEqual(all);
    });

    test("the sort headers that survive this width still sort", async ({ page }) => {
      await open(page, "/admin/members");
      await expect(page.getByTestId("members-table")).toBeVisible();
      const all = await rowKeys(page, "members-table");
      let exercised = 0;
      for (const label of ["Member", "Joined", "Health Number", "Last active"]) {
        const header = page.getByRole("button", { name: `Sort by ${label}` });
        if (await header.count() === 0) continue;          // column dropped at this width
        if (!(await header.isVisible())) continue;
        await header.click({ trial: true, timeout: 5000 });
        await settled(page, "/api/v1/admin/members", () => header.click());
        expect((await rowKeys(page, "members-table")).slice().sort(),
               `sorting by ${label} at ${width}px lost or added a row`).toEqual(all.slice().sort());
        exercised += 1;
      }
      // "Member" carries no priority attribute, so it is never dropped.
      expect(exercised, `no sort header was usable at ${width}px`).toBeGreaterThan(0);
    });
  });
}

/* Controls hidden by CSS whose replacement was never built.
 *
 * Two rules in the console stylesheets took working controls off the screen
 * and handed off to an element nothing renders:
 *
 *   `.findbar__filters { display: none }` below 900px, handing off to
 *   `.findbar__drawerbtn` — so the member directory had no status, onboarding
 *   or activity filter at all on a tablet or a phone.
 *
 *   a bare `.search { display: none }` below 640px, written for the top bar
 *   (which has no search field) and handing off to `.topbar__searchbtn`. It
 *   reached the find bar on five screens instead, leaving each with no way to
 *   search.
 *
 * Neither looked wrong: the elements were still in the DOM, still
 * `visibility: visible`, still `pointer-events: auto` — with a 0x0 box,
 * because their parent was display:none. Only asking whether they can be
 * clicked finds that.
 */
const SEARCHABLE: { path: string; search: string }[] = [
  { path: "/admin/members", search: "#mSearch" },
  { path: "/admin/requests", search: "#rqSearch" },
  { path: "/admin/content", search: "#cSearch" },
  { path: "/admin/companion/conversations", search: "#cvSearch" },
];

for (const width of [1440, 768, 390]) {
  test.describe(`Console controls remain usable at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });
    test.beforeEach(async ({ page }) => {
      await open(page, "/admin/login");
      await adminSignIn(page, ADMIN.email, ADMIN.password);
      await expectAdminHome(page);
    });

    test("every find-bar search field can be typed into", async ({ page }) => {
      const broken: string[] = [];
      for (const { path, search } of SEARCHABLE) {
        await open(page, path);
        await expect(page.locator("#main-content")).toBeVisible();
        const field = page.locator(search).first();
        if (await field.count() === 0) { broken.push(`${path} — no search field found at all`); continue; }
        const box = await field.boundingBox();
        if (!box || box.width < 40 || box.height < 20) {
          broken.push(`${path} — the search field is ${box ? `${Math.round(box.width)}x${Math.round(box.height)}` : "unmeasurable"}`);
          continue;
        }
        try {
          await field.fill("probe", { timeout: 5000 });
          await expect(field).toHaveValue("probe");
          await field.fill("");
        } catch (reason) {
          broken.push(`${path} — could not type into it: ${String(reason).split("\n")[0].slice(0, 70)}`);
        }
      }
      expect(broken, `search fields unusable at ${width}px`).toEqual([]);
    });

    test("every Members filter can be opened and chosen from", async ({ page }) => {
      await open(page, "/admin/members");
      await expect(page.getByTestId("members-table")).toBeVisible();
      const unusable: string[] = [];
      for (const [label, option] of [["Member status", "active"], ["Onboarding status", "complete"],
                                     ["Last activity", "week"]] as const) {
        const control = page.getByLabel(label);
        const box = await control.boundingBox();
        if (!box || box.width < 40 || box.height < 20) {
          unusable.push(`${label} is ${box ? `${Math.round(box.width)}x${Math.round(box.height)}` : "unmeasurable"}`);
          continue;
        }
        try {
          await control.click({ trial: true, timeout: 5000 });
          await settled(page, "/api/v1/admin/members", () => control.selectOption(option));
          await settled(page, "/api/v1/admin/members", () => control.selectOption("any"));
        } catch (reason) {
          unusable.push(`${label}: ${String(reason).split("\n")[0].slice(0, 70)}`);
        }
      }
      expect(unusable, `Members filters unusable at ${width}px`).toEqual([]);
    });
  });
}
