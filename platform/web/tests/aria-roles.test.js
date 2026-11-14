/* `aria-selected` is ignored unless the element is a tab (or an option, row,
 * gridcell, treeitem, columnheader or rowheader).
 *
 * The console's filter strips are the same markup copied from screen to
 * screen, and three of them carried `aria-selected` on a plain `<button>`:
 * Companion → Conversations, Companion → Feedback and the AI monitoring
 * window. The active filter was styled, so it reached the eye; assistive
 * technology was told nothing, because the attribute does not apply to a
 * button. Requests had the roles and the others did not, which is how a
 * copy-paste pattern drifts.
 *
 * Runs with `node tests/aria-roles.test.js`. No install, non-zero on failure.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
/** Roles that give `aria-selected` a meaning (WAI-ARIA 1.2). */
const SELECTABLE = ["tab", "option", "row", "gridcell", "treeitem", "columnheader", "rowheader"];

function sources(dir, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sources(full, found);
    else if (entry.name.endsWith(".tsx")) found.push(full);
  }
  return found;
}

/** The opening tag that holds a given match index, braces and quotes skipped. */
function openingTagAt(text, index) {
  let start = text.lastIndexOf("<", index);
  if (start === -1) return "";
  let depth = 0;
  let quote = "";
  for (let i = start + 1; i < text.length; i += 1) {
    const c = text[i];
    if (quote) { if (c === quote) quote = ""; continue; }
    if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
    if (c === "{") depth += 1;
    else if (c === "}") depth -= 1;
    else if (c === ">" && depth === 0) return text.slice(start, i + 1);
  }
  return text.slice(start);
}

const files = [...sources(path.join(root, "app")), ...sources(path.join(root, "components"))];
const offenders = [];
let total = 0;

for (const file of files) {
  const text = fs.readFileSync(file, "utf8");
  const rel = path.relative(root, file).replaceAll("\\", "/");
  for (const match of text.matchAll(/aria-selected\s*=/g)) {
    total += 1;
    const tag = openingTagAt(text, match.index);
    const role = tag.match(/\brole\s*=\s*"([a-z]+)"/);
    if (!role || !SELECTABLE.includes(role[1])) {
      const line = text.slice(0, match.index).split("\n").length;
      offenders.push(`${rel}:${line} — role=${role ? `"${role[1]}"` : "(none)"} — ${tag.replace(/\s+/g, " ").slice(0, 100)}`);
    }
  }
}

// A parser that found nothing would pass this test forever.
assert.ok(total >= 8, `expected to find the application's aria-selected uses, found ${total}`);

assert.deepEqual(
  offenders,
  [],
  `${offenders.length} element(s) set aria-selected without a role that gives it meaning (${SELECTABLE.join(", ")}).\n` +
  `The container needs role="tablist" and each control role="tab", as app/admin/requests/page.tsx has:\n  ${offenders.join("\n  ")}\n`,
);

console.log(`aria roles: PASS (${total} aria-selected uses, all on a selectable role)`);
