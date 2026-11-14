/* One Help / FAQ category vocabulary, in four places that must agree.
 *
 * A published FAQ entry reaches the public page through a label→key map, is
 * filtered by chips that are fixed markup, and is titled from a key→label map.
 * The page files a category it does not recognise under "About Veye" in
 * silence, so any disagreement between these lists moves an answer to the
 * wrong chip with nothing reported anywhere — which is what free text in the
 * console's Category box could already do on its own.
 *
 * The four:
 *   api/app/content/models.py       HELP_FAQ_CATEGORIES  (what the API accepts)
 *   content/public/help.html        .help-cat chips      (what a reader can pick)
 *   components/public-source.tsx    FAQ_CATEGORY_KEYS    (label → chip key)
 *   components/public-interactions  titles               (chip key → heading)
 *
 * Runs with `node tests/help-categories.test.js`. No install, non-zero on failure.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const web = path.join(__dirname, "..");
const api = path.join(web, "..", "api");
const read = (...parts) => fs.readFileSync(path.join(...parts), "utf8");

/* 1. The API's tuple — the only list that can refuse a value. */
const apiSource = read(api, "app", "content", "models.py");
const tuple = apiSource.match(/HELP_FAQ_CATEGORIES\s*=\s*\(([\s\S]*?)\)/);
assert.ok(tuple, "HELP_FAQ_CATEGORIES was not found in api/app/content/models.py");
const apiCategories = [...tuple[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);

/* 2. The chips a reader can actually press. */
const helpHtml = read(web, "content", "public", "help.html");
const chips = [...helpHtml.matchAll(/<button[^>]*class="help-cat[^"]*"[^>]*data-cat="([a-z]+)"[^>]*>([^<]+)<\/button>/g)]
  .map((m) => ({ key: m[1], label: m[2].trim() }));

/* 3. label → key, used to place a published entry. */
const sourceTsx = read(web, "components", "public-source.tsx");
const mapBlock = sourceTsx.match(/FAQ_CATEGORY_KEYS[^=]*=\s*\{([\s\S]*?)\};/);
assert.ok(mapBlock, "FAQ_CATEGORY_KEYS was not found in components/public-source.tsx");
const labelToKey = new Map([...mapBlock[1].matchAll(/"([^"]+)":\s*"([a-z]+)"/g)].map((m) => [m[1], m[2]]));

/* 4. key → label, used for the heading above the list. */
const interactions = read(web, "components", "public-interactions.tsx");
const titlesBlock = interactions.match(/const titles: Record<string, string> = \{([\s\S]*?)\};/);
assert.ok(titlesBlock, "the titles record was not found in components/public-interactions.tsx");
const keyToLabel = new Map([...titlesBlock[1].matchAll(/([a-z]+):\s*"([^"]+)"/g)].map((m) => [m[1], m[2]]));

/* A parser that found nothing would pass this test forever. */
assert.equal(apiCategories.length, 5, `expected 5 API categories, parsed ${apiCategories.length}`);
assert.equal(chips.length, 5, `expected 5 .help-cat chips in help.html, parsed ${chips.length}`);
assert.equal(labelToKey.size, 5, `expected 5 FAQ_CATEGORY_KEYS entries, parsed ${labelToKey.size}`);
assert.equal(keyToLabel.size, 5, `expected 5 title entries, parsed ${keyToLabel.size}`);

/* Every list holds the same five labels. */
assert.deepEqual(
  [...apiCategories].sort(),
  chips.map((c) => c.label).sort(),
  "the API's HELP_FAQ_CATEGORIES and help.html's chips disagree — an accepted category with no chip is unreachable on the Help page",
);

for (const label of apiCategories) {
  const key = labelToKey.get(label);
  assert.ok(key, `FAQ_CATEGORY_KEYS has no entry for "${label}", so entries in that category would be filed under "About Veye"`);
  const chip = chips.find((c) => c.key === key);
  assert.ok(chip, `FAQ_CATEGORY_KEYS maps "${label}" to data-cat="${key}", which no chip in help.html uses`);
  assert.equal(chip.label, label, `chip "${key}" reads "${chip.label}" but the map files "${label}" under it`);
  assert.equal(keyToLabel.get(key), label, `the heading for "${key}" reads "${keyToLabel.get(key)}" but the chip reads "${label}"`);
}

console.log(`help categories: PASS (${apiCategories.length} categories agree across the API, help.html and both web maps)`);
