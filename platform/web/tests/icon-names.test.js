/* Every literal icon name must resolve to a glyph.
 *
 * Both icon components answer an unknown name with null, so a name that does
 * not exist renders an empty circle with no error anywhere: `Icon name="mail"`
 * sat on Member 360 -> Account for as long as that row has existed. Nothing
 * failed, because nothing was asked. This asks. */

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

// The admin console's Icon is a switch; the member rail's NavIcon is a record.
const adminNames = new Set(
  [...fs.readFileSync(path.join(root, "components", "admin", "admin-chrome.tsx"), "utf8")
      .matchAll(/case "([a-z0-9-]+)": return <svg/g)].map((m) => m[1]),
);
const navSource = fs.readFileSync(path.join(root, "components", "member", "nav-icons.tsx"), "utf8");
const navNames = new Set([...navSource.matchAll(/^ {2}"?([a-z0-9-]+)"?: \(/gm)].map((m) => m[1]));

assert.ok(adminNames.size > 20, `expected the admin icon switch to be found, got ${adminNames.size}`);
assert.ok(navNames.size > 10, `expected the member icon record to be found, got ${navNames.size}`);

const missing = [];
for (const file of files) {
  const text = fs.readFileSync(file, "utf8");
  const rel = path.relative(root, file).replaceAll("\\", "/");
  for (const [, name] of text.matchAll(/<Icon name="([a-z0-9-]+)"/g)) {
    if (!adminNames.has(name)) missing.push(`${rel}: <Icon name="${name}"> has no glyph`);
  }
  for (const [, name] of text.matchAll(/<NavIcon name="([a-z0-9-]+)"/g)) {
    if (!navNames.has(name)) missing.push(`${rel}: <NavIcon name="${name}"> has no glyph`);
  }
}

assert.deepEqual(missing, [], `\n${missing.join("\n")}\n`);
console.log(`icon names: PASS (${adminNames.size} admin glyphs, ${navNames.size} member glyphs, ${files.length} files scanned)`);
