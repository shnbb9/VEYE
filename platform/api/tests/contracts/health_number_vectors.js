"use strict";

/* One JSON-in/JSON-out bridge to the approved consumer engine.  It is called
 * once per vector set by the Python contract test; it never changes build/. */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const source = fs.readFileSync(
  path.resolve(__dirname, "../../../../build/js/veye-calculations.js"),
  "utf8",
);
const sandbox = {
  window: {},
  location: { protocol: "http:", hash: "" },
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
};
vm.runInNewContext(source, sandbox);
const healthNumber = sandbox.window.VeyeCalculations.healthNumber;

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  const vectors = JSON.parse(input).vectors;
  const results = vectors.map((vector) => {
    const points = healthNumber.points(vector.answers);
    const raw_score = healthNumber.raw(vector.answers);
    const displayed_score = healthNumber.score(vector.answers);
    const interpretation = healthNumber.interpret(displayed_score, vector.answers);
    return {
      id: vector.id,
      points,
      raw_score,
      displayed_score,
      bucket: interpretation.bucket,
      category: interpretation.category,
      interpretation: interpretation.desc,
    };
  });
  process.stdout.write(JSON.stringify({ results }));
});
