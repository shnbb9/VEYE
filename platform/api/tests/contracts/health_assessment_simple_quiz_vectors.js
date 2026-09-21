"use strict";

/* One JSON-in/JSON-out bridge to the approved consumer Health Assessment and
 * Simple Quiz behaviour. Two sources, neither modified:
 *   - build/js/veye-calculations.js  -> VeyeCalculations.hsr (bands, wording,
 *     EPA/DHA dosage) and VeyeCalculations.simpleQuiz (the count)
 *   - build/dashboard.html           -> ASSESSMENT_QUESTIONS (labels/choices),
 *     SIMPLE_QUIZ_QUESTIONS (labels) and the tone bucket mapping inside
 *     submitAssessment(), read out of the inline script so the API is compared
 *     against the exact text and functions the prototype runs. */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const BUILD = path.resolve(__dirname, "../../../../build");
const engineSource = fs.readFileSync(path.join(BUILD, "js/veye-calculations.js"), "utf8");
const dashboardSource = fs.readFileSync(path.join(BUILD, "dashboard.html"), "utf8");

function extractConst(source, name) {
  const start = source.indexOf(`const ${name} = [`);
  if (start < 0) throw new Error(`${name} not found in dashboard.html`);
  let depth = 0, i = source.indexOf("[", start);
  for (; i < source.length; i++) {
    if (source[i] === "[") depth++;
    else if (source[i] === "]" && --depth === 0) break;
  }
  return source.slice(start, i + 1) + ";";
}

const sandbox = {
  window: {},
  location: { protocol: "http:", hash: "" },
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
};
vm.runInNewContext(engineSource, sandbox);
vm.runInNewContext(
  extractConst(dashboardSource, "ASSESSMENT_QUESTIONS") + "\n" + extractConst(dashboardSource, "SIMPLE_QUIZ_QUESTIONS") +
  "\nthis.ASSESSMENT_QUESTIONS = ASSESSMENT_QUESTIONS; this.SIMPLE_QUIZ_QUESTIONS = SIMPLE_QUIZ_QUESTIONS;",
  sandbox,
);
const hsr = sandbox.window.VeyeCalculations.hsr;
const simpleQuiz = sandbox.window.VeyeCalculations.simpleQuiz;

/* The prototype's tone mapping (submitAssessment in dashboard.html). */
function tone(bucket) {
  return bucket === "verylow" || bucket === "low" ? "good" : bucket === "moderate" ? "moderate" : bucket === "high" ? "elevated" : "significant";
}

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  const request = JSON.parse(input);
  const out = {
    assessment_questions: sandbox.ASSESSMENT_QUESTIONS,
    simple_quiz_questions: sandbox.SIMPLE_QUIZ_QUESTIONS,
    neurological: hsr.NEUROLOGICAL,
    assessment: (request.assessment_totals || []).map((total) => {
      const band = hsr.interpret(total);
      const dose = hsr.dosage(total);
      return { total, bucket: band.bucket, status: band.status, interpretation: band.desc, tone: tone(band.bucket),
               epa_dha_dose: dose.epa, polyphenol_lines: dose.polyLines };
    }),
    simple_quiz: (request.simple_quiz_answers || []).map((answers) => {
      const s = simpleQuiz.summarize(answers.map((a) => (a === "yes" ? 1 : 0)));
      return { yes_count: s.yesCount, no_count: s.noCount, summary: s.summary, progress_note: s.progressNote };
    }),
  };
  process.stdout.write(JSON.stringify(out));
});
