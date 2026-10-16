"use strict";

/* JSON-in/JSON-out bridge to the approved Food Diary macro estimate: the
 * prototype's own FDX_FOODS table and fdxEstimate() are read out of
 * build/dashboard.html (unmodified) and run here, so the API's port is
 * compared against the exact code the prototype runs. */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const BUILD = path.resolve(__dirname, "../../../../build");
const dashboardSource = fs.readFileSync(path.join(BUILD, "dashboard.html"), "utf8");

function extractBlock(source, startToken, open, close) {
  const start = source.indexOf(startToken);
  if (start < 0) throw new Error(`${startToken} not found in dashboard.html`);
  let depth = 0, i = source.indexOf(open, start);
  for (; i < source.length; i++) {
    if (source[i] === open) depth++;
    else if (source[i] === close && --depth === 0) break;
  }
  return source.slice(start, i + 1);
}

const sandbox = {};
vm.runInNewContext(
  extractBlock(dashboardSource, "const FDX_FOODS = [", "[", "]") + ";\n" +
  extractBlock(dashboardSource, "function fdxEstimate(", "{", "}") +
  "\nthis.fdxEstimate = fdxEstimate;",
  sandbox,
);

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  const texts = JSON.parse(input).texts;
  process.stdout.write(JSON.stringify({ results: texts.map((t) => sandbox.fdxEstimate(t)) }));
});
