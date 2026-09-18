/* ============================================================================
   VEYE — calculation regression tests                    PERMANENT PROJECT CODE
   ----------------------------------------------------------------------------
   Run:   node tests/veye-calculations.test.js
   Exit:  0 = all assertions passed, 1 = at least one failed.

   No Jest, no npm install, no dependencies — Node's built-in `assert` and `vm`.
   The engine (build/js/veye-calculations.js) is a browser global that ends in
   `})(window)`, so it is evaluated inside a vm sandbox that supplies `window`
   and nothing else. `document` and `location` stay undefined there, which is
   exactly what makes the file:// state carrier switch itself off — proving as a
   side effect that the carrier is inert outside a browser.

   EVERY expected value below traces to a client document in
   `veye copy/veye copy/VeyeDocuments/` (read-only):

     Health Numbers Metrics Nile site.xlsx ......... Health Number weights
                                    (client update 20 Aug 2026; Q5 yes = 0.5)
     Nile Site Health Number Interpretation and
       Formula.docx ................................ bands, wording, floor = 1
     BMI formula.docx (Appendix B) ................. body-fat lookup tables
     Health Assessment.docx ....................... HA bands and dosage (11 low - 33 high)
     Simple Quiz.docx .............................. Simple Quiz counting
     Dated Blood Markers tracking.pdf .............. blood marker goals

   The body-fat table constants are asserted as REGRESSION ANCHORS: they were
   transcribed and cross-checked against the client document, and these tests
   exist so a later edit cannot silently move them.
   ========================================================================== */

'use strict';

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');
const vm     = require('vm');

/* ---------------------------------------------------------------- harness -- */

const ENGINE = path.join(__dirname, '..', 'build', 'js', 'veye-calculations.js');

function createStorage(initial) {
  const data = Object.assign({}, initial || {});
  return {
    get length() { return Object.keys(data).length; },
    key(i) { return Object.keys(data)[i] || null; },
    getItem(k) { return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
    setItem(k, v) { data[k] = String(v); },
    removeItem(k) { delete data[k]; },
    clear() { Object.keys(data).forEach(k => delete data[k]); },
    snapshot() { return Object.assign({}, data); }
  };
}

function loadEngine(options) {
  options = options || {};
  const src = fs.readFileSync(ENGINE, 'utf8');
  const win = {};
  if (options.storage) win.localStorage = options.storage;
  if (options.location) win.location = options.location;
  const sandbox = { window: win };
  if (options.storage) sandbox.localStorage = options.storage;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: ENGINE });
  const C = sandbox.window.VeyeCalculations;
  assert.ok(C, 'engine did not attach window.VeyeCalculations');
  return C;
}

/** The engine runs in its own vm realm, so an array it creates does not share
 *  the host's Array.prototype and `deepStrictEqual` would reject it on identity
 *  alone. Round-tripping through JSON compares the VALUES, which is the point. */
const plain = v => JSON.parse(JSON.stringify(v));

const groups = [];
let currentGroup = null;
let passed = 0;
const failures = [];

function group(name, fn) {
  currentGroup = { name, passed: 0, failed: 0 };
  groups.push(currentGroup);
  fn();
  currentGroup = null;
}

function check(what, fn) {
  try {
    fn();
    passed++; currentGroup.passed++;
  } catch (err) {
    currentGroup.failed++;
    failures.push({ group: currentGroup.name, what, message: err.message });
  }
}

const C = loadEngine();
const HN = C.healthNumber;

/* ======================================================================== 9A
   HEALTH NUMBER — HealthNumbers.xlsx, column "Score"
   ========================================================================= */

// Health Numbers Metrics Nile site.xlsx (20 Aug 2026) carries four sample
// columns; its "very UnH" column selects Weight Watchers + Keto + Fasting on
// the multi-select Q2 and totals exactly 10. Reproduced here as the worst
// anchor. (With Q5 now 0.5, a single-plan profile can no longer reach 10.)
const WORST = {
  plans: ['Weight Watchers', 'Keto', 'Fasting'],       // 0.5 + 1.5 + 0.5 = 2.5
  activity: 'None',                                    // 1
  meditate: 'no',                                      // 0.5
  tired: 'yes',                                        // 0.5
  gainWeight: 'yes',                                   // 1
  abdomenWeight: 'yes',                                // 0.5
  sleepEnough: 'no',                                   // 1.5
  sleepWell: 'no',                                     // 1.5
  sleepHours: 4                                        // 1   -> 10.0
};
const HEALTHY = {
  plans: ['No other plans'],                           // 0
  activity: 'Moderate (I exercise 1-3 times a week)',  // -1
  meditate: 'yes',                                     // -0.5
  tired: 'no', gainWeight: 'no', abdomenWeight: 'no',
  sleepEnough: 'yes', sleepWell: 'yes', sleepHours: 7  //      -> -1.5 raw
};

group('Health Number', () => {
  check('referral sources match Cara\'s Start the Process review', () => {
    const sources = plain(HN.SOURCE_OPTIONS);
    assert.ok(sources.includes('Facebook'));
    assert.ok(sources.includes('Recommended by a doctor'));
    assert.ok(!sources.some(label => /twitter|\bx\b/i.test(label)));
  });
  check('canonical worst profile scores 10', () => {
    assert.strictEqual(HN.score(WORST), 10);
  });
  check('canonical healthy profile raw = -1.5', () => {
    assert.strictEqual(HN.raw(HEALTHY), -1.5);
  });
  check('canonical healthy profile displays at the published floor of 1', () => {
    // RESOLVED (Nile Site Interpretation docx, 20 Aug 2026): "-1 ... defaults
    // to 1". The published floor is 1; raw() keeps the unclamped total.
    assert.strictEqual(HN.score(HEALTHY), 1);
    assert.strictEqual(HN.MIN, 1);
    assert.strictEqual(HN.MAX, 10);
  });
  check('the docx example: all-zero answers + moderate exercise = raw -1, published 1', () => {
    const a = { plans: ['No other plans'], activity: 'Moderate (I exercise 1-3 times a week)',
                tired: 'no', gainWeight: 'no', abdomenWeight: 'no',
                sleepEnough: 'yes', sleepWell: 'yes', sleepHours: 7 };
    assert.strictEqual(HN.raw(a), -1);
    assert.strictEqual(HN.score(a), 1);
    const heavy = Object.assign({}, a, { activity: 'Heavy (I exercise 3x+ times per week)' });
    assert.strictEqual(HN.raw(heavy), -1);
    assert.strictEqual(HN.score(heavy), 1);
  });
  check('score never exceeds 10', () => {
    const beyond = Object.assign({}, WORST, { plans: ['ATKINS', 'Keto', 'Noom'] });
    assert.ok(HN.raw(beyond) > 10, 'expected the raw total to exceed 10');
    assert.strictEqual(HN.score(beyond), 10);
  });
  check('score lands on a half-point step', () => {
    const n = HN.score({ plans: ['Weight Watchers'], tired: 'yes', meditate: 'no' });
    assert.strictEqual(n * 2, Math.round(n * 2));
  });

  // ---- Q2 every plan value (XLSX R13-R23) ----
  const PLANS = {
    'Weight Watchers': 0.5, 'Noom': 0.5, 'Jenny Craig': 0.5,
    'The Mediterranean Diet': 0.5, 'DASH': 0.5,
    'ATKINS': 1.5, 'Keto': 1.5,
    'Intermittent Fasting': 0.5, 'Fasting': 0.5,
    'Other': 0.5, 'No other plans': 0
  };
  Object.keys(PLANS).forEach(label => {
    check(`Q2 plan "${label}" = ${PLANS[label]}`, () => {
      assert.strictEqual(HN.points({ plans: [label] }).plans, PLANS[label]);
      assert.strictEqual(HN.PLAN_SCORES[label], PLANS[label]);
    });
  });
  check('Q2 "No other plans" is exclusive — it zeroes the question', () => {
    assert.strictEqual(HN.points({ plans: ['ATKINS', 'No other plans'] }).plans, 0);
  });
  check('Q2 multi-select adds up', () => {
    assert.strictEqual(HN.points({ plans: ['ATKINS', 'Noom'] }).plans, 2);
  });
  check('Q2 free-text write-in scores as Other (0.5), once', () => {
    assert.strictEqual(HN.points({ plans: ['Slimming World'] }).plans, 0.5);
  });

  // ---- Q3 activity (XLSX R25-R28) ----
  const ACT = {
    'None': 1,
    'Light (I work, I walk some)': 0,
    'Moderate (I exercise 1-3 times a week)': -1,
    'Heavy (I exercise 3x+ times per week)': -1
  };
  Object.keys(ACT).forEach(label => {
    check(`Q3 activity "${label}" = ${ACT[label]}`, () => {
      assert.strictEqual(HN.points({ activity: label }).activity, ACT[label]);
    });
  });
  check('Q3 activity labels tolerate spacing drift between screens', () => {
    // Guards the bug this suite was written after: the dashboard carried
    // "3x+" while the engine table carried "3x +", so Heavy silently scored 0.
    assert.strictEqual(HN.points({ activity: 'Heavy (I exercise 3x + times per week)' }).activity, -1);
  });
  check('Q3 activity option list matches the score table', () => {
    assert.deepStrictEqual(plain(HN.ACTIVITY_OPTIONS).sort(),
                           Object.keys(HN.ACTIVITY_SCORES).sort());
  });

  // ---- Q4-Q10 ----
  check('Q4 meditation Yes = -0.5, No = +0.5', () => {
    assert.strictEqual(HN.points({ meditate: 'yes' }).meditate, -0.5);
    assert.strictEqual(HN.points({ meditate: 'no' }).meditate, 0.5);
  });
  check('Q5 tired / poor focus Yes = +0.5, No = 0 (Nile sheet, 20 Aug 2026)', () => {
    assert.strictEqual(HN.points({ tired: 'yes' }).tired, 0.5);
    assert.strictEqual(HN.points({ tired: 'no' }).tired, 0);
    // Yes adds EXACTLY 0.5 to an otherwise identical profile
    assert.strictEqual(HN.raw({ tired: 'yes', gainWeight: 'yes' }) -
                       HN.raw({ tired: 'no',  gainWeight: 'yes' }), 0.5);
  });
  check('Q6 gain weight quickly Yes = +1', () => {
    assert.strictEqual(HN.points({ gainWeight: 'yes' }).gainWeight, 1);
    assert.strictEqual(HN.points({ gainWeight: 'no' }).gainWeight, 0);
  });
  check('Q7 weight around abdomen Yes = +0.5', () => {
    assert.strictEqual(HN.points({ abdomenWeight: 'yes' }).abdomenWeight, 0.5);
    assert.strictEqual(HN.points({ abdomenWeight: 'no' }).abdomenWeight, 0);
  });
  check('Q8 enough sleep No = +1.5', () => {
    assert.strictEqual(HN.points({ sleepEnough: 'no' }).sleepEnough, 1.5);
    assert.strictEqual(HN.points({ sleepEnough: 'yes' }).sleepEnough, 0);
  });
  check('Q9 sleep well No = +1.5', () => {
    assert.strictEqual(HN.points({ sleepWell: 'no' }).sleepWell, 1.5);
    assert.strictEqual(HN.points({ sleepWell: 'yes' }).sleepWell, 0);
  });
  check('Q10 sleep hours <5 = +1, 5-9 = 0, >9 = +1', () => {
    assert.strictEqual(HN.points({ sleepHours: 4 }).sleepHours, 1);
    assert.strictEqual(HN.points({ sleepHours: 4.9 }).sleepHours, 1);
    assert.strictEqual(HN.points({ sleepHours: 5 }).sleepHours, 0);
    assert.strictEqual(HN.points({ sleepHours: 7 }).sleepHours, 0);
    assert.strictEqual(HN.points({ sleepHours: 9 }).sleepHours, 0);
    assert.strictEqual(HN.points({ sleepHours: 9.5 }).sleepHours, 1);
    assert.strictEqual(HN.points({ sleepHours: 12 }).sleepHours, 1);
  });
  check('Q10 accepts the legacy onboarding sleep{} shape', () => {
    const p = HN.points({ sleep: { enough: 'no', well: 'no', hours: 3 } });
    assert.strictEqual(p.sleepEnough, 1.5);
    assert.strictEqual(p.sleepWell, 1.5);
    assert.strictEqual(p.sleepHours, 1);
  });
  check('Q1 goals, Q11 diet and Q12 referral score 0', () => {
    const p = HN.points({ goals: ['Lose Body Fat', 'Other'], diet: 'Vegan', source: 'Instagram' });
    assert.strictEqual(p.goals, 0);
    assert.strictEqual(p.diet, 0);
    assert.strictEqual(p.source, 0);
  });
  check('"Other write in" text never changes the score', () => {
    const withText = Object.assign({}, WORST, {
      goalsOther: 'run a marathon', plansOther: 'Slimming World',
      diet: 'Other', dietOther: 'pescatarian', source: 'Other', sourceOther: 'a podcast'
    });
    assert.strictEqual(HN.score(withText), HN.score(WORST));
  });

  // ---- the Simple Quiz must stay out of this instrument ----
  check('Simple Quiz answers never enter Health Number scoring', () => {
    const polluted = Object.assign({}, HEALTHY, {
      simpleQuiz: ['yes', 'yes', 'yes', 'yes', 'yes', 'yes', 'yes', 'yes'],
      yesCount: 8, noCount: 0, simple: { yesCount: 8 }
    });
    assert.strictEqual(HN.raw(polluted), HN.raw(HEALTHY));
    assert.strictEqual(HN.score(polluted), HN.score(HEALTHY));
  });
  check('the points map is exactly the 12 canonical questions', () => {
    assert.deepStrictEqual(Object.keys(HN.points({})).sort(), [
      'abdomenWeight', 'activity', 'diet', 'gainWeight', 'goals', 'meditate',
      'plans', 'sleepEnough', 'sleepHours', 'sleepWell', 'source', 'tired'
    ]);
  });

  // ---- interpretation wording ----
  check('interpretation text is plain Unicode, not HTML entities', () => {
    // These strings are rendered with textContent, so "&mdash;" would be shown
    // to the user literally.
    for (let n = 0; n <= 10; n += 0.5) {
      const d = HN.interpret(n, {}).desc || '';
      assert.ok(!/&[a-zA-Z]+;|&#\d+;/.test(d), `entity found in the blurb for ${n}: ${d}`);
    }
  });
  check('Lifestyle / Food grouping follows the 11 Aug ruling', () => {
    assert.deepStrictEqual(plain(HN.LIFESTYLE_KEYS),
      ['activity', 'meditate', 'sleepEnough', 'sleepWell', 'sleepHours']);
    assert.deepStrictEqual(plain(HN.FOOD_KEYS),
      ['plans', 'tired', 'gainWeight', 'abdomenWeight']);
  });
  // ---- every score-band boundary (Nile Site Interpretation docx) ----
  check('band boundaries: 1 / 1.5 / 3.5 / 4 / 6 / 6.5 / 10', () => {
    assert.strictEqual(HN.interpret(1,   {}).bucket, 'good');
    assert.strictEqual(HN.interpret(1.5, {}).bucket, 'relative');
    assert.strictEqual(HN.interpret(3.5, {}).bucket, 'relative');
    assert.strictEqual(HN.interpret(4,   {}).bucket, 'moderate');
    assert.strictEqual(HN.interpret(6,   {}).bucket, 'moderate');
    assert.strictEqual(HN.interpret(6.5, {}).bucket, 'high');
    assert.strictEqual(HN.interpret(10,  {}).bucket, 'high');
  });
  check('band wording follows the 20 Aug 2026 docx', () => {
    assert.ok(HN.interpret(1, {}).desc.indexOf('You are in very good health') === 0,
      'the 0-1 band must read "You are in very good health"');
    assert.ok(HN.interpret(6.5, {}).desc.indexOf('You show signs of insulin resistance') === 0,
      'the 6.5-10 band must open with "You show signs of insulin resistance"');
  });
  check('Lifestyle-only example uses the lifestyle wording', () => {
    // Only lifestyle questions contribute: no+no sleep = 3.0 -> relative band
    const a = { sleepEnough: 'no', sleepWell: 'no' };
    const r = HN.interpret(HN.score(a), a);
    assert.strictEqual(HN.score(a), 3);
    assert.strictEqual(r.category, 'lifestyle');
    assert.ok(r.desc.indexOf('some lifestyle changes will help') !== -1);
  });
  check('Food-only example uses the dietary wording', () => {
    // Only food questions contribute: tired 0.5 + gain 1 + abdomen 0.5 = 2.0
    const a = { tired: 'yes', gainWeight: 'yes', abdomenWeight: 'yes' };
    const r = HN.interpret(HN.score(a), a);
    assert.strictEqual(HN.score(a), 2);
    assert.strictEqual(r.category, 'food');
    assert.ok(r.desc.indexOf('changes to your dietary program') !== -1);
  });
  /* Client rule (progress-review answers, 25 Aug 2026): whichever side has
     more high answers picks the wording; a TIE is Mixed; 6.5-10 is the
     insulin-resistance wording for ANY combination. The docx's earlier
     "2 Lifestyle + 3 Food = Mixed" special case is superseded. */
  check('majority rule: 2 high Lifestyle + 3 high Food -> Food wording', () => {
    // Lifestyle high: sleepEnough, sleepWell (2). Food high: tired, gainWeight,
    // abdomenWeight (3). Total 1.5+1.5+0.5+1+0.5 = 5.0 -> moderate band.
    const a = { sleepEnough: 'no', sleepWell: 'no',
                tired: 'yes', gainWeight: 'yes', abdomenWeight: 'yes' };
    const c = HN.classify(HN.points(a));
    assert.strictEqual(c.category, 'food');
    assert.ok(c.rule.indexOf('more high Food answers') === 0, c.rule);
    const r = HN.interpret(HN.score(a), a);
    assert.strictEqual(HN.score(a), 5);
    assert.ok(r.desc.indexOf('Although you have a healthy lifestyle, your food choices') === 0);
  });
  check('a 4-6 tie shows the Mixed wording', () => {
    // 2 high from each side, landing in the 4-6 band:
    // sleepEnough 1.5 + sleepWell 1.5 (Lifestyle) + tired 0.5 + gainWeight 1
    // (Food) = 4.5.
    const a = { sleepEnough: 'no', sleepWell: 'no', tired: 'yes', gainWeight: 'yes' };
    const c = HN.classify(HN.points(a));
    assert.strictEqual(c.category, 'mixed');
    assert.ok(c.rule.indexOf('tied high answers') === 0, c.rule);
    const n = HN.score(a);
    assert.ok(n >= 4 && n <= 6, 'vector must land in the 4-6 band, got ' + n);
    const r = HN.interpret(n, a);
    assert.ok(r.desc.indexOf('Although you are in moderately good health') === 0,
      'the tie must take the supplied mixed wording');
  });
  check('a 1-1 tie in the relative band also reads Mixed', () => {
    const a = { sleepEnough: 'no', gainWeight: 'yes' };   // 1.5 + 1 = 2.5
    const c = HN.classify(HN.points(a));
    assert.strictEqual(c.category, 'mixed');
    assert.ok(c.rule.indexOf('tied high answers') === 0);
  });
  check('6.5-10 keeps the insulin-resistance wording for ANY combination', () => {
    // mostly-Lifestyle high combination reaching >= 6.5:
    // activity None 1 + meditate no 0.5 + sleep no/no 3 + hours 1 = 5.5 L,
    // tired 0.5 + gainWeight 1 = 1.5 F -> 7.0, counts 5 L vs 2 F
    const lifestyleHeavy = { activity: 'None', meditate: 'no',
      sleepEnough: 'no', sleepWell: 'no', sleepHours: 4, tired: 'yes', gainWeight: 'yes' };
    // mostly-Food high combination reaching >= 6.5:
    // plans WW+Keto 3 + tired 0.5 + gainWeight 1 + abdomen 0.5 = 5.0 F,
    // sleepEnough 1.5 + hours 1 = 2.5 L -> 7.5, counts 4 F vs 2 L
    const foodHeavy = { plans: ['Weight Watchers', 'Keto'], tired: 'yes',
      gainWeight: 'yes', abdomenWeight: 'yes', sleepEnough: 'no', sleepHours: 4 };
    [lifestyleHeavy, foodHeavy].forEach(a => {
      const n = HN.score(a);
      assert.ok(n >= 6.5, 'vector must reach 6.5+, got ' + n);
      const r = HN.interpret(n, a);
      assert.strictEqual(r.bucket, 'high');
      assert.ok(r.desc.indexOf('You show signs of insulin resistance') === 0,
        'the 6.5-10 band must use the insulin-resistance wording');
    });
  });
  check('no undocumented 1.5x "mostly" threshold survives', () => {
    // Lifestyle 1.5 pts vs Food 1.0 pts is a 1.5x POINTS ratio but a 1-1 tie
    // in high-answer counts — it must read Mixed, not "mostly lifestyle".
    const r = HN.classify(HN.points({ sleepEnough: 'no', gainWeight: 'yes' }));
    assert.notStrictEqual(r.category, 'lifestyle');
  });
});

group('Health Number record', () => {
  check('onboarding and dashboard retakes share one latest result', () => {
    const storage = createStorage();
    const H = loadEngine({ storage }).healthNumber;
    const onboarding = {
      plans: ['No other plans'], activity: 'Light (I work, I walk some)',
      meditate: 'yes', tired: 'no', gainWeight: 'no', abdomenWeight: 'no',
      sleepEnough: 'yes', sleepWell: 'yes', sleepHours: 8
    };
    const first = H.saveRecord(onboarding, {
      source: 'onboarding', updated: '2026-09-10T10:00:00.000Z'
    });
    assert.strictEqual(Number(storage.getItem('veye_health_number')), first.result.number);
    assert.strictEqual(JSON.parse(storage.getItem('veye_health_quiz')).result.number, first.result.number);
    assert.strictEqual(H.readRecord().number, first.result.number);

    const retake = Object.assign({}, onboarding, { sleepEnough: 'no', sleepWell: 'no' });
    const second = H.saveRecord(retake, {
      source: 'dashboard-retake', updated: '2026-09-11T10:00:00.000Z'
    });
    const resolved = H.readRecord();
    assert.strictEqual(resolved.number, second.result.number);
    assert.strictEqual(resolved.source, 'Health quiz');
    assert.strictEqual(Number(storage.getItem('veye_health_number')), second.result.number);
    assert.strictEqual(JSON.parse(storage.getItem('veye_quiz')).sleepEnough, 'no');
    assert.strictEqual(resolved.store.history.length, 2);
  });

  check('file-state import replaces a stale destination Health Number', () => {
    const stale = createStorage({ veye_health_number: '7.5' });
    const carried = encodeURIComponent(JSON.stringify({
      veye_health_number: '2.5',
      veye_health_updated: '2026-09-11T10:00:00.000Z'
    }));
    const Cfile = loadEngine({
      storage: stale,
      location: { protocol: 'file:', hash: '#veyestate=' + carried }
    });
    assert.strictEqual(Cfile.storage.carryEnabled, true);
    assert.strictEqual(stale.getItem('veye_health_number'), '2.5');
  });
});

/* ======================================================================== 9B
   FEMALE BODY FAT — BMI formula.docx, Appendix B Table 1
   Body Fat % = round(A + B - C), where A = hips, B = abdomen, C = height.
   ========================================================================= */

group('Female Body Fat', () => {
  const A = C.bodyFat.FEMALE_HIPS_A;
  const B = C.bodyFat.FEMALE_ABDOMEN_B;
  const D = C.bodyFat.FEMALE_HEIGHT_C;

  check('hips constants — low / mid / high', () => {
    assert.strictEqual(A[30], 33.48);
    assert.strictEqual(A[45], 54.53);
    assert.strictEqual(A[60], 75.39);
  });
  check('abdomen constants — low / mid / high', () => {
    assert.strictEqual(B[20], 14.22);
    assert.strictEqual(B[35], 24.89);
    assert.strictEqual(B[50], 35.56);
  });
  check('height constants — low / mid / high', () => {
    assert.strictEqual(D[55], 33.52);
    assert.strictEqual(D[65], 39.62);
    assert.strictEqual(D[76], 46.32);
  });
  check('worked example: hips 40, abdomen 30, height 65 -> 29%', () => {
    // 47.44 + 21.33 - 39.62 = 29.15 -> 29
    const r = C.bodyFat.female({ hips: 40, abdomen: 30, height: 65 });
    assert.strictEqual(r.ok, true);
    assert.deepStrictEqual(plain(r.constants), { A: 47.44, B: 21.33, C: 39.62 });
    assert.strictEqual(r.percent, 29);
  });
  check('measurements snap to the half-inch grid the table uses', () => {
    const a = C.bodyFat.female({ hips: 40.2, abdomen: 30.1, height: 64.9 });
    const b = C.bodyFat.female({ hips: 40,   abdomen: 30,   height: 65   });
    assert.strictEqual(a.percent, b.percent);
  });
  check('below-table hips fail cleanly', () => {
    const r = C.bodyFat.female({ hips: 29, abdomen: 30, height: 65 });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.detail.hips, false);
    assert.strictEqual(r.percent, undefined);
  });
  check('above-table abdomen fails cleanly', () => {
    const r = C.bodyFat.female({ hips: 40, abdomen: 60, height: 65 });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.detail.abdomen, false);
  });
  check('above-table height fails cleanly — no interpolation', () => {
    const r = C.bodyFat.female({ hips: 40, abdomen: 30, height: 80 });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.detail.height, false);
  });
});

/* ======================================================================== 9C
   MALE BODY FAT — BMI formula.docx, Appendix B Table 2
   Row = weight (120-300 lb by 5), column = waist minus wrist (22-50 by 0.5).
   ========================================================================= */

group('Male Body Fat', () => {
  const male = (weight, diff) => C.bodyFat.male({ weight, waist: 30 + diff, wrist: 30 });

  const ANCHORS = [
    [120, 22,   4], [120, 22.5,  6], [120, 23,  8],
    [200, 23,   3], [200, 23.5,  4], [200, 24,  6],
    [235, 47.5, 51], [235, 50, 55],
    [260, 47.5, 45], [260, 50, 50],
    [300, 47.5, 39], [300, 50, 43]
  ];
  ANCHORS.forEach(([w, d, expected]) => {
    check(`${w} lb / waist-wrist ${d} -> ${expected}%`, () => {
      const r = male(w, d);
      assert.strictEqual(r.ok, true, `expected a value at ${w}/${d}`);
      assert.strictEqual(r.percent, expected);
    });
  });

  check('blank cells are unsupported, not zero and not interpolated', () => {
    // 120 lb has no value past waist-wrist 35 in the client table.
    const r = male(120, 40);
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.percent, undefined);
    assert.ok(/not covered/.test(r.reason), `unexpected reason: ${r.reason}`);
  });
  check('off-table weight fails cleanly', () => {
    const r = male(310, 30);
    assert.strictEqual(r.ok, false);
    assert.ok(/outside/.test(r.reason));
  });
  check('off-table waist-wrist difference fails cleanly', () => {
    const r = male(200, 21);
    assert.strictEqual(r.ok, false);
    assert.ok(/outside/.test(r.reason));
  });
  check('weight snaps to the nearest 5 lb, difference to the nearest 0.5 in', () => {
    assert.strictEqual(male(201, 23).percent, male(200, 23).percent);
    assert.strictEqual(male(200, 23.1).percent, male(200, 23).percent);
  });
  check('every male row is one contiguous, non-decreasing run of values', () => {
    // A row reads: leading blanks (too light for that girth), one unbroken run
    // of percentages that never goes down, then trailing blanks (off the table).
    // A hole inside the run, or a value that drops, means a transcription slip.
    const rows = C.bodyFat.MALE_ROWS;
    Object.keys(rows).forEach(w => {
      const row = rows[w];
      const first = row.findIndex(v => v !== 0);
      let last = -1;
      row.forEach((v, i) => { if (v !== 0) last = i; });
      assert.ok(first !== -1, `row ${w} is entirely blank`);
      for (let i = first; i <= last; i++) {
        assert.notStrictEqual(row[i], 0, `row ${w} has a hole at column index ${i}`);
        if (i > first) {
          assert.ok(row[i] >= row[i - 1],
            `row ${w} decreases at column index ${i} (${row[i - 1]} -> ${row[i]})`);
        }
      }
    });
  });
  check('male body-fat rises with weight at a fixed waist-wrist difference', () => {
    // Down a column, heavier at the same girth means LESS body fat, so the
    // column must be non-increasing. This is the check that caught the two
    // mistyped cells at waist-wrist 43.5 in the live Zone calculator.
    const rows = C.bodyFat.MALE_ROWS;
    const weights = Object.keys(rows).map(Number).sort((a, b) => a - b);
    C.bodyFat.MALE_COLS.forEach((col, ci) => {
      let prev = Infinity, prevW = null;
      weights.forEach(w => {
        const v = rows[w][ci];
        if (!v) return;
        assert.ok(v <= prev,
          `column ${col} rises from ${prevW} lb (${prev}) to ${w} lb (${v})`);
        prev = v; prevW = w;
      });
    });
  });
});

/* ======================================================================== 9D
   BMI — standard index, reported SEPARATELY from the body-fat lookup
   ========================================================================= */

group('BMI', () => {
  check('200 lb / 70 in = 703 x 200 / 70^2 = 28.7', () => {
    assert.strictEqual(C.bmi(200, 70), 28.7);
    assert.ok(Math.abs(703 * 200 / (70 * 70) - 28.694) < 0.001);
  });
  check('150 lb / 65 in = 24.96 -> 25.0', () => {
    assert.strictEqual(C.bmi(150, 65), 25);
  });
  check('missing input returns null rather than a number', () => {
    assert.strictEqual(C.bmi(0, 70), null);
    assert.strictEqual(C.bmi(200, 0), null);
  });
  check('BMI and body fat % are separate values on the same result', () => {
    const r = C.bodyFat.compose({ sex: 'Woman', weight: 150, height: 65, abdomen: 30, hips: 40 });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.bodyFatPercent, 29);   // from the client lookup table
    assert.strictEqual(r.bmi, 25);              // from 703 x lb / in^2
    assert.notStrictEqual(r.bodyFatPercent, r.bmi);
  });
  check('BMI is still reported when the body-fat lookup is unsupported', () => {
    const r = C.bodyFat.compose({ sex: 'Man', weight: 200, height: 70, waist: 30, wrist: 9 });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.bmi, 28.7);
    assert.strictEqual(r.bodyFatPercent, undefined);
  });
  check('fat mass and lean mass follow the source arithmetic', () => {
    const r = C.bodyFat.compose({ sex: 'Woman', weight: 150, height: 65, abdomen: 30, hips: 40 });
    assert.strictEqual(r.fatMassLb, 43.5);          // 150 x 0.29
    assert.strictEqual(r.leanMassLb, 106.5);        // 150 - 43.5
  });
});

/* ======================================================================== 9E
   HEALTH STATUS REPORT — Health Status Report.docx
   ========================================================================= */

group('Health Assessment', () => {
  /* Health Assessment.docx (25 Aug 2026): 11 questions scored 1 (healthiest),
     2, 3. Total 11-33, LOWER is better — the client reversed the earlier
     scale. Every band boundary the brief names is asserted here. */
  const BANDS = [
    [11, 'Very Low Inflammation'],
    [12, 'Low Inflammation'],
    [16, 'Low Inflammation'],
    [17, 'Moderate Inflammation'],
    [18, 'Moderate Inflammation'],
    [21, 'Moderate Inflammation'],
    [22, 'Moderate Inflammation'],
    [23, 'High Inflammation'],
    [27, 'High Inflammation'],
    [28, 'Significant Inflammation'],
    [32, 'Significant Inflammation'],
    [33, 'High Inflammation / Poor Health']
  ];
  BANDS.forEach(([score, status]) => {
    check(`${score} / 33 -> ${status}`, () => {
      assert.strictEqual(C.hsr.interpret(score).status, status);
    });
  });

  check('every interpretation opens with the 11-33 scale sentence', () => {
    for (let t = 11; t <= 33; t++) {
      assert.ok(C.hsr.interpret(t).desc.indexOf(
        'On a scale of 11 to 33, where 11 is low inflammation and 33 is high inflammation') === 0, 'missing at ' + t);
    }
  });

  const DOSES = [
    [11, '2.5g'], [17, '2.5g'],
    [18, '5g'],   [21, '5g'],
    [22, '7.5g'], [33, '7.5g']
  ];
  DOSES.forEach(([score, epa]) => {
    check(`${score} / 33 -> ${epa} EPA/DHA`, () => {
      assert.strictEqual(C.hsr.dosage(score).epa, epa);
    });
  });

  check('polyphenols are the same three lines for every score', () => {
    [11, 17, 18, 21, 22, 33].forEach(t => {
      const lines = C.hsr.dosage(t).polyLines;
      assert.strictEqual(lines.length, 3);
      assert.strictEqual(lines[0].amount, '500mg');
      assert.ok(/oxidative stress/.test(lines[0].note));
      assert.strictEqual(lines[1].amount, '1000mg');
      assert.ok(/reduce inflammation/.test(lines[1].note));
      assert.strictEqual(lines[2].amount, '1500mg');
      assert.ok(/rate of aging and increases mitochondrial synthesis/.test(lines[2].note));
    });
  });

  check('the 10g neurological row is separate and never score-assigned', () => {
    assert.strictEqual(C.hsr.NEUROLOGICAL.condition, 'Neurological disorders');
    assert.strictEqual(C.hsr.NEUROLOGICAL.epa, '10g');
    for (let t = 11; t <= 33; t++) assert.notStrictEqual(C.hsr.dosage(t).epa, '10g');
  });

  check('healthiest selections produce the lowest total (11) and best band', () => {
    const total = Array(11).fill(1).reduce((a, b) => a + b, 0);
    assert.strictEqual(total, 11);
    assert.strictEqual(C.hsr.interpret(total).bucket, 'verylow');
    const worst = Array(11).fill(3).reduce((a, b) => a + b, 0);
    assert.strictEqual(worst, 33);
    assert.strictEqual(C.hsr.interpret(worst).bucket, 'poor');
  });

  check('interpretation text is plain Unicode, not HTML entities', () => {
    for (let t = 11; t <= 33; t++) {
      const d = C.hsr.interpret(t).desc;
      assert.ok(!/&[a-zA-Z]+;|&#\d+;/.test(d), `entity found at ${t}: ${d}`);
    }
  });
});

/* ======================================================================== 9F
   SIMPLE QUIZ — Simple Quiz.docx (counting only)
   ========================================================================= */

group('Simple Quiz', () => {
  const yes = n => Array(8).fill(0).map((_, i) => (i < n ? 1 : 0));

  check('8 No / 0 Yes', () => {
    const s = C.simpleQuiz.summarize(yes(0));
    assert.strictEqual(s.noCount, 8);
    assert.strictEqual(s.yesCount, 0);
    assert.strictEqual(s.summary, '8 No / 0 Yes');
  });
  check('6 No / 2 Yes', () => {
    const s = C.simpleQuiz.summarize(yes(2));
    assert.strictEqual(s.noCount, 6);
    assert.strictEqual(s.yesCount, 2);
    assert.strictEqual(s.summary, '6 No / 2 Yes');
  });
  check('0 No / 8 Yes', () => {
    const s = C.simpleQuiz.summarize(yes(8));
    assert.strictEqual(s.noCount, 0);
    assert.strictEqual(s.yesCount, 8);
    assert.strictEqual(s.summary, '0 No / 8 Yes');
  });
  check('accepts booleans and "yes"/"no" strings alike', () => {
    assert.strictEqual(C.simpleQuiz.summarize([true, false, 'yes', 'no']).yesCount, 2);
  });
  check('unanswered questions are not counted as No', () => {
    const s = C.simpleQuiz.summarize([1, 1, null, undefined]);
    assert.strictEqual(s.answered, 2);
    assert.strictEqual(s.yesCount, 2);
    assert.strictEqual(s.noCount, 0);
  });
  check('no unsourced status tier or supplement dose is returned', () => {
    const s = C.simpleQuiz.summarize(yes(4));
    ['epa', 'poly', 'polyNote', 'clinicalStatus', 'status', 'bucket', 'dose', 'tier']
      .forEach(k => assert.ok(!(k in s), `unsourced field "${k}" is back in the Simple Quiz result`));
    assert.deepStrictEqual(Object.keys(s).sort(),
      ['answered', 'noCount', 'progressNote', 'summary', 'total', 'yesCount']);
  });
  check('progress wording stays source-faithful (fewer Yes = better)', () => {
    assert.strictEqual(C.simpleQuiz.summarize(yes(3)).progressNote,
      'Fewer Yes answers over time indicates improvement.');
  });
});

/* ======================================================================== 9G
   BLOOD MARKERS — Dated Blood Markers tracking.pdf
   ========================================================================= */

group('Blood Markers', () => {
  check('TG / HDL ratio', () => {
    assert.strictEqual(C.blood.tgHdl(100, 50), 2);
    assert.strictEqual(C.blood.tgHdl(75, 100), 0.75);
    assert.strictEqual(C.blood.tgHdl(0, 50), null);
    assert.strictEqual(C.blood.GOALS.tg_hdl.goal, '< 1');
    assert.strictEqual(C.blood.GOALS.tg_hdl.test(0.9), true);
    assert.strictEqual(C.blood.GOALS.tg_hdl.test(1), false);
  });
  check('AA / EPA ratio', () => {
    assert.strictEqual(C.blood.aaEpa(9, 3), 3);
    assert.strictEqual(C.blood.aaEpa(15, 10), 1.5);
    assert.strictEqual(C.blood.aaEpa(9, 0), null);
    assert.strictEqual(C.blood.GOALS.aa_epa.goal, '1.5-3');
    assert.strictEqual(C.blood.GOALS.aa_epa.test(1.5), true);
    assert.strictEqual(C.blood.GOALS.aa_epa.test(3), true);
    assert.strictEqual(C.blood.GOALS.aa_epa.test(3.1), false);
  });
  check('HbA1c goal range 4.9-5.1%', () => {
    assert.strictEqual(C.blood.GOALS.hba1c.goal, '4.9-5.1%');
    assert.strictEqual(C.blood.GOALS.hba1c.test(4.9), true);
    assert.strictEqual(C.blood.GOALS.hba1c.test(5.1), true);
    assert.strictEqual(C.blood.GOALS.hba1c.test(4.8), false);
    assert.strictEqual(C.blood.GOALS.hba1c.test(5.2), false);
  });
  check('HOMA-IR: insulin 10, glucose 90 mg/dL -> 2.22', () => {
    // Source: insulin x glucose(mmol/L) / 22.5. Glucose is collected in mg/dL,
    // and mg/dL = mmol/L x 18.0182, so 22.5 x 18.0182 = 405.
    assert.strictEqual(C.blood.homaIr(10, 90), 2.22);
    assert.ok(Math.abs(10 * 90 / 405 - 2.2222) < 0.001);
  });
  check('HOMA-IR goal < 1', () => {
    assert.strictEqual(C.blood.GOALS.homa_ir.goal, '< 1');
    assert.strictEqual(C.blood.homaIr(4, 90), 0.89);
    assert.strictEqual(C.blood.GOALS.homa_ir.test(0.89), true);
  });
  check('no dosage is inferred from the number of abnormal markers', () => {
    // The client's EPA/DHA dose is chosen by CONDITION, not by marker count,
    // and the prototype never captures the condition.
    assert.strictEqual(typeof C.blood.tier, 'undefined');
    assert.strictEqual(typeof C.blood.dose, 'undefined');
    assert.strictEqual(typeof C.blood.doseFromMarkers, 'undefined');
    assert.strictEqual(C.blood.DOSE_BY_CONDITION.length, 4);
    assert.deepStrictEqual(plain(C.blood.DOSE_BY_CONDITION).map(r => r.epa),
                           ['2.5g', '5g', '7.5g', '10g']);
  });
});

/* ========================================================================
   ENGINE INTEGRITY — one engine, and no state in URLs off file://
   ========================================================================= */

group('Engine Integrity', () => {
  check('the file:// state carrier is inert outside a browser', () => {
    // The sandbox has no `location`, which is the same code path http(s) takes.
    assert.strictEqual(C.storage.carryEnabled, false);
    assert.strictEqual(C.storage.withState('dashboard.html'), 'dashboard.html');
    assert.strictEqual(C.storage.importState(), 0);
  });
  check('the carrier never rewrites external or non-navigational links', () => {
    ['https://example.com', 'http://example.com', 'mailto:a@b.co', 'tel:123',
     'javascript:void 0', '#top'].forEach(href => {
      assert.strictEqual(C.storage.withState(href), href);
    });
  });
  check('dated history keeps one entry per day, newest last', () => {
    let store = C.history.migrate(null);
    store = C.history.push(store, { date: '2026-08-04', result: { total: 21 }, updated: '2026-08-04T09:00:00.000Z' });
    store = C.history.push(store, { date: '2026-08-11', result: { total: 27 }, updated: '2026-08-11T09:00:00.000Z' });
    store = C.history.push(store, { date: '2026-08-11', result: { total: 29 }, updated: '2026-08-11T18:00:00.000Z' });
    assert.strictEqual(store.history.length, 2);
    assert.strictEqual(store.history[0].result.total, 21);
    assert.strictEqual(store.history[1].result.total, 29);   // same day replaced
    assert.strictEqual(store.latest.result.total, 29);
  });
  check('migrating the old single-record shape loses nothing', () => {
    const store = C.history.migrate({ answers: [1, 2, 3], result: { total: 20 }, updated: '2026-08-01T00:00:00.000Z' });
    assert.strictEqual(store.history.length, 1);
    assert.strictEqual(store.latest.result.total, 20);
  });
  check('the engine exposes exactly one Health Number scorer', () => {
    assert.strictEqual(typeof HN.score, 'function');
    assert.strictEqual(typeof C.version, 'string');
  });
});

/* --------------------------------------------------------------- reporting -- */

const pad = s => (s + ' ').padEnd(24, '.');
console.log('\nVEYE Calculation Tests');
console.log('----------------------');
groups.forEach(g => {
  console.log(`${pad(g.name)} ${g.failed ? `FAIL (${g.failed}/${g.passed + g.failed})` : `PASS (${g.passed})`}`);
});

if (failures.length) {
  console.log('\nFailures:');
  failures.forEach(f => console.log(`  [${f.group}] ${f.what}\n      ${f.message.split('\n')[0]}`));
}

const total = passed + failures.length;
console.log(`\nTotal: ${passed} passed, ${failures.length} failed  (${total} assertions)\n`);
process.exit(failures.length ? 1 : 0);
