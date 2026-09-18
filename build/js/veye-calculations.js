/* ============================================================================
   VEYE — shared calculation engine
   ----------------------------------------------------------------------------
   ONE implementation of every scored instrument, used by BOTH the onboarding
   quiz (js/quiz.js) and the dashboard (dashboard.html). No modules, no build
   step, no dependencies — a plain global so file:// pages can share it.

   CANONICAL SOURCES:
     Health Number weights ....... Health Numbers Metrics Nile site.xlsx
                                   (client update 20 Aug 2026 — supersedes
                                   HealthNumbers.xlsx; the only numeric change
                                   is Q5: yes 0.5 / no 0)
     Health Number bands/wording . Nile Site Health Number Interpretation and
                                   Formula.docx (client update 20 Aug 2026 —
                                   resolves the floor to 1, changes the 0-1
                                   band to "very good health" and the 6.5-10
                                   opening to "You show signs of")
     Older references (veye copy/veye copy/VeyeDocuments/, read-only):
     Body-fat method ............. BMI formula.docx  (Appendix B, "Thin So Fast")
     Body-fat inputs by sex ...... Body Fat Analysis .docx
     Health Status Report ........ Health Status Report.docx
     Simple Quiz ................. Simple Quiz.docx
     Blood markers ............... Dated Blood Markers tracking.pdf

   Nothing here is invented. Where a client source does not define a rule, the
   rule is absent rather than approximated — see NOT-SOURCED notes inline.
   ========================================================================== */
(function (root) {
  'use strict';

  /* =========================================================================
     HEALTH NUMBER
     Canonical: HealthNumbers.xlsx. 12 questions; Q1, Q11 and Q12 score 0 and
     exist for personalisation only. Lower is healthier (1 = great, 10 = poor).
     ====================================================================== */

  // Q2 — "Have you tried other food plans?" (XLSX R13-R23)
  var PLAN_SCORES = {
    'Weight Watchers': 0.5,
    'Noom': 0.5,
    'Jenny Craig': 0.5,
    'The Mediterranean Diet': 0.5,
    'DASH': 0.5,
    'ATKINS': 1.5,
    'Keto': 1.5,
    'Intermittent Fasting': 0.5,
    'Fasting': 0.5,
    'Other': 0.5,
    'No other plans': 0
  };

  // Q3 — activity level (XLSX R25-R28)
  var ACTIVITY_SCORES = {
    'None': 1,
    'Light (I work, I walk some)': 0,
    'Moderate (I exercise 1-3 times a week)': -1,
    'Heavy (I exercise 3x+ times per week)': -1
  };

  // Q1 goals (XLSX R6-R11) and Q2 plans (R13-R23) — the option lists the two
  // screens must offer. Q1 scores 0; Q2 scores come from PLAN_SCORES above.
  var GOAL_OPTIONS = ['Manage Current Chronic Diseases', 'Prevent Future Disease',
    'Live a Healthier Lifestyle', 'Better Mental Focus', 'Lose Body Fat'];
  var PLAN_OPTIONS = ['Weight Watchers', 'Noom', 'Jenny Craig', 'The Mediterranean Diet',
    'DASH', 'ATKINS', 'Keto', 'Intermittent Fasting', 'Fasting'];
  var ACTIVITY_OPTIONS = ['None', 'Light (I work, I walk some)',
    'Moderate (I exercise 1-3 times a week)', 'Heavy (I exercise 3x+ times per week)'];

  // Q11 dietary preference and Q12 referral source: 0 points, listed so the
  // onboarding and dashboard offer the same client-supplied options. (XLSX R42
  // reads "no read meat" — a typo for "red meat" — corrected here.)
  var DIET_OPTIONS = ['Vegetarian', 'Vegan', 'Raw food', 'Fish and no meat',
    'Fish/chicken/turkey and no red meat', 'Gluten free', 'Dairy free', 'No preference'];
  // Cara's Start the Process review replaces Twitter with Facebook and adds a
  // clinician-referral choice. Keep this list shared by onboarding and retakes.
  var SOURCE_OPTIONS = ['Instagram', 'Facebook', 'On-line search', 'Friends or Family', 'Recommended by a doctor'];

  /** Option labels ARE the scoring keys, so a stray space or a capitalisation
   *  drift between two screens would silently score 0 (this happened: the
   *  dashboard carried "3x+" while this table carried "3x +", so Heavy scored 0
   *  instead of -1). Look the label up exactly first, then case- and
   *  whitespace-insensitively. One table, two ways in. */
  function normLabel(s) { return String(s == null ? '' : s).replace(/\s+/g, '').toLowerCase(); }
  function lookupScore(table, label) {
    if (Object.prototype.hasOwnProperty.call(table, label)) return table[label];
    var want = normLabel(label);
    if (!want) return undefined;
    var keys = Object.keys(table);
    for (var i = 0; i < keys.length; i++) if (normLabel(keys[i]) === want) return table[keys[i]];
    return undefined;
  }

  // Conceptual grouping for the interpretation blurb.
  // CONFIRMED by Nile Site Health Number Interpretation and Formula.docx
  // (20 Aug 2026): Lifestyle = Q3,Q4,Q8,Q9,Q10 · Food = Q2,Q5,Q6,Q7.
  // The Interpretation docx ALSO carries a stale 13-question numbering
  // ("Lifestyle 5,6,10,11 / Food 2,4,7,8,13") which does not fit the canonical
  // 12-question XLSX. That stale numbering is deliberately NOT implemented.
  var LIFESTYLE_KEYS = ['activity', 'meditate', 'sleepEnough', 'sleepWell', 'sleepHours'];
  var FOOD_KEYS = ['plans', 'tired', 'gainWeight', 'abdomenWeight'];

  function yn(v) {
    if (v === true) return 'yes';
    if (v === false) return 'no';
    return typeof v === 'string' ? v.trim().toLowerCase() : null;
  }

  /** Per-question points. Returns a map so callers can show a breakdown and so
   *  the Lifestyle/Food split is derived from the same numbers as the total. */
  function healthNumberPoints(a) {
    a = a || {};
    var p = {};

    // Q1 goals — 0 points by design.
    p.goals = 0;

    // Q2 plans (multi-select). "No other plans" is exclusive and scores 0.
    var plans = a.plans || [];
    if (!Array.isArray(plans)) plans = [plans];
    var sum = 0;
    if (plans.indexOf('No other plans') === -1) {
      plans.forEach(function (label) {
        var s = lookupScore(PLAN_SCORES, label);
        if (s !== undefined) sum += s;
        else if (label) sum += PLAN_SCORES['Other'];   // free-text write-in
      });
    }
    p.plans = sum;

    // Q3 activity
    var act = lookupScore(ACTIVITY_SCORES, a.activity);
    p.activity = act === undefined ? 0 : act;

    // Q4 meditation — XLSX says yes -0.5 / no +0.5. (The older Start-the-Process
    // PDF says yes = 0; the XLSX wins per the source-of-truth order.)
    p.meditate = yn(a.meditate) === 'yes' ? -0.5 : yn(a.meditate) === 'no' ? 0.5 : 0;

    // Q5 tired / poor mental focus — Health Numbers Metrics Nile site.xlsx
    // (20 Aug 2026): yes 0.5 / no 0. The earlier HealthNumbers.xlsx carried
    // 1.5; the newer client sheet supersedes it.
    p.tired = yn(a.tired) === 'yes' ? 0.5 : 0;

    // Q6 gain weight quickly
    p.gainWeight = yn(a.gainWeight) === 'yes' ? 1 : 0;

    // Q7 excess weight around the abdomen
    p.abdomenWeight = yn(a.abdomenWeight) === 'yes' ? 0.5 : 0;

    // Q8/Q9 sleep — accepts the legacy onboarding shape state.sleep{enough,well,hours}
    var sleep = a.sleep || {};
    var enough = yn(a.sleepEnough !== undefined ? a.sleepEnough : sleep.enough);
    var well = yn(a.sleepWell !== undefined ? a.sleepWell : sleep.well);
    p.sleepEnough = enough === 'no' ? 1.5 : 0;
    p.sleepWell = well === 'no' ? 1.5 : 0;

    // Q10 hours: >9 = 1, 5-9 = 0, <5 = 1
    var hrsRaw = a.sleepHours !== undefined ? a.sleepHours : sleep.hours;
    var hrs = parseFloat(hrsRaw);
    p.sleepHours = (!isNaN(hrs) && (hrs > 9 || hrs < 5)) ? 1 : 0;

    // Q11 diet, Q12 referral — 0 points.
    p.diet = 0;
    p.source = 0;
    return p;
  }

  function sumPoints(p, keys) {
    return keys.reduce(function (t, k) { return t + (p[k] || 0); }, 0);
  }

  /** Raw total before clamping — exposed for tests and for the clarification
   *  question about whether the floor should be 0 or 1. */
  function healthNumberRaw(a) {
    var p = healthNumberPoints(a);
    return Object.keys(p).reduce(function (t, k) { return t + p[k]; }, 0);
  }

  /** Displayed Health Number.
   *  RESOLVED by Nile Site Health Number Interpretation and Formula.docx
   *  (20 Aug 2026): "If everything is a 0 and they exercise moderate to heavy,
   *  they will get a -1 and this defaults to 1." The published floor is 1;
   *  raw() still exposes the unclamped total for tests and the trend note.
   *  Ceiling stays 10 ("the worst of everything, then their score is 10"). */
  var HN_MIN = 1, HN_MAX = 10;
  function healthNumberScore(a) {
    var n = healthNumberRaw(a);
    if (n < HN_MIN) n = HN_MIN;
    if (n > HN_MAX) n = HN_MAX;
    return Math.round(n * 2) / 2;      // client weights are all multiples of 0.5
  }

  // Bucket wording is verbatim from Nile Site Health Number Interpretation and
  // Formula.docx (20 Aug 2026).
  // These are PLAIN TEXT: callers set them with textContent, so an HTML entity
  // would be shown literally ("&mdash;"). Use real Unicode punctuation here.
  var HN_TEXT = {
    good: 'You are in very good health — join and learn more about optimizing your health, preventing disease, and slowing the aging process.',
    rel_lifestyle: 'You are in relatively good health, and some lifestyle changes will help you optimize your health, prevent disease, and slow the aging process.',
    rel_food: 'You are in relatively good health, and some changes to your dietary program will help you optimize your health, prevent disease, and slow the aging process.',
    rel_mixed: 'You are in relatively good health, and some lifestyle changes and adjustments to your dietary program will help you optimize your health, prevent disease, and slow the aging process.',
    mod_mixed: 'Although you are in moderately good health, incorporating better food choices and implementing some lifestyle changes will help you optimize your health, prevent disease, and slow the aging process.',
    mod_lifestyle: 'Although you seem to have a working diet plan, some aspects of your lifestyle are putting your health at risk. Incorporating better food choices and implementing some lifestyle changes will help you optimize your health, prevent disease, and slow the aging process.',
    mod_food: 'Although you have a healthy lifestyle, your food choices are putting your health at risk. Incorporating a better diet plan will help you optimize your health, prevent disease, and slow the aging process.',
    high: 'You show signs of insulin resistance, which will lead to chronic disease or a worsening of established chronic disease. Join the Program and we can help you make changes so you feel better and live longer.'
  };

  /** Category for the wording bands (1.5-3.5 and 4-6).
   *  Client rule (progress-review answers, 25 Aug 2026): compare how many
   *  Lifestyle questions (3,4,8,9,10) and how many Food questions (2,5,6,7)
   *  scored positive. Whichever side has more high answers picks the wording;
   *  a TIE is Mixed. From 6.5 to 10 the insulin-resistance wording applies to
   *  ANY combination (enforced in interpretHealthNumber).
   *  (The earlier "2 positive Lifestyle + 3 positive Food = Mixed" special
   *  case from the interpretation docx is superseded by this direction.) */
  function classify(points) {
    var lifePts = sumPoints(points, LIFESTYLE_KEYS);
    var foodPts = sumPoints(points, FOOD_KEYS);
    var lifeCount = LIFESTYLE_KEYS.filter(function (k) { return (points[k] || 0) > 0; }).length;
    var foodCount = FOOD_KEYS.filter(function (k) { return (points[k] || 0) > 0; }).length;

    var category, rule;
    if (lifeCount > foodCount) {
      category = 'lifestyle'; rule = 'more high Lifestyle answers (' + lifeCount + ' vs ' + foodCount + ')';
    } else if (foodCount > lifeCount) {
      category = 'food'; rule = 'more high Food answers (' + foodCount + ' vs ' + lifeCount + ')';
    } else {
      category = 'mixed'; rule = 'tied high answers (' + lifeCount + ' each) -> Mixed';
    }
    return { category: category, rule: rule, lifestylePoints: lifePts, foodPoints: foodPts,
             lifestyleCount: lifeCount, foodCount: foodCount };
  }

  function interpretHealthNumber(number, answers) {
    var points = healthNumberPoints(answers || {});
    var c = classify(points);
    var bucket, status, desc;

    if (number <= 1) {
      bucket = 'good'; status = 'Good Health'; desc = HN_TEXT.good;
    } else if (number <= 3.5) {
      bucket = 'relative'; status = 'Relatively Good Health';
      desc = c.category === 'lifestyle' ? HN_TEXT.rel_lifestyle
           : c.category === 'food' ? HN_TEXT.rel_food : HN_TEXT.rel_mixed;
    } else if (number <= 6) {
      bucket = 'moderate'; status = 'Moderately Good Health';
      desc = c.category === 'lifestyle' ? HN_TEXT.mod_lifestyle
           : c.category === 'food' ? HN_TEXT.mod_food : HN_TEXT.mod_mixed;
    } else {
      bucket = 'high'; status = 'Insulin Resistance Risk'; desc = HN_TEXT.high;
    }

    // NOT-SOURCED: the Health Number interpretation document defines no EPA/DHA
    // or polyphenol dosage. The previous build attached one by score; it has been
    // removed. Dosage exists only where a client source defines it (HSR by score,
    // blood markers by condition).
    return {
      number: number, status: status, desc: desc, bucket: bucket,
      category: c.category, categoryRule: c.rule,
      lifestylePoints: c.lifestylePoints, foodPoints: c.foodPoints,
      points: points
    };
  }

  /* =========================================================================
     BODY FAT — BMI formula.docx (Appendix B of "Thin So Fast", Dr M. Eades)
     Recovered and cross-verified against the official Zone Living calculator
     referenced by that same document. Every value below is a client-table
     value; nothing is interpolated or regressed.
     ====================================================================== */

  // TABLE 1 — Conversion constants for females. Hips -> A, Abdomen -> B, Height -> C.
  var F_HIPS_A = {30:33.48,30.5:33.83,31:34.87,31.5:35.22,32:36.27,32.5:36.62,33:37.67,33.5:38.02,34:39.06,34.5:39.41,35:40.46,35.5:40.81,36:41.86,36.5:42.21,37:43.25,37.5:43.6,38:44.65,38.5:45.32,39:46.05,39.5:46.4,40:47.44,40.5:47.79,41:48.84,41.5:49.19,42:50.24,42.5:50.59,43:51.64,43.5:51.99,44:53.03,44.5:53.41,45:54.53,45.5:54.86,46:55.83,46.5:56.18,47:57.22,47.5:57.57,48:58.62,48.5:58.97,49:60.02,49.5:60.37,50:61.42,50.5:61.77,51:62.81,51.5:63.16,52:64.21,52.5:64.56,53:65.61,53.5:65.96,54:67,54.5:67.35,55:68.4,55.5:68.75,56:69.8,56.5:70.15,57:71.19,57.5:71.54,58:72.59,58.5:72.94,59:73.99,59.5:74.34,60:75.39};
  var F_ABDOMEN_B = {20:14.22,20.5:14.4,21:14.93,21.5:15.11,22:15.64,22.5:15.82,23:16.35,23.5:16.53,24:17.06,24.5:17.24,25:17.78,25.5:17.96,26:18.49,26.5:18.67,27:19.2,27.5:19.38,28:19.91,28.5:20.27,29:20.62,29.5:20.8,30:21.33,30.5:21.51,31:22.04,31.5:22.22,32:22.75,32.5:22.93,33:23.46,33.5:23.64,34:24.18,34.5:24.36,35:24.89,35.5:25.07,36:25.6,36.5:25.78,37:26.31,37.5:26.49,38:27.02,38.5:27.2,39:27.73,39.5:27.91,40:28.44,40.5:28.62,41:29.15,41.5:29.33,42:29.87,42.5:30.05,43:30.58,43.5:30.76,44:31.29,44.5:31.47,45:32,45.5:32.18,46:32.71,46.5:32.89,47:33.42,47.5:33.6,48:34.13,48.5:34.31,49:34.84,49.5:35.02,50:35.56};
  var F_HEIGHT_C = {55:33.52,55.5:33.67,56:34.13,56.5:34.28,57:34.74,57.5:34.89,58:35.35,58.5:35.5,59:35.96,59.5:36.11,60:36.57,60.5:36.72,61:37.18,61.5:37.33,62:37.79,62.5:37.94,63:38.4,63.5:38.7,64:39.01,64.5:39.16,65:39.62,65.5:39.77,66:40.23,66.5:40.38,67:40.84,67.5:40.99,68:41.45,68.5:41.6,69:42.06,69.5:42.21,70:42.67,70.5:42.82,71:43.28,71.5:43.43,72:43.89,72.5:44.04,73:44.5,73.5:44.65,74:45.11,74.5:45.26,75:45.72,75.5:45.87,76:46.32};

  // TABLE 2 — Male percentage body fat. Rows: weight 120-300 lb by 5.
  // Columns: waist minus wrist, 22-50 in, by 0.5. 0 = blank in the client table
  // (an unsupported combination) and must NOT be filled in.
  var M_COLS = [22,22.5,23,23.5,24,24.5,25,25.5,26,26.5,27,27.5,28,28.5,29,29.5,30,30.5,31,31.5,32,32.5,33,33.5,34,34.5,35,35.5,36,36.5,37,37.5,38,38.5,39,39.5,40,40.5,41,41.5,42,42.5,43,43.5,44,44.5,45,45.5,46,46.5,47,47.5,48,48.5,49,49.5,50];
  var M_ROWS = {
    120:[4,6,8,10,12,14,16,18,20,21,23,25,27,29,31,33,35,37,39,41,43,45,47,49,50,52,54,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    125:[4,6,7,9,11,13,15,17,19,20,22,24,26,28,30,32,33,35,37,39,41,43,45,46,48,50,52,54,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    130:[3,5,7,9,11,12,14,16,18,20,21,23,25,27,28,30,32,34,36,37,39,41,43,44,46,48,50,52,53,55,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    135:[3,5,7,8,10,12,13,15,17,19,20,22,24,26,27,29,31,32,34,36,38,39,41,43,44,46,48,50,51,53,55,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    140:[3,5,6,8,10,11,13,15,16,18,19,21,23,24,26,28,29,31,33,34,36,38,39,41,43,44,46,48,49,51,53,54,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    145:[0,4,6,7,9,11,12,14,15,17,19,20,22,23,25,27,28,30,31,33,35,36,38,39,41,43,44,46,47,49,51,52,54,55,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    150:[0,4,6,7,9,10,12,13,15,16,18,19,21,23,24,26,27,29,30,32,33,35,36,38,40,41,43,44,46,47,49,50,52,53,55,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    155:[0,4,5,6,8,10,11,13,14,16,17,19,20,22,23,25,26,28,29,31,32,34,35,37,38,40,41,43,44,46,47,49,50,52,53,55,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    160:[0,4,5,6,8,9,11,12,14,15,17,18,19,21,22,24,25,27,28,30,31,33,34,35,37,38,40,41,43,44,46,47,48,50,51,53,54,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    165:[0,3,5,6,8,9,10,12,13,15,16,17,19,20,22,23,24,26,27,29,30,31,33,34,36,37,38,40,41,43,44,45,47,48,50,51,52,54,55,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    170:[0,3,4,6,7,9,10,11,13,14,15,17,18,19,21,22,24,25,26,28,29,30,32,33,34,36,37,39,40,41,43,44,45,47,48,49,51,52,54,55,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    175:[0,0,4,6,7,8,10,11,12,13,15,16,17,19,20,21,23,24,25,27,28,29,31,32,33,35,36,37,39,40,41,43,44,45,47,48,49,51,52,53,55,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    180:[0,0,4,5,7,8,9,10,12,13,14,16,17,18,19,21,22,23,25,26,27,28,30,31,32,34,35,36,37,39,40,41,43,44,45,47,48,49,50,52,53,54,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    185:[0,0,4,5,6,8,9,10,11,13,14,15,16,18,19,20,21,23,24,25,26,28,29,30,31,33,34,35,36,38,39,40,41,43,44,45,46,48,49,50,51,53,54,55,0,0,0,0,0,0,0,0,0,0,0,0,0],
    190:[0,0,4,5,6,7,8,10,11,12,13,15,16,17,18,19,21,22,23,24,26,27,28,29,30,32,33,34,35,37,38,39,40,41,43,44,45,46,48,49,50,51,52,54,55,0,0,0,0,0,0,0,0,0,0,0,0],
    195:[0,0,3,5,6,7,8,9,11,12,13,14,15,16,18,19,20,21,22,24,25,26,27,28,30,31,32,33,34,36,37,38,39,40,41,43,44,45,46,47,49,50,51,52,53,55,0,0,0,0,0,0,0,0,0,0,0],
    200:[0,0,3,4,6,7,8,9,10,11,12,14,15,16,17,18,19,21,22,23,24,25,26,28,29,30,31,32,33,35,36,37,38,39,40,41,43,44,45,46,47,48,50,51,52,53,54,55,0,0,0,0,0,0,0,0,0],
    205:[0,0,0,4,5,6,8,9,10,11,12,13,14,15,17,18,19,20,21,22,23,25,26,27,28,29,30,31,32,34,35,36,37,38,39,40,41,43,44,45,46,47,48,49,51,52,53,54,55,0,0,0,0,0,0,0,0],
    210:[0,0,0,4,5,6,7,8,9,11,12,13,14,15,16,17,18,19,21,22,23,24,25,26,27,28,29,30,32,33,34,35,36,37,38,39,40,42,43,44,45,46,47,48,49,50,51,53,54,55,0,0,0,0,0,0,0],
    215:[0,0,0,4,5,6,7,8,9,10,11,12,13,15,16,17,18,19,20,21,22,23,24,25,26,28,29,30,31,32,33,34,35,36,37,38,39,40,42,43,44,45,46,47,48,49,50,51,52,53,54,55,0,0,0,0,0],
    220:[0,0,0,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,0,0,0,0],
    225:[0,0,0,3,4,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,31,31,32,33,34,35,36,37,38,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,0,0,0],
    230:[0,0,0,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,30,31,32,33,34,35,36,37,38,39,40,41,42,44,44,45,46,47,48,49,50,51,52,53,54,55,0,0],
    235:[0,0,0,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,51,52,53,54,55],
    240:[0,0,0,0,4,5,6,7,8,9,10,11,12,13,14,15,16,17,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,46,47,48,49,50,51,52,53,54],
    245:[0,0,0,0,4,5,6,7,8,9,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,44,45,46,47,48,49,50,51,52,53],
    250:[0,0,0,0,4,5,6,6,7,8,9,10,11,12,13,14,15,16,17,18,18,19,20,21,22,23,24,25,26,27,28,29,30,31,31,32,33,34,35,36,37,38,39,40,41,42,43,44,44,45,46,47,48,49,50,51,52],
    255:[0,0,0,0,3,4,5,6,7,8,9,10,11,12,13,14,14,15,16,17,18,19,20,21,22,23,24,24,25,27,27,28,29,30,31,32,33,34,34,35,36,37,38,39,40,41,42,43,44,44,45,46,47,48,49,50,51],
    260:[0,0,0,0,3,4,5,6,7,8,9,10,10,11,12,13,14,15,16,17,18,19,19,20,21,22,23,24,25,26,27,27,28,29,30,31,32,33,34,35,35,36,37,38,39,40,41,42,43,43,44,45,46,47,48,49,50],
    265:[0,0,0,0,0,4,5,6,7,8,8,9,10,11,12,13,14,15,15,16,17,18,19,20,21,22,22,23,24,25,26,27,28,29,29,30,31,32,33,34,35,36,36,37,38,39,40,41,42,43,43,44,45,46,47,48,49],
    270:[0,0,0,0,0,4,5,6,7,7,8,9,10,11,12,13,13,14,15,16,17,18,19,19,20,21,22,23,24,25,25,26,27,28,29,30,31,31,32,33,34,35,36,37,37,38,39,40,41,42,43,43,44,45,46,47,48],
    275:[0,0,0,0,0,4,5,5,6,7,8,9,10,11,11,12,13,14,15,16,16,17,18,19,20,21,22,22,23,24,25,26,27,27,28,29,30,31,32,32,33,34,35,36,37,38,38,39,40,41,42,43,43,44,45,46,47],
    280:[0,0,0,0,0,4,4,5,6,7,8,9,9,10,11,12,13,14,14,15,16,17,18,19,19,20,21,22,23,24,24,25,26,27,28,29,29,30,31,32,33,33,34,35,36,37,38,38,39,40,41,42,43,43,44,45,46],
    285:[0,0,0,0,0,4,4,5,6,7,8,8,9,10,11,12,12,13,14,15,16,17,17,18,19,20,21,21,22,23,24,25,26,26,27,28,29,30,30,31,32,33,34,34,35,36,37,38,39,39,40,41,42,43,43,44,45],
    290:[0,0,0,0,0,3,4,5,6,7,7,8,9,10,11,11,12,13,14,15,15,16,17,18,19,19,20,21,22,23,23,24,25,26,27,27,28,29,30,31,31,32,33,34,35,35,36,37,38,39,39,40,41,42,43,43,44],
    // NOTE (295 & 300 at waist-wrist 43.5): the live Zone calculator carries 44
    // in both cells, which breaks the row/column progression. The client document
    // image shows 33 for both, and the client document is canonical — corrected.
    295:[0,0,0,0,0,3,4,5,6,6,7,8,9,10,10,11,12,13,14,14,15,16,17,17,18,19,20,21,21,22,23,24,25,25,26,27,28,28,29,30,31,32,32,33,34,35,36,36,37,38,39,39,40,41,42,43,43],
    300:[0,0,0,0,0,3,4,5,5,6,7,8,9,9,10,11,12,12,13,14,15,16,16,17,18,19,19,20,21,22,22,23,24,25,26,26,27,28,29,29,30,31,32,33,33,34,35,36,36,37,38,39,39,40,41,42,43]
  };

  function roundHalf(v) { return Math.round(parseFloat(v) * 2) / 2; }
  function roundFive(v) { return Math.round(parseFloat(v) / 5) * 5; }

  /** Female: Body Fat % = round(A + B - C). Source step 5, BMI formula.docx. */
  function femaleBodyFat(m) {
    var hips = roundHalf(m.hips), abdomen = roundHalf(m.abdomen), height = roundHalf(m.height);
    var A = F_HIPS_A[hips], B = F_ABDOMEN_B[abdomen], C = F_HEIGHT_C[height];
    if (A === undefined || B === undefined || C === undefined) {
      return { ok: false, reason: 'outside the client table',
               detail: { hips: A !== undefined, abdomen: B !== undefined, height: C !== undefined } };
    }
    return { ok: true, percent: Math.round(A + B - C), constants: { A: A, B: B, C: C } };
  }

  /** Male: look up (weight, waist - wrist) in Table 2. */
  function maleBodyFat(m) {
    var weight = roundFive(m.weight);
    var diff = roundHalf(parseFloat(m.waist) - parseFloat(m.wrist));
    var row = M_ROWS[weight];
    var ci = M_COLS.indexOf(diff);
    if (!row || ci === -1) return { ok: false, reason: 'outside the client table',
                                    detail: { weight: weight, waistMinusWrist: diff } };
    var v = row[ci];
    // 0 marks a blank cell in the client table — an unsupported combination.
    if (!v) return { ok: false, reason: 'combination not covered by the client table',
                     detail: { weight: weight, waistMinusWrist: diff } };
    return { ok: true, percent: v, lookup: { weight: weight, waistMinusWrist: diff } };
  }

  /** Standard BMI. NOTE: this is the ordinary weight/height index and is NOT
   *  part of Cara's body-fat lookup — the two are reported separately. */
  function bmi(weightLb, heightIn) {
    var w = parseFloat(weightLb), h = parseFloat(heightIn);
    if (!w || !h) return null;
    return Math.round((703 * w / (h * h)) * 10) / 10;
  }

  /** Full body-composition result for either sex. */
  function bodyComposition(input) {
    var sex = (input.sex || input.biology || '').toString().toLowerCase();
    var isMale = sex.indexOf('man') === 0 || sex === 'male' || sex === 'm';
    var bf = isMale ? maleBodyFat(input) : femaleBodyFat(input);
    var out = { sex: isMale ? 'Man' : 'Woman', ok: bf.ok, reason: bf.reason,
                bmi: bmi(input.weight, input.height) };
    if (!bf.ok) return out;
    var weight = parseFloat(input.weight);
    out.bodyFatPercent = bf.percent;
    // "(Weight) x (% of body fat) = total body-fat weight", then
    // "Lean body mass = total weight - total body-fat weight".
    out.fatMassLb = Math.round(weight * (bf.percent / 100) * 10) / 10;
    out.leanMassLb = Math.round((weight - out.fatMassLb) * 10) / 10;
    out.constants = bf.constants;
    out.lookup = bf.lookup;
    return out;
  }

  /* =========================================================================
     HEALTH ASSESSMENT — Feedback_docs/Health Assessment.docx (25 Aug 2026)
     11 questions; first (healthiest) choice 1, middle 2, third 3.
     Total 11-33, LOWER IS BETTER — the client reversed the earlier scale
     ("I needed to reverse the numbers so 11 is low inflammation and 33 is
     high inflammation", Functional Edits 260824). Interpretation wording is
     verbatim from the document.
     ====================================================================== */
  var HSR_SCALE = 'On a scale of 11 to 33, where 11 is low inflammation and 33 is high inflammation, ';
  function hsrInterpret(total) {
    var t = Number(total);
    if (t <= 11) return { bucket: 'verylow', status: 'Very Low Inflammation',
      desc: HSR_SCALE + 'you have very low inflammation, what you are eating is working well for you and few adjustments are needed.' };
    if (t <= 16) return { bucket: 'low', status: 'Low Inflammation',
      desc: HSR_SCALE + 'you have low inflammation. What you are eating is good, making some improvements and following the Veye guidelines will decrease inflammation even more.' };
    if (t <= 22) return { bucket: 'moderate', status: 'Moderate Inflammation',
      desc: HSR_SCALE + 'you have moderate inflammation. You can improve your health with the Veye guidelines.' };
    if (t <= 27) return { bucket: 'high', status: 'High Inflammation',
      desc: HSR_SCALE + 'your inflammation is high - you may already have a chronic disease, and if not you are at risk of developing a chronic disease. Following the Veye guidelines will significantly improve your health.' };
    if (t <= 32) return { bucket: 'significant', status: 'Significant Inflammation',
      desc: HSR_SCALE + 'you have significant inflammation. You may already have a chronic disease, and if not you are at risk of developing a chronic disease. The Veye guidelines can help you make the foods you already eat healthier by combining the right ratios of proteins, carbohydrates and fats. Then when you are ready you can begin to choose healthier foods.' };
    return { bucket: 'poor', status: 'High Inflammation / Poor Health',
      desc: HSR_SCALE + 'your inflammation is high and your health is poor. Try incorporating the Veye program as much as possible. Start with small changes: first make the food you eat healthier and combine them properly, then over time choose healthier foods.' };
  }

  /** EPA/DHA dosage by score (Health Assessment.docx):
   *  11-17 -> 2.5g · 18-21 -> 5g · 22-33 -> 7.5g.
   *  Polyphenols are THE SAME for every score — all three lines, verbatim.
   *  The 10g row is condition-based (neurological disorders) and is NEVER
   *  assigned automatically: this assessment does not establish the condition. */
  var HSR_POLY_LINES = [
    { amount: '500mg', note: 'helps reduce oxidative stress' },
    { amount: '1000mg', note: 'helps reduce inflammation' },
    { amount: '1500mg', note: 'helps reduce the rate of aging and increases mitochondrial synthesis' }
  ];
  function hsrDosage(total) {
    var t = Number(total);
    var epa = t <= 17 ? '2.5g' : t <= 21 ? '5g' : '7.5g';
    return { epa: epa, polyLines: HSR_POLY_LINES };
  }
  var HSR_NEUROLOGICAL = { epa: '10g', condition: 'Neurological disorders',
    note: 'condition-based; this assessment does not establish that condition' };

  /* =========================================================================
     SIMPLE QUIZ — Simple Quiz.docx
     8 yes/no questions. The source defines ONLY: count yes vs no, store by date,
     let the user revisit a day, and "progress is an improvement in the number of
     yes answers". It defines NO health status tiers and NO supplement dosage, so
     none are produced here. (The previous build invented five status tiers plus
     EPA/polyphenol doses — removed.)
     ====================================================================== */
  function simpleQuizSummary(answers) {
    var list = (answers || []).filter(function (a) { return a !== null && a !== undefined; });
    var yes = list.filter(function (a) { return a === 1 || a === true || a === 'yes'; }).length;
    var no = list.length - yes;
    return { yesCount: yes, noCount: no, answered: list.length, total: 8,
             summary: no + ' No / ' + yes + ' Yes',
             progressNote: 'Fewer Yes answers over time indicates improvement.' };
  }

  /* =========================================================================
     BLOOD MARKERS — Dated Blood Markers tracking.pdf
     ====================================================================== */
  var BLOOD_GOALS = {
    tg_hdl: { label: 'TG/HDL ratio', goal: '< 1', test: function (v) { return v < 1; } },
    aa_epa: { label: 'AA/EPA ratio', goal: '1.5-3', test: function (v) { return v >= 1.5 && v <= 3; } },
    hba1c:  { label: 'HbA1c', goal: '4.9-5.1%', test: function (v) { return v >= 4.9 && v <= 5.1; } },
    homa_ir:{ label: 'HOMA-IR', goal: '< 1', test: function (v) { return v < 1; } }
  };

  function tgHdl(tg, hdl) { return (tg > 0 && hdl > 0) ? Math.round((tg / hdl) * 100) / 100 : null; }
  function aaEpa(aa, epa) { return (aa > 0 && epa > 0) ? Math.round((aa / epa) * 100) / 100 : null; }

  /** HOMA-IR.
   *  The source states: fasting insulin (microU/mL) x fasting glucose / 22.5,
   *  where glucose is in mmol/L. This UI collects glucose in mg/dL, and
   *  mg/dL = mmol/L x 18.0182, so dividing by 22.5 x 18.0182 = 405 is the exact
   *  unit-equivalent of the source formula. Do not switch to /22.5 unless the
   *  glucose input is also switched to mmol/L. */
  function homaIr(insulinMicroUmL, glucoseMgDl) {
    var i = parseFloat(insulinMicroUmL), g = parseFloat(glucoseMgDl);
    if (!(i > 0) || !(g > 0)) return null;
    return Math.round((i * g / 405) * 100) / 100;
  }

  // NOT-SOURCED: there is no rule mapping the NUMBER of out-of-range markers to
  // a dose. The client's EPA/DHA dosage is by CONDITION:
  //   no chronic disease 2.5g · overweight/obese, type II diabetes, CHD etc 5g
  //   chronic pain 7.5g · neurological disorders 10g
  // The condition is not captured anywhere in the prototype, so no dose is
  // derived from blood markers.
  var BLOOD_DOSE_BY_CONDITION = [
    { condition: 'No chronic disease', epa: '2.5g' },
    { condition: 'Overweight/obese, type II diabetes, CHD etc', epa: '5g' },
    { condition: 'Chronic pain', epa: '7.5g' },
    { condition: 'Neurological disorders', epa: '10g' }
  ];

  /* =========================================================================
     DATED HISTORY HELPERS
     Progress trackers are longitudinal (Progress Tracker Representations.docx,
     and the HSR doc's "when the user does another... improvement is if the
     overall score improves"). These keep a `latest` for existing UI plus a
     `history` array, and migrate the old single-value shape non-destructively.
     ====================================================================== */
  function todayISO() { return new Date().toISOString(); }

  /** Convert whatever is stored under `key` into { latest, history[] } without
   *  losing the previous value. Safe to call repeatedly. */
  function migrateToHistory(stored) {
    if (!stored || typeof stored !== 'object') return { latest: null, history: [] };
    if (Array.isArray(stored.history)) {
      if (!stored.latest && stored.history.length) stored.latest = stored.history[stored.history.length - 1];
      return stored;
    }
    // old shape: the record itself was the single result
    var entry = stored;
    return { latest: entry, history: entry && (entry.result || entry.data || entry.answers) ? [entry] : [] };
  }

  /** Append a dated entry, keeping `latest` in sync. */
  function pushHistory(store, entry, opts) {
    store = migrateToHistory(store);
    entry = entry || {};
    if (!entry.updated) entry.updated = todayISO();
    if (!entry.date) entry.date = entry.updated.slice(0, 10);
    if (opts && opts.appendAlways) {
      // every attempt is its own row (the Health Assessment: "it changed the
      // number ... instead of making another row", Functional Edits 260824)
      store.history.push(entry);
    } else {
      // one entry per calendar day — a retake on the same day replaces it
      var i = store.history.findIndex(function (h) { return h.date === entry.date; });
      if (i >= 0) store.history[i] = entry; else store.history.push(entry);
    }
    store.history.sort(function (a, b) { return a.updated < b.updated ? -1 : 1; });
    store.latest = entry;
    return store;
  }

  /* =========================================================================
     CANONICAL HEALTH NUMBER RECORD
     Both the onboarding quiz and the dashboard retake write through this one
     path. This prevents the displayed number from drifting between
     `veye_health_number`, `veye_quiz`, and `veye_health_quiz`.
     ====================================================================== */
  function readStoredJson(key) {
    try { return JSON.parse(root.localStorage.getItem(key) || 'null'); }
    catch (e) { return null; }
  }

  function saveHealthNumberRecord(answers, options) {
    options = options || {};
    answers = answers && typeof answers === 'object' ? answers : {};

    var number = healthNumberScore(answers);
    var result = interpretHealthNumber(number, answers);
    var updated = options.updated || todayISO();
    var entry = {
      answers: answers,
      writeIns: options.writeIns || {},
      result: result,
      updated: updated,
      source: options.source || 'dashboard-retake'
    };
    var prior = migrateToHistory(readStoredJson('veye_health_quiz'));
    var store = pushHistory(prior, entry);
    var payload = {
      answers: entry.answers,
      writeIns: entry.writeIns,
      result: entry.result,
      updated: entry.updated,
      source: entry.source,
      latest: store.latest,
      history: store.history
    };

    try {
      root.localStorage.setItem('veye_health_quiz', JSON.stringify(payload));
      // Compatibility keys remain available for existing screens and for the
      // compact file:// state carrier, but they always mirror the same record.
      root.localStorage.setItem('veye_health_number', String(number));
      root.localStorage.setItem('veye_quiz', JSON.stringify(answers));
      root.localStorage.setItem('veye_health_updated', updated);
    } catch (e) {}
    return payload;
  }

  function readHealthNumberRecord() {
    var stored = readStoredJson('veye_health_quiz');
    var store = migrateToHistory(stored);
    var latest = store.latest || (store.history.length ? store.history[store.history.length - 1] : null);
    if (latest && latest.result && typeof latest.result.number === 'number') {
      return {
        number: latest.result.number,
        info: latest.result,
        answers: latest.answers || {},
        updated: latest.updated || null,
        source: latest.source === 'onboarding' ? 'Onboarding' : 'Health quiz',
        store: store
      };
    }

    // Non-destructive migration path for prototypes saved before the canonical
    // record existed. The next completed assessment upgrades this automatically.
    var number = null;
    var answers = readStoredJson('veye_quiz') || {};
    var updated = null;
    try {
      number = parseFloat(root.localStorage.getItem('veye_health_number'));
      updated = root.localStorage.getItem('veye_health_updated');
    } catch (e) {}
    if (number !== null && !isNaN(number)) {
      return {
        number: number,
        info: interpretHealthNumber(number, answers),
        answers: answers,
        updated: updated,
        source: 'Onboarding',
        store: { latest: null, history: [] }
      };
    }
    return { number: null, info: null, answers: {}, updated: null,
             source: 'Not taken', store: { latest: null, history: [] } };
  }

  /* =========================================================================
     STATE CARRY ACROSS SCREENS  (prototype only — no backend)

     Firefox gives every file:// document its OWN opaque origin
     (location.origin === "null"), so localStorage is partitioned per file: a
     Health Number saved by onboarding.html is invisible to dashboard.html.
     Verified directly — page A wrote a probe key, page B read null. Chrome
     shares one file:// store, which is why this only shows up in Firefox.

     Fix: when running from file://, mirror the Veye keys into the URL fragment
     on every internal navigation and import them on load. localStorage is still
     the primary store and every existing read/write call site is unchanged —
     this is purely an extra carrier that makes the demo work in both browsers.
     On http(s) it is a no-op.
     ====================================================================== */
  var CARRY_ON = (function () {
    try { return !!(root.location && root.location.protocol === 'file:'); } catch (e) { return false; }
  })();
  var CARRY_MAX = 30000;          // keep URLs sane; largest keys drop out first
  var CARRY_PARAM = 'veyestate';

  function allVeyeKeys() {
    var out = [];
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf('veye_') === 0) out.push(k);
      }
    } catch (e) {}
    return out;
  }

  function exportState() {
    var o = {};
    allVeyeKeys().forEach(function (k) {
      try { var v = localStorage.getItem(k); if (v !== null) o[k] = v; } catch (e) {}
    });
    var s = JSON.stringify(o);
    if (s.length <= CARRY_MAX) return s;
    // too big — drop the largest entries until it fits, smallest/most important stay
    var keys = Object.keys(o).sort(function (a, b) { return o[b].length - o[a].length; });
    while (keys.length && JSON.stringify(o).length > CARRY_MAX) delete o[keys.shift()];
    return JSON.stringify(o);
  }

  function importState() {
    if (!CARRY_ON) return 0;
    var n = 0;
    try {
      var m = String(root.location.hash || '').match(new RegExp('(?:^|[#&])' + CARRY_PARAM + '=([^&]*)'));
      if (!m) return 0;
      var obj = JSON.parse(decodeURIComponent(m[1]));
      Object.keys(obj).forEach(function (k) {
        if (k.indexOf('veye_') !== 0) return;
        try {
          // The fragment was produced by the page the member just left, so it
          // is the freshest cross-file state. Replace a stale destination copy
          // instead of silently showing a different result on the next screen.
          if (localStorage.getItem(k) !== obj[k]) { localStorage.setItem(k, obj[k]); n++; }
        } catch (e) {}
      });
    } catch (e) {}
    return n;
  }

  /** Append the current state to an internal URL. */
  function withState(href) {
    if (!CARRY_ON || !href) return href;
    if (/^(mailto:|tel:|javascript:|https?:|data:)/i.test(href)) return href;
    if (href.charAt(0) === '#') return href;
    var base = href.split('#')[0];
    return base + '#' + CARRY_PARAM + '=' + encodeURIComponent(exportState());
  }

  /** Programmatic navigation that keeps the prototype's state. */
  function navigate(href) { root.location.href = withState(href); }

  // Import IMMEDIATELY at script-execution time. It needs no DOM, and the
  // dashboard's inline script hydrates during parse — well before
  // DOMContentLoaded — so a deferred import would arrive too late.
  if (CARRY_ON) importState();

  function installCarry() {
    if (!CARRY_ON) return;
    // rewrite internal links at click time so the freshest state travels
    document.addEventListener('click', function (e) {
      var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
      if (!a) return;
      var h = a.getAttribute('href');
      if (!h || h.charAt(0) === '#') return;
      if (/^(mailto:|tel:|javascript:|https?:|data:)/i.test(h)) return;
      a.setAttribute('href', withState(h));
    }, true);
    // GET form submission keeps the action's fragment, so this survives signup
    document.addEventListener('submit', function (e) {
      var f = e.target;
      if (!f || !f.getAttribute) return;
      var act = f.getAttribute('action');
      if (!act || /^https?:/i.test(act)) return;
      f.setAttribute('action', withState(act));
    }, true);
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installCarry);
    else installCarry();
  }

  /* ===================================================================== */
  root.VeyeCalculations = {
    version: '1.5.0',
    storage: { carryEnabled: CARRY_ON, exportState: exportState, importState: importState,
               withState: withState, navigate: navigate },
    healthNumber: {
      PLAN_SCORES: PLAN_SCORES,
      ACTIVITY_SCORES: ACTIVITY_SCORES,
      GOAL_OPTIONS: GOAL_OPTIONS,
      PLAN_OPTIONS: PLAN_OPTIONS,
      ACTIVITY_OPTIONS: ACTIVITY_OPTIONS,
      DIET_OPTIONS: DIET_OPTIONS,
      SOURCE_OPTIONS: SOURCE_OPTIONS,
      LIFESTYLE_KEYS: LIFESTYLE_KEYS,
      FOOD_KEYS: FOOD_KEYS,
      MIN: HN_MIN, MAX: HN_MAX,
      points: healthNumberPoints,
      raw: healthNumberRaw,
      score: healthNumberScore,
      interpret: interpretHealthNumber,
      classify: classify,
      saveRecord: saveHealthNumberRecord,
      readRecord: readHealthNumberRecord
    },
    bodyFat: {
      FEMALE_HIPS_A: F_HIPS_A,
      FEMALE_ABDOMEN_B: F_ABDOMEN_B,
      FEMALE_HEIGHT_C: F_HEIGHT_C,
      MALE_COLS: M_COLS,
      MALE_ROWS: M_ROWS,
      female: femaleBodyFat,
      male: maleBodyFat,
      compose: bodyComposition
    },
    bmi: bmi,
    hsr: { interpret: hsrInterpret, dosage: hsrDosage, NEUROLOGICAL: HSR_NEUROLOGICAL },
    simpleQuiz: { summarize: simpleQuizSummary },
    blood: { GOALS: BLOOD_GOALS, tgHdl: tgHdl, aaEpa: aaEpa, homaIr: homaIr,
             DOSE_BY_CONDITION: BLOOD_DOSE_BY_CONDITION },
    history: { migrate: migrateToHistory, push: pushHistory, todayISO: todayISO }
  };
})(window);
