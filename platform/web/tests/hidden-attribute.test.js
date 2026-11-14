/* The `hidden` attribute must actually hide.
 *
 * An author `display` beats the user agent's `[hidden] { display: none }`
 * regardless of specificity, so `hidden={!open}` on an element whose class sets
 * `display: flex` is a conditional that reads as working and does nothing.
 * It happened twice: .msg-feedback was caught and given a [hidden] guard,
 * .days-continue-wrap was not, and "Continue to Food Diary" sat permanently
 * under the empty state beside its own "Go to Food Diary". */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");

function walk(dir, ext, found = []) {
  if (!fs.existsSync(dir)) return found;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, ext, found);
    else if (entry.name.endsWith(ext)) found.push(full);
  }
  return found;
}

const styles = walk(path.join(root, "public"), ".css").map((f) => fs.readFileSync(f, "utf8")).join("\n");

/* A class is "forced visible" when some rule sets a display other than none on
 * the class itself — not on a descendant (`.day-field label`) and not on the
 * hidden state (`.msg-feedback[hidden]`), which are the two correct shapes. */
const forced = new Map();
const guarded = new Set();
for (const [, selector, body] of styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  const display = body.match(/(?<![-\w])display\s*:\s*([a-z-]+)/);
  if (!display) continue;
  for (const part of selector.split(",")) {
    const target = part.trim().split(/\s+|>/).filter(Boolean).pop();
    if (!target) continue;
    const cls = target.match(/^\.([A-Za-z0-9_-]+)/);
    if (!cls) continue;
    if (target.includes("[hidden]")) { if (display[1] === "none") guarded.add(cls[1]); continue; }
    if (display[1] !== "none") forced.set(cls[1], `${part.trim().slice(0, 60)} { display: ${display[1]} }`);
  }
}
assert.ok(forced.size > 20, `expected to parse the stylesheets, found ${forced.size} display rules`);

const broken = [];
for (const file of [...walk(path.join(root, "app"), ".tsx"), ...walk(path.join(root, "components"), ".tsx")]) {
  const rel = path.relative(root, file).replaceAll("\\", "/");
  fs.readFileSync(file, "utf8").split("\n").forEach((line, i) => {
    if (!/(?<!aria-)hidden=\{/.test(line)) return;
    const classes = line.match(/className="([^"]+)"/);
    if (!classes) return;
    for (const cls of classes[1].split(/\s+/)) {
      if (forced.has(cls) && !guarded.has(cls)) {
        broken.push(`${rel}:${i + 1}  hidden={…} on .${cls}, but CSS says  ${forced.get(cls)}  — add .${cls}[hidden] { display: none; }`);
      }
    }
  });
}

assert.deepEqual(broken, [], `\n${broken.join("\n")}\n`);
console.log(`hidden attribute: PASS (${forced.size} display rules, ${guarded.size} guarded)`);
