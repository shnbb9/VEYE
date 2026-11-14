/* Every form must say how it submits.
 *
 * A `<form>` with no `method` submits as a GET. These forms are all handled in
 * React — `onSubmit` calls `preventDefault()` — so the default never mattered
 * while the page was hydrated. Before it is hydrated, it does: the browser
 * performs the form's own submission, and a GET puts every field in the query
 * string.
 *
 * Measured with JavaScript disabled, before this was fixed:
 *
 *   /admin/login     → /admin/login?email=…&password=NotARealPassword%21123
 *   /login           → /login?email=…&password=NotARealPassword%21123&remember=on
 *   /signup          → /signup?password=NotARealPassword%21123&confirm=
 *   /reset-password  → /reset-password?password=NotARealPassword%21123&confirm=
 *
 * That is the address bar, the browser's history on disk, the `Referer` of the
 * next request and every access log in front of the application. The last one
 * also drops the reset token, so the page then reports the link as broken.
 * It needs no JavaScript failure to reach — only a submit (a click, or Enter in
 * a field) landing before hydration finishes on a slow connection.
 *
 * `method="post"` is the fix: the handler still preventDefaults, and the
 * submission that gets past it carries its fields in a body instead of a URL.
 * The member's own words are covered by the same rule — a GET on the Contact Us
 * dialog or the Companion chat would have put what they typed in the URL too.
 *
 * Runs with `node tests/form-method.test.js`. No install, non-zero on failure.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");

function sources(dir, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sources(full, found);
    else if (entry.name.endsWith(".tsx")) found.push(full);
  }
  return found;
}

const files = [...sources(path.join(root, "app")), ...sources(path.join(root, "components"))];

/** The opening tag of every `<form>`, however many lines its attributes span. */
function formTags(text) {
  const tags = [];
  const open = /<form(?=[\s>])/g;
  let match;
  while ((match = open.exec(text)) !== null) {
    // Walk to the matching ">", skipping the ones inside {…} expressions,
    // quotes or arrow functions in the attribute list.
    let depth = 0;
    let quote = "";
    let end = -1;
    for (let i = match.index + "<form".length; i < text.length; i += 1) {
      const c = text[i];
      if (quote) { if (c === quote) quote = ""; continue; }
      if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
      if (c === "{") depth += 1;
      else if (c === "}") depth -= 1;
      else if (c === ">" && depth === 0) { end = i; break; }
    }
    if (end === -1) break;
    const tag = text.slice(match.index, end + 1);
    tags.push({ tag, line: text.slice(0, match.index).split("\n").length });
    open.lastIndex = end + 1;
  }
  return tags;
}

const offenders = [];
let total = 0;
for (const file of files) {
  const text = fs.readFileSync(file, "utf8");
  const rel = path.relative(root, file).replaceAll("\\", "/");
  for (const { tag, line } of formTags(text)) {
    total += 1;
    if (!/\smethod\s*=/.test(tag)) offenders.push(`${rel}:${line} — ${tag.replace(/\s+/g, " ").slice(0, 110)}`);
  }
}

// A parser that found nothing would pass this test forever.
assert.ok(total >= 16, `expected to find the application's forms, found ${total}`);

assert.deepEqual(
  offenders,
  [],
  `${offenders.length} form(s) submit as a GET before hydration, putting their fields in the URL.\n` +
  `Add method="post" to each:\n  ${offenders.join("\n  ")}\n`,
);

console.log(`form method: PASS (${total} forms, all declare a method)`);
