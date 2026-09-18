"use strict";

/* One JSON-in/JSON-out bridge to the approved consumer Body Composition engine. */
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
const compose = sandbox.window.VeyeCalculations.bodyFat.compose;

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  const vectors = JSON.parse(input).vectors;
  const results = vectors.map((vector) => {
    const result = compose(vector.input);
    return {
      id: vector.id,
      ok: result.ok,
      sex: result.sex,
      reason: result.reason || null,
      bmi: result.bmi ?? null,
      body_fat_percent: result.bodyFatPercent ?? null,
      fat_mass_lb: result.fatMassLb ?? null,
      lean_mass_lb: result.leanMassLb ?? null,
    };
  });
  process.stdout.write(JSON.stringify({ results }));
});
