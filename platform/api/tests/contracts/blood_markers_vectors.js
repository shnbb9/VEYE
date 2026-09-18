"use strict";

/* One JSON-in/JSON-out bridge to the approved consumer Blood Test Markers
 * behaviour. Two sources, neither modified:
 *   - build/js/veye-calculations.js  -> VeyeCalculations.blood (ratios + goal flags)
 *   - build/dashboard.html           -> classifyMarker() + bloodDoseTier(), read
 *     out of the inline script so the bands and the EPA/DHA suggestion are
 *     compared against the exact functions the prototype runs. */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const BUILD = path.resolve(__dirname, "../../../../build");
const engineSource = fs.readFileSync(path.join(BUILD, "js/veye-calculations.js"), "utf8");
const dashboardSource = fs.readFileSync(path.join(BUILD, "dashboard.html"), "utf8");

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`${name} not found in dashboard.html`);
  let depth = 0, i = source.indexOf("{", start);
  for (; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) break;
  }
  return source.slice(start, i + 1);
}

const sandbox = {
  window: {},
  location: { protocol: "http:", hash: "" },
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
};
vm.runInNewContext(engineSource, sandbox);
vm.runInNewContext(
  extractFunction(dashboardSource, "classifyMarker") + "\n" + extractFunction(dashboardSource, "bloodDoseTier") +
  "\nthis.classifyMarker = classifyMarker; this.bloodDoseTier = bloodDoseTier;",
  sandbox,
);
const blood = sandbox.window.VeyeCalculations.blood;

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  const vectors = JSON.parse(input).vectors;
  const results = vectors.map((vector) => {
    const v = vector.input;
    const tg_hdl = blood.tgHdl(v.tg, v.hdl);
    const homa_ir = blood.homaIr(v.insulin, v.glucose);
    const calculated = blood.aaEpa(v.aa, v.epa);
    const aa_epa = calculated !== null ? calculated : (v.aa_epa ?? null);
    const values = { tg_hdl, aa_epa, hba1c: v.hba1c ?? null, homa_ir };
    const in_range = {};
    const classification = {};
    for (const key of Object.keys(values)) {
      in_range[key] = values[key] === null ? null : blood.GOALS[key].test(values[key]);
      // the dashboard names HOMA-IR `homa` in its band table
      classification[key] = values[key] === null ? null : sandbox.classifyMarker(key === "homa_ir" ? "homa" : key, values[key]);
    }
    const dose = sandbox.bloodDoseTier({ tg_hdl, aa_epa, hba1c: values.hba1c, homa: homa_ir });
    return {
      id: vector.id,
      tg_hdl, homa_ir, aa_epa,
      aa_epa_source: calculated !== null ? "calculated" : (v.aa_epa != null ? "entered" : null),
      in_range, classification,
      recommendation: { state: dose.state, epa_dha_dose: dose.epa ?? null, lead: dose.lead ?? null },
    };
  });
  process.stdout.write(JSON.stringify({ results }));
});
