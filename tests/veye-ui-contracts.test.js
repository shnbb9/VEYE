/* ============================================================================
   VEYE — UI contract tests                               PERMANENT PROJECT CODE
   ----------------------------------------------------------------------------
   Run:   node tests/veye-ui-contracts.test.js
   Exit:  0 = all assertions passed, 1 = at least one failed.

   Built-in `fs` and `assert` only — no dependencies, no browser, no install.

   These are CONTRACT and REGRESSION checks on the markup and wiring, not layout
   checks. Nothing here measures a pixel. Each one pins a specific mistake that
   has actually happened in this prototype, so a later edit cannot quietly undo
   the fix:

     A  onboarding's static progress metadata drifting from the 12 canonical
        Health Number questions (it said 1/9 and aria-valuemax="9")
     B  the auth forms submitting by GET and putting `password` in the URL
     C  auth.js not intercepting that submit
     D  switchView('food-diary') calling the retired renderFoodDiary(), which
        threw on a null #diaryDate every time the view opened
     E  the approved five-column Food Diary DOM going missing
     F  a second Health Number scoring table reappearing in dashboard.html
     G  a page in the cross-screen flow not loading the calculation engine

   Scoring VALUES are not tested here — that is tests/veye-calculations.test.js.
   ========================================================================== */

'use strict';

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');

const ROOT  = path.join(__dirname, '..');
const BUILD = path.join(ROOT, 'build');
const read  = rel => fs.readFileSync(path.join(BUILD, rel), 'utf8');

const HTML = {
  index:      read('index.html'),
  onboarding: read('onboarding.html'),
  signup:     read('signup.html'),
  login:      read('login.html'),
  dashboard:  read('dashboard.html')
};
const JS = {
  auth: read(path.join('js', 'auth.js')),
  quiz: read(path.join('js', 'quiz.js'))
};

/* ---------------------------------------------------------------- harness -- */

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
  try { fn(); passed++; currentGroup.passed++; }
  catch (err) { currentGroup.failed++; failures.push({ group: currentGroup.name, what, message: err.message }); }
}

/** dashboard.html is one 350 KB file; most checks only care about its script. */
const DASH_SCRIPT = (() => {
  const m = HTML.dashboard.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(m, 'dashboard.html has no inline <script> block');
  return m[1];
})();

/** …and the visual-fidelity checks only care about its stylesheet. */
const DASH_STYLE = (HTML.dashboard.match(/<style>([\s\S]*?)<\/style>/g) || []).join('\n');

/* ======================================================================== A
   ONBOARDING PROGRESS METADATA
   ========================================================================= */

group('A · Onboarding progress', () => {
  check('progressbar advertises 12 canonical questions', () => {
    assert.ok(/aria-valuemax="12"/.test(HTML.onboarding),
      'onboarding.html must carry aria-valuemax="12"');
    assert.ok(!/aria-valuemax="9"/.test(HTML.onboarding),
      'the stale aria-valuemax="9" is back');
  });
  check('static count reads 1/12 before any script runs', () => {
    const m = HTML.onboarding.match(/id="quizCount"[^>]*>([^<]*)</);
    assert.ok(m, 'no #quizCount element in onboarding.html');
    assert.strictEqual(m[1].trim(), '1/12');
  });
  check('aria-valuemin and aria-valuenow still start at 1', () => {
    assert.ok(/aria-valuemin="1"/.test(HTML.onboarding));
    assert.ok(/aria-valuenow="1"/.test(HTML.onboarding));
  });
  check('the runtime total is 12 and matches the markup', () => {
    const m = JS.quiz.match(/var TOTAL = (\d+)/);
    assert.ok(m, 'quiz.js no longer declares TOTAL');
    assert.strictEqual(m[1], '12');
  });
  check('quiz.js still declares exactly 12 canonical hn questions', () => {
    const hn = JS.quiz.match(/hn: \[[^\]]+\]/g) || [];
    const numbers = new Set();
    hn.forEach(h => h.replace(/\d+/g, n => numbers.add(Number(n))));
    assert.deepStrictEqual([...numbers].sort((a, b) => a - b),
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });
  check('BMI stays outside onboarding and remains available in My Progress', () => {
    // Functional Edits (1), explicitly confirmed by the user on 10 Sep 2026.
    // The old assertion deliberately preserved BMI and is now superseded.
    const bmiDecls = JS.quiz.match(/\{ id: 'bmi(Intro)?',[^\n]*/g) || [];
    assert.strictEqual(bmiDecls.length, 0, 'BMI must not return to the onboarding route list');
    assert.ok(!/qs\.has\('bmi'\)/.test(JS.quiz), 'the old BMI URL shortcut must not reactivate it');
    assert.ok(!/persistBodyComposition\(\);/.test(JS.quiz), 'onboarding must not write body-composition records');
    assert.ok(/id="view-bmi"/.test(HTML.dashboard), 'retain the separate Body Composition screen');
    assert.ok(/function initBmi\(/.test(HTML.dashboard), 'retain the Body Composition interaction');
    assert.ok(/countEl\.textContent = n \+ '\/' \+ TOTAL/.test(JS.quiz), 'show canonical question progress');
  });
});

/* ======================================================================== B+C
   AUTH — no credentials in the URL
   ========================================================================= */

/** Every <input> tag in a page, as raw tag source. */
function inputTags(src) { return src.match(/<input\b[^>]*>/g) || []; }

group('B+C · Auth submission', () => {
  // The forms keep method="get" as a no-JS fallback. A form control with no
  // `name` is never serialized (HTML spec: it is not a submittable "entry"), so
  // stripping the name makes the URL leak STRUCTURALLY impossible rather than
  // relying on auth.js loading and calling preventDefault().
  check('login.html password input has no serializable name attribute', () => {
    const pw = inputTags(HTML.login).filter(t => /type="password"/.test(t));
    assert.strictEqual(pw.length, 1, 'expected exactly one password field on login.html');
    assert.ok(!/\bname\s*=/.test(pw[0]),
      'the login password input must carry no name attribute:\n' + pw[0]);
  });
  check('signup.html password and confirm inputs have no serializable name attributes', () => {
    const pw = inputTags(HTML.signup).filter(t => /type="password"/.test(t));
    assert.strictEqual(pw.length, 2, 'expected password + confirm password on signup.html');
    pw.forEach(tag => assert.ok(!/\bname\s*=/.test(tag),
      'a signup password input still carries a name attribute:\n' + tag));
  });
  check('no field named password or confirmPassword survives on either form', () => {
    ['signup', 'login'].forEach(page => {
      assert.ok(!/name="(password|confirmPassword)"/.test(HTML[page]),
        `${page}.html can still serialize a password into the URL`);
    });
  });
  check('the visible password fields are otherwise untouched', () => {
    const all = inputTags(HTML.signup).concat(inputTags(HTML.login))
      .filter(t => /type="password"/.test(t));
    assert.strictEqual(all.length, 3);
    all.forEach(tag => {
      assert.ok(/autocomplete="(current|new)-password"/.test(tag), 'autocomplete was dropped: ' + tag);
      assert.ok(/placeholder="/.test(tag), 'placeholder was dropped: ' + tag);
      assert.ok(/class="field__input"/.test(tag), 'styling class was dropped: ' + tag);
    });
    ['signup', 'login'].forEach(page =>
      assert.ok(/class="field__eye"/.test(HTML[page]), `${page}.html lost its show/hide password button`));
  });
  check('the fields auth.js does read are still named', () => {
    ['email'].forEach(n => assert.ok(/name="email"/.test(HTML.login) && /name="email"/.test(HTML.signup),
      `name="${n}" is required by auth.js`));
    ['firstName', 'lastName'].forEach(n =>
      assert.ok(new RegExp(`name="${n}"`).test(HTML.signup), `signup.html needs name="${n}"`));
  });

  ['signup', 'login'].forEach(page => {
    check(`${page}.html password fields are never persisted or forwarded`, () => {
      const src = HTML[page];
      assert.ok(/type="password"/.test(src), `${page}.html should still have a password field`);
      // no inline handler may forward the value anywhere
      assert.ok(!/localStorage\.setItem[^)]*password/i.test(src));
      assert.ok(!/sessionStorage\.setItem[^)]*password/i.test(src));
    });
    check(`${page}.html loads auth.js so the submit is intercepted`, () => {
      assert.ok(/<script src="js\/auth\.js(\?v=\d+)?"[^>]*>/.test(HTML[page]),
        `${page}.html must load js/auth.js`);
    });
  });

  check('auth.js intercepts prototype auth submission', () => {
    assert.ok(/\.auth__form\[data-auth\]/.test(JS.auth), 'auth.js no longer binds the auth forms');
    assert.ok(/addEventListener\('submit'/.test(JS.auth), 'no submit listener in auth.js');
    assert.ok(/preventDefault\(\)/.test(JS.auth),
      'auth.js must preventDefault() — a GET submit puts the password in the URL');
  });
  check('auth.js navigates through the storage-aware helper', () => {
    assert.ok(/storage\.navigate\(/.test(JS.auth),
      'navigation must go through VeyeCalculations.storage.navigate() for the file:// carrier');
    assert.ok(/go\('dashboard\.html'\)/.test(JS.auth), 'auth.js should navigate to dashboard.html');
  });
  check('auth.js never reads or stores a password value', () => {
    // Comments are allowed to say the word; only executable lines are checked.
    // The one legitimate mention in code is the show/hide toggle's input.type.
    const code = JS.auth.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l));
    const offenders = code.filter(l =>
      /password/i.test(l) && !/input\.type|aria-label/.test(l));
    assert.deepStrictEqual(offenders, [],
      'auth.js touches a password outside the visibility toggle:\n' + offenders.join('\n'));
    assert.ok(!/confirmPassword/.test(code.join('\n')),
      'auth.js must not read confirmPassword');
  });
  check('auth.js stores only identity metadata in veye_user', () => {
    const m = JS.auth.match(/var record = \{([\s\S]*?)\};/);
    assert.ok(m, 'expected the veye_user record literal in auth.js');
    assert.ok(!/password/i.test(m[1]), 'the veye_user record must never carry a password');
  });
  check('no password value is written to localStorage or sessionStorage anywhere', () => {
    // every setItem call across the auth pages and the shared scripts
    const sources = { 'auth.js': JS.auth, 'quiz.js': JS.quiz,
                      'signup.html': HTML.signup, 'login.html': HTML.login,
                      'dashboard.html': DASH_SCRIPT };
    Object.keys(sources).forEach(name => {
      const calls = sources[name].match(/(local|session)Storage\.setItem\([^;]*/g) || [];
      calls.forEach(c => assert.ok(!/password/i.test(c),
        `${name} writes something password-shaped to storage:\n  ${c.slice(0, 140)}`));
    });
  });
  check('remember-me behaviour is preserved', () => {
    assert.ok(/input\[name="remember"\]/.test(JS.auth), 'remember-me handling was dropped');
    assert.ok(/localStorage\.removeItem\('veye_user'\)/.test(JS.auth),
      'unticking Remember me must still clear veye_user');
  });
  check('dashboard.html reads no credential query parameters', () => {
    assert.ok(!/URLSearchParams|location\.search/.test(DASH_SCRIPT),
      'the dashboard must not depend on query parameters');
  });
});

/* ======================================================================== D+E
   FOOD DIARY — retired legacy code gone, approved table intact
   ========================================================================= */

group('D+E · Food Diary', () => {
  check("switchView('food-diary') no longer calls renderFoodDiary()", () => {
    const m = DASH_SCRIPT.match(/if \(viewKey === 'food-diary'\) \{([\s\S]{0,400}?)\}/);
    if (m) {
      assert.ok(!/renderFoodDiary\s*\(/.test(m[1]),
        "the retired renderFoodDiary() is being called again from switchView('food-diary')");
    }
  });
  check('the retired meal-logging implementation is gone', () => {
    const code = DASH_SCRIPT.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    ['function renderFoodDiary', 'function renderDiaryEntries', 'function updateDiaryDraft',
     'function loadDiary', 'function saveDiary', 'DIARY_TAGS =', "getElementById('diaryDate')",
     "getElementById('diaryWhat')", "getElementById('diarySlot')", "getElementById('diaryTags')"
    ].forEach(dead => assert.ok(!code.includes(dead), `legacy Food Diary code is back: ${dead}`));
  });
  check('the legacy veye_diary store is not written any more', () => {
    const code = DASH_SCRIPT.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    assert.ok(!/'veye_diary'/.test(code), 'the retired veye_diary key is back');
  });
  /* The five-column table was RETIRED on 20 Aug 2026 (client, Dashboard
     edits): the diary is a daily-entry experience now. These contracts pin the
     new screen and, crucially, the non-destructive migration of the old rows. */
  check('the daily-entry Food Diary DOM is present', () => {
    ['fdxWhat', 'fdxTime', 'fdxAdd', 'fdxDate', 'fdxMeals', 'fdxEmpty',
     'fdxSaveDay', 'fdxHistoryBtn', 'fdxFeedback', 'fdxFeelings'].forEach(id =>
      assert.ok(new RegExp(`id="${id}"`).test(HTML.dashboard), `#${id} is missing from dashboard.html`));
  });
  check('the required client wording is on the screen', () => {
    assert.ok(/Note the time, macronutrient content, and how you felt before you ate/.test(HTML.dashboard),
      'the supplied left/right blurb is missing');
    assert.ok(/No entries for the day, start logging in/.test(HTML.dashboard),
      'the supplied empty-state wording is missing');
    assert.ok(/Time you ate/.test(HTML.dashboard), 'the "Time you ate (required)" label is missing');
    assert.ok(/choose all that apply/.test(HTML.dashboard), 'the multi-select feelings prompt is missing');
  });
  check('the photo controls are honest In-Development placeholders', () => {
    const photo = HTML.dashboard.match(/<div class="fdx-photo">[\s\S]*?<\/div>\s*<\/div>/);
    assert.ok(photo, 'the photo block is missing');
    assert.ok(/disabled/.test(photo[0]), 'the photo controls must be disabled');
    assert.ok(/In Development/.test(photo[0]), 'the photo controls must say In Development');
  });
  check('the macro estimate is labelled as a prototype estimate, never AI', () => {
    assert.ok(/Prototype estimate from your description/.test(HTML.dashboard),
      'the macro estimate label is missing');
    assert.ok(/not a nutritional analysis or a live AI service/.test(HTML.dashboard),
      'the macro estimate must disclaim AI');
    assert.ok(/Prototype-generated feedback/.test(HTML.dashboard),
      'the feedback label is missing');
  });
  check('legacy table rows migrate non-destructively', () => {
    assert.ok(/store\.version !== 2/.test(DASH_SCRIPT), 'the version-2 migration gate is missing');
    assert.ok(/legacyRows/.test(DASH_SCRIPT), 'legacy rows are no longer carried');
    assert.ok(/Earlier diary entries/.test(HTML.dashboard),
      'the read-only legacy block is missing from History');
  });
  check('veye_food_diary storage is preserved', () => {
    assert.ok(/loadQuiz\('veye_food_diary'\)/.test(DASH_SCRIPT), 'Food Diary no longer loads its store');
    assert.ok(/saveQuiz\('veye_food_diary'/.test(DASH_SCRIPT), 'Food Diary no longer saves');
  });
});

/* ======================================================================== F
   ONE HEALTH NUMBER SCORER
   ========================================================================= */

group('F · Single scoring engine', () => {
  check('the dashboard questionnaire embeds no points or score members', () => {
    const m = DASH_SCRIPT.match(/const HEALTH_QUIZ_QUESTIONS = \[([\s\S]*?)\n  \];/);
    assert.ok(m, 'HEALTH_QUIZ_QUESTIONS not found in dashboard.html');
    const table = m[1];
    assert.ok(!/\bpoints\s*:/.test(table), 'a points: table is back in dashboard.html');
    assert.ok(!/\bscore\s*:/.test(table), 'a score: function is back in dashboard.html');
    assert.ok(!/\bweight\s*:/.test(table), 'a weight: table is back in dashboard.html');
  });
  check('the score comes from the shared engine only', () => {
    assert.ok(/VeyeCalculations\.healthNumber\.score\(/.test(DASH_SCRIPT),
      'the dashboard must score through VeyeCalculations.healthNumber.score()');
  });
  check('the undocumented 1.5x category rule stays deleted', () => {
    const code = DASH_SCRIPT.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    assert.ok(!/function categoryProfile/.test(code), 'categoryProfile() is back');
    assert.ok(!/\*\s*1\.5\b/.test(code), 'a 1.5x threshold is back in dashboard.html');
  });
  check('onboarding keeps no scoring table either', () => {
    assert.ok(!/points\s*:/.test(JS.quiz), 'quiz.js has grown a points table');
    assert.ok(/CALC\.healthNumber\.score\(/.test(JS.quiz),
      'quiz.js must score through the shared engine');
  });
});

/* ======================================================================== G
   CROSS-SCREEN STATE
   ========================================================================= */

group('G · Cross-screen wiring', () => {
  ['index', 'onboarding', 'signup', 'login', 'dashboard'].forEach(page => {
    check(`${page}.html loads the calculation engine`, () => {
      assert.ok(/<script src="js\/veye-calculations\.js(\?v=\d+)?"><\/script>/.test(HTML[page]),
        `${page}.html must load js/veye-calculations.js for cross-page state to survive`);
    });
  });
  check('the engine is loaded without defer where a page hydrates during parse', () => {
    // dashboard.html hydrates from its inline script, so the engine must already
    // be defined by then — a deferred engine would arrive too late.
    const m = HTML.dashboard.match(/<script src="js\/veye-calculations\.js[^"]*"([^>]*)>/);
    assert.ok(m, 'dashboard.html does not load the engine');
    assert.ok(!/defer|async/.test(m[1]), 'the engine must not be deferred on dashboard.html');
  });
  check('programmatic navigation goes through the storage helper', () => {
    assert.ok(/CALC\.storage\.navigate\('signup\.html'\)/.test(JS.quiz),
      'the onboarding result must navigate via the storage helper');
    assert.ok(/CALC\.storage\.navigate\('index\.html'\)/.test(JS.quiz),
      'the onboarding back-out must navigate via the storage helper');
  });
});

/* ======================================================================== H
   HONEST EMPTY STATES
   ========================================================================= */

group('H · Empty states', () => {
  check('no hardcoded sample update date is rendered', () => {
    assert.ok(!/'06\/24\/24'/.test(DASH_SCRIPT),
      'the Figma sample date "06/24/24" is being rendered as real user history');
  });
  check('unsaved modules read "Not started"', () => {
    assert.ok(/'Not started'/.test(DASH_SCRIPT) || /Not started/.test(DASH_SCRIPT),
      'progress modules with no saved data should say "Not started"');
  });
  check('the BMI card shows no invented measurements', () => {
    const code = DASH_SCRIPT.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    assert.ok(!/166 lbs/.test(code), "the sample weight 166 lbs is back on the BMI card");
    assert.ok(!/5\\' 11"/.test(code), "the sample height 5' 11\" is back on the BMI card");
    assert.ok(/bmiProgressViz\(bmiSaved\)/.test(code) &&
              /No body-fat trend recorded/.test(code) &&
              /bmi-card-pie-value">—</.test(code),
      'the BMI composition chart should show an honest empty state, not sample measurements');
  });

  /* --- E: the MAIN dashboard must not present its sample as a real score --- */
  const HEALTH_CARD = (() => {
    // The card is the first of Cara's restored three-column composition.
    const m = HTML.dashboard.match(/<div class="card health-card[^"]*"[\s\S]*?<!-- ============ COLUMN 2/);
    assert.ok(m, 'the main dashboard health card markup was not found');
    return m[0];
  })();

  check('the main dashboard markup ships no sample Health Number', () => {
    const badge = HEALTH_CARD.match(/<strong>([^<]*)<\/strong>/);
    assert.ok(badge, 'no score badge in the health card');
    assert.strictEqual(badge[1].trim(), '&mdash;',
      'the main dashboard health badge must start as an em dash, not a number');
    // Check VISIBLE text only: SVG path data legitimately contains "4.5", and
    // entities like &#10230; (the CTA arrow) are glyphs, not digits.
    const visible = HEALTH_CARD
      .replace(/<!--[\s\S]*?(-->|$)/g, ' ')     // comments
      .replace(/<[^>]*>/g, ' ')                 // tags, incl. all SVG attributes
      .replace(/&[a-zA-Z#0-9]+;/g, ' ')         // entities
      .replace(/\s+/g, ' ').trim();
    assert.ok(!/\d/.test(visible),
      'the main dashboard health card renders a number before anything is saved: ' + visible);
  });
  check('it ships no sample interpretation either', () => {
    assert.ok(/Complete the Health Number assessment to see your result\./.test(HEALTH_CARD),
      'the uncompleted-state copy is missing');
    assert.ok(!/moderately good health/.test(HEALTH_CARD),
      'the moderate-health interpretation is back as static markup');
  });
  check('it starts in the not-completed state before any script runs', () => {
    assert.ok(/class="card health-card[^"]* is-untaken/.test(HTML.dashboard),
      'the card must carry is-untaken as its pre-script default');
    assert.ok(/\.health-card\.is-untaken \.health-badge/.test(HTML.dashboard),
      'the muted not-completed badge style is missing');
  });
  check('the card and its route are preserved', () => {
    // The retake CTA was deliberately removed — dash1a's Health Number card is
    // title + badge + interpretation with no button. The route must still exist,
    // so the score area itself has to stay a real, wired button.
    assert.ok(/id="dashHealthBadge"/.test(HEALTH_CARD), 'the clickable score area was removed');
    assert.ok(/<button[^>]*id="dashHealthBadge"/.test(HEALTH_CARD),
      'the score area must remain a real button now that the CTA is gone');
    assert.ok(/getElementById\('dashHealthBadge'\)\?\.addEventListener\('click'/.test(DASH_SCRIPT),
      'the score area lost its handler — the assessment would be unreachable from this card');
    assert.ok(/openSubView\('quiz-health'/.test(DASH_SCRIPT), 'the quiz-health route was removed');
  });

  /* --- F: a real saved Health Number must still hydrate the card ----------- */
  check('a real Health Number still hydrates the main dashboard', () => {
    const m = DASH_SCRIPT.match(/const hn = resolveHealthSource\(\);[\s\S]*?healthCard\.classList\.toggle/);
    assert.ok(m, 'the dashboard hydration block was not found');
    const block = m[0];
    assert.ok(/const taken = hn\.number !== null/.test(block), 'the taken/untaken test was removed');
    assert.ok(/if \(taken\)/.test(block), 'hydration no longer branches on whether a score exists');
    assert.ok(/countUpTo\(numEl, displayNumber\)/.test(block),
      'the real Health Number is no longer written to the badge');
    assert.ok(/descEl\.textContent = hn\.info\.desc/.test(block),
      'the real interpretation is no longer written to the card');
    assert.ok(/numEl\.textContent = '—'/.test(block), 'the uncompleted badge state is missing');
  });
  check('the shared resolver is still the single source for both screens', () => {
    const calc = read(path.join('js', 'veye-calculations.js'));
    assert.ok(/function resolveHealthSource/.test(DASH_SCRIPT), 'the resolver was removed');
    assert.ok(/healthNumber\.readRecord\(\)/.test(DASH_SCRIPT),
      'the dashboard no longer delegates to the shared Health Number record');
    assert.ok(/source: 'Not taken'/.test(calc), 'the shared record lost its explicit Not-taken state');
    assert.ok(/source: 'Onboarding'/.test(calc) && /'Health quiz'/.test(calc),
      'the shared record lost one of its real source labels');
  });
});

/* ======================================================================== I
   DASHBOARD VISUAL-FIDELITY CONTRACTS
   The reference captures live in build/assets/web/wp/. These pin the decisions
   made against them, not pixel positions.
   ========================================================================= */

group('I · Dashboard fidelity', () => {
  /* --- view headings must not inherit the Dashboard greeting's style ------ */
  /** Last matching rule wins in the cascade, and .welcome h1 is declared twice
   *  (a base rule high up, then the parity override). Take the effective one. */
  const lastRule = re => {
    const all = DASH_STYLE.match(new RegExp(re.source + '\\s*\\{([\\s\\S]*?)\\}', 'g')) || [];
    if (!all.length) return null;
    return all[all.length - 1].match(/\{([\s\S]*)\}/)[1];
  };
  const WELCOME_RULE = lastRule(/\.welcome h1/);
  const VIEW_RULE = lastRule(/\.progress-hero h1, \.mood-hero h1, \.bot-hero h1, \.diary-hero h1,\s*\.fc-overview-title/);

  check('the Dashboard greeting keeps its larger Kumbh Sans heading', () => {
    assert.ok(WELCOME_RULE, '.welcome h1 has no rule of its own');
    assert.ok(/Kumbh Sans/.test(WELCOME_RULE), '"Welcome back Cara" lost its Kumbh Sans face');
    assert.ok(/font-size:\s*30px/.test(WELCOME_RULE), '"Welcome back Cara" is no longer 30px');
  });
  check('My Progress and Food Choices headings do NOT inherit it', () => {
    assert.ok(VIEW_RULE, 'the shared view-heading rule was not found');
    assert.ok(!/Kumbh Sans/.test(VIEW_RULE), 'a view heading is back on Kumbh Sans');
    assert.ok(!/font-size:\s*30px/.test(VIEW_RULE), 'a view heading is back at 30px');
    assert.ok(/font-family:\s*'Teachers'/.test(VIEW_RULE), 'view headings should be Teachers');
    assert.ok(/font-size:\s*22px/.test(VIEW_RULE), 'view headings should be 22px');
    // and the greeting must not be back inside that selector list
    assert.ok(!/\.progress-hero h1[^{]*\.welcome h1[^{]*\{/.test(DASH_STYLE),
      '.welcome h1 has been grouped back in with the small view headings');
  });

  /* --- Food Choices manager override ------------------------------------- */
  check('Food Choices keeps the manager-approved reduced card geometry', () => {
    const grid = DASH_STYLE.match(/\.fc-overview-grid \{([\s\S]*?)\}/);
    assert.ok(grid, '.fc-overview-grid rule not found');
    const m = grid[1].match(/max-width:\s*(\d+)px/);
    assert.ok(m, 'the grid has no max-width');
    const width = Number(m[1]);
    assert.ok(width >= 900 && width <= 980,
      `grid max-width ${width}px is outside the approved ~940px band; the WordPress 1020px geometry was rejected as too big`);
    assert.ok(/repeat\(2, minmax\(0, 1fr\)\)/.test(grid[1]),
      'the 2-column grid should stay responsive via minmax(0,1fr), not fixed widths');
  });
  check('Food Choices illustrations are contained, never cropped', () => {
    const img = DASH_STYLE.match(/\.fc-tile-illu img \{([\s\S]*?)\}/);
    assert.ok(img, '.fc-tile-illu img rule not found');
    assert.ok(/object-fit:\s*contain/.test(img[1]), 'illustrations must use contain, not cover');
    assert.ok(/max-width:\s*100%/.test(img[1]), 'illustrations must be width-contained');
  });
  check('the Fats card does NOT repeat the Proteins paragraph', () => {
    const tiles = HTML.dashboard.match(/<article class="fc-card-tile"[\s\S]*?<\/article>/g) || [];
    assert.strictEqual(tiles.length, 4, 'expected four Food Choices tiles');
    const paras = tiles.map(t => (t.match(/<p>([\s\S]*?)<\/p>/) || [,''])[1].trim());
    assert.strictEqual(new Set(paras).size, 4,
      'two Food Choices cards share the same copy — the reference page duplicates the Proteins text under Fats and that must not be reproduced');
    assert.ok(/Healthy fats support hormones/.test(paras[1]),
      'the Fats card lost its fats-specific copy');
  });
  check('carbohydrate copy follows the reference wording', () => {
    assert.ok(/Carbohydrates are the energy source for the brain/.test(HTML.dashboard),
      'Favorable Carbohydrates is not on the reference wording');
    assert.ok(/enter the bloodstream quickly as sugar, and make the brain very happy/.test(HTML.dashboard),
      'Unfavorable Carbohydrates is not on the reference wording');
  });

  /* --- Food Diary daily-entry behaviour (client, 20 Aug 2026) -------------
     The reference five-column table was retired by the Dashboard-edits
     package; D+E pins the new screen's DOM and wording, this block pins the
     behaviour that keeps it honest. */
  check('the retired table implementation left nothing behind', () => {
    ['fd-table', 'fdEdit', 'fdBody', 'fdAddRow', 'fdTemplate', 'MIN_ROWS'].forEach(t =>
      assert.ok(!HTML.dashboard.includes(t), `${t} survived the daily-entry rebuild`));
  });
  check('the macro estimator is deterministic, never random', () => {
    const fn = DASH_SCRIPT.match(/function fdxEstimate\([\s\S]*?\n    \}/);
    assert.ok(fn, 'fdxEstimate is missing');
    assert.ok(!/Math\.random/.test(fn[0]),
      'the estimate must repeat exactly for the same description');
    assert.ok(/FDX_FOODS/.test(fn[0]), 'the fixed keyword table is no longer consulted');
  });
  check('the time of a meal is required before an entry saves', () => {
    assert.ok(/if \(!time\)/.test(DASH_SCRIPT), 'the required-time gate is gone');
    assert.ok(/The time you ate is required\./.test(DASH_SCRIPT),
      'the visible required-time message is gone');
  });
  check('the day summary declares its numbers as prototype estimates', () => {
    assert.ok(/\(prototype estimates\)/.test(DASH_SCRIPT),
      'the day summary lost its honesty label');
  });

  /* --- Activity Tracker (client, 20 Aug 2026) -----------------------------
     Exercise and Meditation are In Development; the third card splits into
     Overall Progress and Mood, hydrated from what the member actually saved.
     The invented heart-rate / steps / minutes figures must never return. */
  check('Exercise and Meditation read In Development, with no fake numbers', () => {
    assert.ok(/assets\/web\/img\/act-heart\.png/.test(HTML.dashboard),
      'the heart artwork was dropped');
    assert.ok(fs.existsSync(path.join(BUILD, 'assets', 'web', 'img', 'act-heart.png')),
      'act-heart.png is missing from the build');
    const indev = HTML.dashboard.match(/class="val val--indev">In Development</g) || [];
    assert.strictEqual(indev.length, 2, 'Exercise and Meditation must both read In Development');
    ['82', '1240', '25'].forEach(v =>
      assert.ok(!new RegExp(`<div class="val">${v}</div>`).test(HTML.dashboard),
        `the invented Activity value ${v} is back`));
  });
  check('the third card splits into Overall Progress and Mood on real data', () => {
    ['actProgressHalf', 'actProgressVal', 'actMoodHalf', 'actMoodVal'].forEach(id =>
      assert.ok(new RegExp(`id="${id}"`).test(HTML.dashboard), `#${id} is missing`));
    assert.ok(/function hydrateActivityRow/.test(DASH_SCRIPT),
      'the split card is no longer hydrated from saved data');
    assert.ok(!/id="actProgressVal">\s*\d/.test(HTML.dashboard) &&
              !/id="actMoodVal">\s*\d/.test(HTML.dashboard),
      'the split card ships a hardcoded number before any script runs');
  });

  /* --- approved sidebar modules ------------------------------------------ */
  check('the approved extra sidebar modules survive', () => {
    ['Veye Companion', 'Mood Tracker', 'Meal Planning'].forEach(label => {
      assert.ok(new RegExp(label, 'i').test(HTML.dashboard), `${label} was removed from the sidebar`);
    });
    // Comments are allowed to mention the old WordPress name; only rendered
    // markup and live CSS count.
    const live = HTML.dashboard.replace(/<!--[\s\S]*?-->/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');
    assert.ok(!/Veye Bot/.test(live), '"Veye Bot" is back — the approved name is Veye Companion');
  });
  check('the Subscription and DIY cards stay removed (client, 20 Aug 2026)', () => {
    const live = HTML.dashboard.replace(/<!--[\s\S]*?-->/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');
    assert.ok(!/Beta Site/.test(live), 'the Subscription card is back on the dashboard');
    assert.ok(!/class="[^"]*sub-tier/.test(live), 'the Subscription tier markup is back');
    assert.ok(!/DIY Follow Through|Get Your Notes/.test(live), 'the DIY card is back');
  });
  check('Contact Us and Help & FAQs remain in the requested right column', () => {
    assert.ok(/id="dashContactCard"[^>]*href="mailto:contact@veye\.co"/.test(HTML.dashboard),
      'Contact Us must be a real mailto link to contact@veye.co');
    assert.ok(/Help &amp; FAQs/.test(HTML.dashboard), 'the Help & FAQs card is missing');
    assert.ok(/help\.html/.test(DASH_SCRIPT), 'the FAQ card no longer reaches the FAQ page');
  });
});

/* ======================================================================== J
   CORRECTION PASS (21 Aug 2026) — CONSUMER
   Pins the tightly scoped corrections so a later edit cannot undo them:
   the fabricated 4.5 Health Number, the untaken-state parity between Home
   and My Progress, the Meal Planning naming, blood-marker accessible names,
    the unsourced Mindfulness scope copy, the tip honesty chips, the dashboard
    card-height regression, the expired offer state, and the restored
    (deliberately unused) activity assets.
   ========================================================================= */

group('J · Correction pass — consumer', () => {
  const LIVE = HTML.dashboard.replace(/<!--[\s\S]*?-->/g, ' ');

  check('resolveHealthSource manufactures no number', () => {
    const calc = read(path.join('js', 'veye-calculations.js'));
    assert.ok(/return \{ number: null, info: null, answers: \{\}, updated: null,[\s\S]*source: 'Not taken'/.test(calc),
      'the shared resolver no longer returns the honest null state');
    assert.ok(!/number: 4\.5/.test(DASH_SCRIPT), 'the fabricated 4.5 sample is back');
    assert.ok(!/interpretHealthNumber\(4\.5/.test(DASH_SCRIPT), 'a 4.5 interpretation is being calculated');
    assert.ok(!/src: 'Sample'/.test(DASH_SCRIPT), "the 'Sample' source label is back");
    assert.ok(!/4\.5\/10 = 45% filled/.test(HTML.dashboard), 'the stale 4.5 ring animation is back');
  });
  check('the dashboard uses Cara’s restored three-column composition', () => {
    assert.ok(/\.grid\s*\{[\s\S]*?align-items:\s*start;/.test(DASH_STYLE),
      'the dashboard grid can stretch the Health Number column again');
    assert.ok(/\.col--hn\s*\{[^}]*grid-column:\s*auto;/.test(DASH_STYLE),
      'the Health Number is spanning across the missing middle column again');
    assert.ok(/\.hn-anchor\s*\{[^}]*min-height:\s*430px;/.test(DASH_STYLE),
      'the desktop Health Number anchor has no bounded design height');
    assert.ok(/@media \(max-width: 1100px\)[\s\S]*?\.hn-anchor\s*\{\s*min-height:\s*0;\s*\}/.test(DASH_STYLE),
      'the bounded height is not released for smaller screens');
    assert.ok(/id="dashBetaCard"[\s\S]*?Join the Beta Test/.test(HTML.dashboard),
      'Cara’s replacement Beta Test card is missing');
    assert.ok(/src="assets\/web\/img\/ic-beta\.svg"/.test(HTML.dashboard),
      'the Beta Test title icon is missing');
    assert.ok(/id="dashCompanionCard"[\s\S]*?Veye Companion/.test(HTML.dashboard),
      'the Veye Companion card is missing from the middle column');
    assert.ok(/id="botSuggestDinnerBtn"[^>]*>Guided setup<\/button>/.test(HTML.dashboard),
      'the Guided setup action is missing');
    assert.ok(/id="botNotNowBtn"[^>]*>Explore on my own<\/button>/.test(HTML.dashboard),
      'the Explore on my own action is missing');
    assert.ok(/input\.value = 'Please guide me through the best next steps for my Veye plan\.'/i.test(DASH_SCRIPT),
      'Guided setup no longer seeds the Companion prompt');
    assert.ok(/flashToast\('Explore the dashboard at your own pace\.'\)/.test(DASH_SCRIPT),
      'Explore on my own no longer provides dashboard feedback');
  });
  check('fresh dashboard restores start at the top', () => {
    assert.ok(/history\.scrollRestoration = 'manual'/.test(DASH_SCRIPT), 'browser scroll restoration is still automatic');
    assert.ok(/pageshow[\s\S]*?resetDashboardScroll/.test(DASH_SCRIPT), 'file/session restoration does not reset the dashboard scroll');
  });
  check('the unapproved expired Resources promotion is not rendered', () => {
    assert.ok(!/res-promo/.test(HTML.dashboard), 'the unapproved promotion rail is still rendered');
    assert.ok(!/30% OFF|Redeem Offer|OFFER ENDS 06\/30\/24/.test(HTML.dashboard),
      'expired promotion copy is still visible');
    assert.ok(/Resources are in development\./.test(HTML.dashboard), 'the client-supplied Resources status is missing');
  });
  check('Home and My Progress key off the same null check', () => {
    assert.ok(/const taken = hn\.number !== null;/.test(DASH_SCRIPT), 'Home no longer keys off number !== null');
    assert.ok(/const taken = number !== null;/.test(DASH_SCRIPT), 'My Progress no longer keys off number !== null');
  });
  check('the untaken My Progress card is honest', () => {
    assert.ok(/Take the Health Number assessment to see your result and what it means\./.test(DASH_SCRIPT),
      'the invitation copy is missing');
    assert.ok(/'Not taken yet'/.test(DASH_SCRIPT), "the 'Not taken yet' status is missing");
    assert.ok(/'Not taken'/.test(DASH_SCRIPT), "the 'Not taken' chip is missing");
    assert.ok(/hn-card--\$\{taken \? info\.bucket : 'none'\}/.test(DASH_SCRIPT) &&
              /\.hn-card--none \.hn-card__num/.test(DASH_STYLE),
      'the muted untaken badge state is missing');
  });
  check('the former product name Your Days is not displayed', () => {
    // data-view="your-days" (a route id) and code comments are allowed; the
    // rendered words are not.
    assert.ok(/id="daysListTitle" hidden>Saved days</.test(HTML.dashboard),
      'the Meal Planning list heading is not "Saved days"');
    assert.ok(!/>Your [Dd]ays</.test(LIVE), 'the old "Your Days" name is rendered somewhere');
  });
  check('every blood-marker input has an explicit accessible name', () => {
    ['lab_tg', 'lab_hdl', 'lab_tg_hdl', 'lab_hba1c', 'lab_insulin',
     'lab_glucose', 'lab_homa', 'lab_aa', 'lab_epa', 'lab_aa_epa'].forEach(id => {
      assert.ok(new RegExp(`<label for="${id}"`).test(HTML.dashboard), `label[for=${id}] is missing`);
      assert.ok(new RegExp(`id="${id}" aria-label="[^"]{4,}"`).test(HTML.dashboard),
        `#${id} has no aria-label`);
    });
    assert.ok(/id="lab_tg_hdl" aria-label="[^"]*read-only[^"]*" readonly/.test(HTML.dashboard),
      'TG/HDL must stay read-only');
    assert.ok(/id="lab_homa" aria-label="[^"]*read-only[^"]*" readonly/.test(HTML.dashboard),
      'HOMA-IR must stay read-only');
    assert.ok(!/id="lab_aa_epa"[^>]*readonly/.test(HTML.dashboard), 'AA/EPA direct entry must stay editable');
  });
  check('the unsourced Mindfulness scope sentence is gone', () => {
    assert.ok(!/Guided practices, breathing sessions and mindful-eating tools/.test(HTML.dashboard),
      'the invented Mindfulness scope copy is back');
    assert.ok(/view-mindfulness[\s\S]*?In Development[\s\S]*?Under development &mdash; more coming\./.test(HTML.dashboard),
      'the Mindfulness card lost its client-supplied status wording');
  });
  check('both tips carry the Prototype preview chip', () => {
    const chips = HTML.dashboard.match(/class="tip-proto">Prototype preview</g) || [];
    assert.strictEqual(chips.length, 2, 'Daily Health tip and Personal tip must each carry the chip');
    assert.ok(/\.tip-proto \{/.test(DASH_STYLE), 'the chip has no style rule');
  });
  check('the meditation graphic is documented as provisional', () => {
    assert.ok(/PROVISIONAL ASSET/.test(HTML.dashboard),
      'the provisional-asset note on the meditation SVG is missing');
  });
  check('the restored activity assets exist untouched and unused', () => {
    ['act-walking.png', 'act-running.png'].forEach(f => {
      assert.ok(fs.existsSync(path.join(BUILD, 'assets', 'web', 'img', f)), `${f} is missing`);
      assert.ok(!new RegExp(f).test(HTML.dashboard), `${f} must stay unreferenced`);
    });
  });
  check('the stored keys the corrections touch are all still read', () => {
    const allConsumerJs = DASH_SCRIPT + '\n' + JS.quiz + '\n' + read(path.join('js', 'veye-calculations.js'));
    ['veye_health_quiz', 'veye_health_number', 'veye_quiz', 'veye_simple_quiz',
     'veye_food_diary', 'veye_moods', 'veye_blood', 'veye_bmi', 'veye_assessment',
     'veye_days'].forEach(k =>
      assert.ok(allConsumerJs.includes(`'${k}'`), `storage key ${k} is no longer used`));
  });

  check('Health Number writes and reads are canonical across both entry points', () => {
    const calc = read(path.join('js', 'veye-calculations.js'));
    assert.ok(/function saveHealthNumberRecord/.test(calc) && /function readHealthNumberRecord/.test(calc),
      'the canonical Health Number record helpers are missing');
    assert.ok(/CALC\.healthNumber\.saveRecord\(state, \{ source: 'onboarding' \}\)/.test(JS.quiz),
      'onboarding no longer writes through the canonical record');
    assert.ok(/healthNumber\.saveRecord\(canonicalAnswers/.test(DASH_SCRIPT),
      'the dashboard retake no longer writes through the canonical record');
    assert.ok(/veye_health_updated/.test(calc), 'the latest Health Number timestamp is not stored');
    assert.ok(/var displayNumber = Number\(hn\)\.toFixed\(1\)/.test(JS.quiz),
      'the onboarding result no longer uses the same one-decimal format as the dashboard');
  });

  check('Supplements and Fitness avoid misleading prototype layouts', () => {
    assert.ok(/\.sup-other \{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/.test(DASH_STYLE),
      'Other Supplements can collapse back into the empty image column');
    assert.ok(/\.sup-other \.sup-card__body \{[^}]*column-count:\s*2/.test(DASH_STYLE),
      'the long vitamin overview is no longer presented as readable columns');
    assert.ok(/Static preview/.test(HTML.dashboard) && /Video coming later/.test(HTML.dashboard),
      'Fitness no longer identifies the still artwork as a static preview');
    assert.ok(!/data-fit-preview=/.test(HTML.dashboard),
      'a static Fitness image is still presented as an interactive video control');
  });
});

/* ======================================================================== K
   CORRECTION PASS (21 Aug 2026) — ADMIN RUNTIME
   Static assertions over admin-panel/prototype-client: no user-facing
   "Health Status Report", no stale Coming-Soon claims for the four live
   sections, the Meal Planning rename, the accurate Food Diary description,
   and the honest prototype-to-production mapping wording.
   ========================================================================= */

group('K · Correction pass — admin', () => {
  const ADMIN = path.join(ROOT, 'admin-panel', 'prototype-client');
  const readA = rel => fs.readFileSync(path.join(ADMIN, rel), 'utf8');
  const stripComments = t => t.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const SCREENS = fs.readdirSync(path.join(ADMIN, 'js', 'screens')).filter(f => f.endsWith('.js'));
  const screenSrc = {};
  SCREENS.forEach(f => { screenSrc[f] = readA(path.join('js', 'screens', f)); });
  const MOCK = readA(path.join('js', 'mock-data.js'));
  const STATE = readA(path.join('js', 'state.js'));

  check('no user-facing admin string says Health Status Report', () => {
    SCREENS.forEach(f => {
      assert.ok(!stripComments(screenSrc[f]).includes('Health Status Report'),
        `${f} still shows "Health Status Report"`);
    });
    // mock-data may keep the historical source FILENAME only
    stripComments(MOCK).split('\n').forEach((line, i) => {
      if (line.includes('Health Status Report')) {
        assert.ok(line.includes('Health Status Report.docx'),
          `mock-data.js line ${i + 1} carries the old name outside a filename`);
      }
    });
  });
  check('member-360 renders the Health Assessment card', () => {
    assert.ok(/<h2 class="card__title">Health Assessment<\/h2>/.test(screenSrc['member-360.js']),
      'the member-360 card heading was not renamed');
    assert.ok(/Health Assessment results/.test(screenSrc['member-360.js']),
      'the screen-reader caption was not renamed');
  });
  check('no active screen claims the four live sections are Coming Soon', () => {
    SCREENS.forEach(f => {
      const src = stripComments(screenSrc[f]);
      assert.ok(!/Coming Soon to members/.test(src), `${f} still says Coming Soon to members`);
      assert.ok(!/held for Phase 2|locked for Phase 2/.test(src), `${f} still claims a Phase 2 hold`);
    });
    assert.ok(/live development sections\. Historical usage is not shown until sufficient activity exists\./.test(screenSrc['insights.js']),
      'Insights Engagement lost the honest live-sections wording');
  });
  check('the Meal Planning rename reached the admin runtime', () => {
    assert.ok(/name: 'Meal Planning'/.test(MOCK), 'FT-04 is not named Meal Planning');
    assert.ok(/'Meal Planning template: Balanced Start'/.test(MOCK), 'program steps still say Your Days');
    assert.ok(/label: 'Meal Planning', n: 1890/.test(MOCK), 'the engagement label still says Your Days');
    assert.ok(/Feed Meal Planning\./.test(MOCK), 'the whereShown row still says Your Days');
    assert.ok(/Templates feed <b>Meal Planning<\/b>/.test(screenSrc['care-studio.js']),
      'the Care Studio template explanation still says Your Days');
    [MOCK].concat(SCREENS.map(f => screenSrc[f])).forEach(src => {
      assert.ok(!/Your Days/.test(stripComments(src).replace(/your-days/g, '')),
        'an active admin string still says Your Days');
    });
  });
  check('the Food Diary feature description is accurate', () => {
    assert.ok(MOCK.includes("desc: 'Daily meal entries, time eaten, pre-meal feelings, notes, prototype macro estimates, daily summary and history.'"),
      'FT-05 does not describe the daily-entry diary');
    assert.ok(!/editable diary table and its export/.test(MOCK), 'the old table description is back');
  });
  check('member-effect claims use production wording', () => {
    SCREENS.forEach(f => {
      const src = stripComments(screenSrc[f]);
      assert.ok(!/Members see /.test(src.replace(/Members see nothing/g, '')),
        `${f} still claims a present-tense member effect`);
      assert.ok(!/straight away/.test(src), `${f} still says straight away`);
    });
    assert.ok(/Prototype mapping — the member app is not/.test(readA(path.join('js', 'app.js'))),
      'the Where-does-this-appear drawer lost its prototype-mapping note');
    const allScreens = SCREENS.map(f => screenSrc[f]).join('\n');
    assert.ok(!/Nothing left this prototype/.test(allScreens), 'the leaves/left wording regression is present');
    assert.ok((allScreens.match(/Nothing leaves this prototype/g) || []).length >= 3,
      'the three prototype-boundary confirmations are not present');
  });
  check('the mindfulness seed carries only the client-supplied status', () => {
    assert.ok(!/Guided practices, breathing sessions/.test(stripComments(MOCK)),
      'the invented Mindfulness scope copy is back in the seed');
  });
  check('MIG-8 migrates stored states to the corrected wording', () => {
    assert.ok(/MIG-8/.test(STATE), 'MIG-8 is missing');
    assert.ok(/'Your Days template:', 'Meal Planning template:'/.test(STATE),
      'stored program steps are not migrated');
    assert.ok(/Daily meal entries, time eaten, pre-meal feelings/.test(STATE),
      'stored FT-05 descriptions are not migrated');
    assert.ok(/mindfulness\.body = 'Under development — more coming\.'/.test(STATE),
      'stored mindfulness copy is not migrated');
  });
  check('admin assessment and care data match the current client sources', () => {
    assert.ok(/scale: 'Total of 11 to 33\. Lower is better/.test(MOCK),
      'admin Health Assessment still uses the old direction');
    assert.ok(/source: 'Health Assessment\.docx'/.test(MOCK),
      'admin Health Assessment source was not updated');
    assert.ok(/first scores 1, the second 2, and the third 3/.test(MOCK),
      'admin Health Assessment scoring is stale');
    assert.ok(/from: 11, to: 11[\s\S]*from: 33, to: 33/.test(MOCK),
      'admin Health Assessment bands are not in the current order');
    assert.ok(/Are you sleepy after meals\?/.test(MOCK) && /Do you suffer from painful arthritis\?/.test(MOCK),
      'admin Simple Quiz questions are stale');
    assert.ok(/Work day with morning exercise/.test(MOCK) && /Weekend day with morning exercise — Option 2/.test(MOCK),
      'admin Meal Planning templates do not match the supplied day documents');
    assert.ok(!/Magnesium glycinate|Seasonal vitamin D/.test(MOCK),
      'unsupported supplement guidance was reintroduced');
    assert.ok(/MIG-9/.test(STATE), 'the stale admin source migration is missing');
  });
});

/* ======================================================================== L
   CORRECTION PASS (28 Aug 2026) — CONSUMER
   Pins the client-feedback corrections of this pass: auth (optional
   phone/ZIP, privacy links, recovery flow), the Health Number majority/tie
   rule surfaces, the reversed Health Assessment, the mood Balance formula,
   marker-based blood suggestions with review states, custom-food tiers, the
   five sample day types, and the Companion welcome.
   ========================================================================= */

group('L · Correction pass (28 Aug) — consumer', () => {
  const PRIVACY = fs.readFileSync(path.join(BUILD, 'privacy.html'), 'utf8');
  const AUTHJS = read(path.join('js', 'auth.js'));
  const CALC = read(path.join('js', 'veye-calculations.js'));

  check('privacy.html exists as a clearly labelled draft', () => {
    assert.ok(/Privacy Policy/.test(PRIVACY), 'no title');
    assert.ok(/Draft — prototype content/.test(PRIVACY), 'the draft label is missing');
    assert.ok(/admin portal/.test(PRIVACY), 'the future admin-portal note is missing');
  });
  check('Privacy links open privacy.html; Terms links stay on terms.html', () => {
    [HTML.login, HTML.signup].forEach(h => {
      assert.ok(/<a href="privacy\.html">Privacy Policy<\/a>/.test(h), 'a Privacy link is wrong');
      assert.ok(/<a href="terms\.html">Terms and Conditions<\/a>/.test(h), 'a Terms link is wrong');
    });
    assert.ok(/found <a href="privacy\.html">here<\/a>/.test(read('terms.html')), 'terms §7 still self-links');
  });
  check('signup phone and ZIP are optional and never serialized', () => {
    assert.ok(/id="signupPhone"(?![^>]*name=)/.test(HTML.signup), 'phone gained a name or vanished');
    assert.ok(/id="signupZip"(?![^>]*name=)/.test(HTML.signup), 'zip gained a name or vanished');
    assert.ok(/\(optional\)/.test(HTML.signup), 'the optional labelling is gone');
  });
  check('the recovery dialog offers email, text and support — honestly', () => {
    ['data-pw="email"', 'data-pw="text"', 'data-pw="support"'].forEach(a =>
      assert.ok(HTML.login.includes(a), a + ' route is missing'));
    assert.ok(/no email or text message was actually\s+sent/.test(HTML.login),
      'the prototype disclaimer is missing');
    assert.ok(!/message was sent|has been sent/i.test(AUTHJS), 'auth.js claims a real send');
  });
  check('the Health Number classification is the majority/tie rule', () => {
    assert.ok(/tied high answers/.test(CALC), 'the tie rule is missing from the engine');
    assert.ok(/more high Lifestyle answers/.test(CALC) && /more high Food answers/.test(CALC),
      'the majority rule is missing');
    assert.ok(!/source rule: 2 positive Lifestyle/.test(CALC), 'the superseded 2L+3F rule is back');
  });
  check('the dashboard carries the client scale sentence', () => {
    assert.ok(/On a scale of 1 to 10, where 1 is very healthy and 10 is very unhealthy/.test(DASH_SCRIPT),
      'dashboard scale sentence wrong');
    assert.ok(/On a scale of 1 to 10, where 1 is very healthy and 10 is very unhealthy/.test(JS.quiz),
      'onboarding scale sentence wrong');
  });
  check('the My Progress Health Number card stays reduced', () => {
    assert.ok(!/hn-card__meta/.test(DASH_SCRIPT), 'the Scale/Lifestyle/Food block is back');
    assert.ok(/data-action="health-history"/.test(DASH_SCRIPT), 'the History action is missing');
    assert.ok(/startHealthQuiz\(\)/.test(DASH_SCRIPT), 'the direct-retake entry is missing');
  });
  check('the Health Assessment scores 1/2/3 with lower better', () => {
    assert.ok(/data-tier="best"   data-score="1"/.test(DASH_SCRIPT), 'best is not 1');
    assert.ok(/data-tier="worst"  data-score="3"/.test(DASH_SCRIPT), 'worst is not 3');
    assert.ok(/HSR_SCALE/.test(CALC) && /11 is low inflammation and 33 is high inflammation/.test(CALC),
      'the engine scale direction is wrong');
    assert.ok(/migrateAssessmentV2/.test(DASH_SCRIPT) && /scaleVersion !== 2/.test(DASH_SCRIPT),
      'the HA-v2 migration is missing');
    assert.ok(/appendAlways: true/.test(DASH_SCRIPT), 'HA attempts no longer append history rows');
  });
  check('all 11 assessment info entries exist in their own map', () => {
    ['daily_performance', 'appetite_for_carbohydrates', 'appetite_suppression_between_meals',
     'stool_density', 'sleep_quality', 'grogginess_upon_waking', 'sense_of_well_being',
     'mental_concentration', 'fatigue', 'skin_quality', 'headaches'].forEach(k =>
      assert.ok(new RegExp(k + ':').test(DASH_SCRIPT), 'ASSESS_INFO.' + k + ' is missing'));
    assert.ok(/ASSESS_INFO/.test(DASH_SCRIPT), 'the separate assessment info map is gone');
  });
  check('the mood Balance uses the client 100/50/25/0 table over 30 days', () => {
    assert.ok(/happy: 100, calm: 100, excited: 100, neutral: 50/.test(DASH_SCRIPT), 'weights wrong');
    assert.ok(/tired: 25, sad: 25, stressed: 0, angry: 0/.test(DASH_SCRIPT), 'weights wrong');
    assert.ok(/setDate\(cutoff\.getDate\(\) - 29\)/.test(DASH_SCRIPT), 'the 30-day window is missing');
  });
  check('blood suggestions are marker-based with an honest review state', () => {
    assert.ok(/function classifyMarker/.test(DASH_SCRIPT), 'the classifier is missing');
    assert.ok(/Recommendation requires review/.test(HTML.dashboard), 'the review state is missing');
    assert.ok(/The Blood Marker\(s\) you entered are in optimal range/.test(DASH_SCRIPT), 'optimal wording missing');
    assert.ok(/At least one of the Blood Markers you entered/.test(DASH_SCRIPT), 'plural wording missing');
    assert.ok(!/condition category, which has not been captured/.test(DASH_SCRIPT),
      'the old always-pending condition note is back');
  });
  check('custom foods require a tier and show Pending Review', () => {
    assert.ok(/data-fc-tier="best"/.test(HTML.dashboard) && /data-fc-tier="limit"/.test(HTML.dashboard),
      'the tier picker is missing');
    assert.ok(/Choose Best, Fair or Limit/.test(HTML.dashboard), 'the required-tier hint is missing');
    assert.ok(/Pending Review/.test(DASH_SCRIPT), 'the pending status is missing');
    assert.ok(/nothing was sent/i.test(DASH_SCRIPT), 'the honest confirmation is missing');
  });
  check('the five sample day types with six options are defined', () => {
    ['Work day', 'Work day with morning exercise', 'Work day, exercise after work',
     'Weekend day', 'Weekend day with morning exercise'].forEach(l =>
      assert.ok(DASH_SCRIPT.includes("label: '" + l + "'"), l + ' is missing'));
    assert.ok(/label: 'Option 1'/.test(DASH_SCRIPT) && /label: 'Option 2'/.test(DASH_SCRIPT),
      'the weekend-exercise options are missing');
    assert.ok(/never overwrite: every copy is a new day/.test(DASH_SCRIPT), 'the no-overwrite rule is gone');
    assert.ok(!/Sample Day — Balanced/.test(DASH_SCRIPT), 'the invented sample day is back');
  });
  check('the Companion welcome is the client copy and magnesium is gone', () => {
    assert.ok(/Welcome to the Veye program/.test(DASH_SCRIPT), 'the first-visit welcome is missing');
    assert.ok(/veye_bot_visited/.test(DASH_SCRIPT), 'the returning-member switch is missing');
    assert.ok(!/magnesium-rich snack/i.test(DASH_SCRIPT), 'the magnesium snack is back');
    assert.ok(!/Your last log said/.test(DASH_SCRIPT), 'the fabricated sleep-log claim is back');
  });
});

/* ======================================================================== M
   SMALL CORRECTION PASS (28 Aug 2026, evening) — CONSUMER
   Pins the six evidence-led fixes: the lower-is-better history sentence, the
   sample-day modal's stacking/dialog semantics, the wrapping custom-food row,
   semantic information buttons, sidebar accessible names, and the corrected
   prototype trust copy. Medical rules and sample-day data are asserted
   unchanged.
   ========================================================================= */

group('M · Correction pass (28 Aug evening)', () => {
  check('the Health Assessment history hint says LOWER is better', () => {
    assert.ok(HTML.dashboard.includes(
      '<span class="history-hint">A lower score out of 33 means less inflammation.</span>'),
      'the corrected sentence is missing');
    assert.ok(!/A higher score out of 33 means less inflammation/.test(HTML.dashboard),
      'the old higher-is-better sentence is back in the member-facing UI');
    assert.ok(/a <strong>lower<\/strong> score means less inflammation, so lower bars are better/.test(HTML.dashboard),
      'the chart caption lost its lower-is-better wording');
  });
  check('the sample-day modal is a real dialog outside the scroll shell', () => {
    const modalAt = HTML.dashboard.indexOf('id="sampleModal"');
    const mainEnd = HTML.dashboard.indexOf('</main>');
    assert.ok(modalAt > -1 && mainEnd > -1 && modalAt > mainEnd,
      'the sample modal must live OUTSIDE <main> — inside it the sidebar painted on top');
    assert.ok(/id="sampleModal"[\s\S]{0,400}aria-modal="true"/.test(HTML.dashboard),
      'aria-modal="true" is missing from the sample dialog');
    // The trap/restore/lock guarantee lives in the shared VeyeDialog helper
    // since the 28 Aug modal pass — same guarantee, one mechanism for all
    // three Meal Planning dialogs.
    assert.ok(/const VeyeDialog = /.test(DASH_SCRIPT), 'the shared dialog helper is gone');
    assert.ok(/rec\.opener\.focus\(\)/.test(DASH_SCRIPT), 'closing no longer restores focus to the opener');
    assert.ok(/style\.overflow = 'hidden'/.test(DASH_SCRIPT), 'the behind-the-modal scroll lock is gone');
    assert.ok(/e\.key === 'Escape'[\s\S]{0,80}close\(id\)/.test(DASH_SCRIPT),
      'Escape no longer closes the topmost dialog');
  });
  check('the custom-food row wraps instead of overflowing', () => {
    const row = DASH_STYLE.match(/\.fc-custom-row \{([\s\S]*?)\}/);
    assert.ok(row && /flex-wrap:\s*wrap/.test(row[1]), '.fc-custom-row no longer wraps');
    assert.ok(/\.fc-custom-row input \{[\s\S]{0,200}flex: 1 1 220px/.test(DASH_STYLE),
      'the input lost its wrap-friendly flex basis');
    assert.ok(/min-width: 0/.test(DASH_STYLE.match(/\.fc-custom-row input \{[\s\S]*?\}/)[0]),
      'the input lost min-width: 0');
  });
  check('every information trigger is a semantic button with an About name', () => {
    assert.ok(!/<span class="info-i"/.test(HTML.dashboard), 'an info trigger is still a span');
    const btns = HTML.dashboard.match(/<button type="button" class="info-i"/g) || [];
    assert.ok(btns.length >= 10, 'the ten static blood info buttons are missing (found ' + btns.length + ')');
    assert.ok(/class="info-i" data-info="\$\{q\.q\.toLowerCase\(\)[^"]*\}" aria-label="About \$\{q\.q\}"/.test(DASH_SCRIPT),
      'the assessment template no longer renders info BUTTONS with About names');
    ['About Triglycerides', 'About HbA1c', 'About HOMA-IR', 'About the AA/EPA Ratio'].forEach(n =>
      assert.ok(HTML.dashboard.includes('aria-label="' + n + '"'), n + ' is missing'));
    assert.ok(/\.info-i:focus-visible/.test(DASH_STYLE), 'the focus-visible state is missing');
    assert.ok(/hideInfo\(restoreFocus\)/.test(DASH_SCRIPT) && /lastInfoTrigger/.test(DASH_SCRIPT),
      'closing no longer restores focus to the info button');
  });
  check('every sidebar destination keeps a stable accessible label', () => {
    ['Dashboard', 'Veye Companion', 'My Progress', 'Mood Tracker', 'Food Choices',
     'Meal Planning', 'Food Diary', 'Supplements', 'Fitness', 'Mindfulness',
     'Resources', 'Settings', 'Log out'].forEach(label => {
      assert.ok(new RegExp('class="nav-link[^"]*"[^>]*aria-label="' + label + '"').test(HTML.dashboard),
        'sidebar link "' + label + '" has no aria-label');
    });
  });
  check('the recovery menu uses live-application wording', () => {
    assert.ok(HTML.login.includes('In the live application, Veye would send a password-reset link'),
      'the email option lost the live-application wording');
    assert.ok(HTML.login.includes('In the live application, Veye would text a one-time sign-in code'),
      'the text option lost the live-application wording');
    assert.ok(!/We&rsquo;ll send a password-reset link|We&rsquo;ll text a one-time/.test(HTML.login),
      'the old first-person promise wording is back');
    assert.ok(/no email or text message was actually\s+sent/.test(HTML.login),
      'the nothing-was-sent confirmation was lost');
  });
  check('signup uses Cara\'s approved privacy wording while login stays prototype-safe', () => {
    assert.ok(/completely confidential and encrypted with bank-level security/.test(HTML.signup),
      'signup lost the approved confidentiality sentence');
    assert.ok(/We do not share your data with third parties and we do not send spam/.test(HTML.signup),
      'signup lost the approved sharing and spam sentence');
    assert.ok(!/bank-level security/.test(HTML.login), 'login added an unsupported security claim');
    assert.ok(/your demo information stays in this browser/.test(HTML.login),
      'login lost the honest prototype sentence');
  });
  check('no medical rule or sample-day datum changed in this pass', () => {
    const CALC = read(path.join('js', 'veye-calculations.js'));
    // Health Assessment bands + dosage tiers (values only — logic pinned in the calc suite)
    ['t <= 16', 't <= 22', 't <= 27', 't <= 32', "t <= 17 ? '2.5g' : t <= 21 ? '5g' : '7.5g'"].forEach(f =>
      assert.ok(CALC.includes(f), 'Health Assessment rule drifted: ' + f));
    // Blood classification boundaries incl. the undefined gaps
    ['v < 1.1', 'v >= 4.9 && v <= 5.1', 'v >= 5.3 && v <= 8', 'v <= 2.9'].forEach(f =>
      assert.ok(DASH_SCRIPT.includes(f), 'blood classification boundary drifted: ' + f));
    assert.ok(/Recommendation requires review/.test(HTML.dashboard),
      'the undefined-combination review state is gone');
    // sample-day meals verbatim (one line per document)
    ["notes: 'salmon, brussel sprouts, whipped cauliflower, 1 cup pineapple'",
     "notes: 'filet of sole, escarole, fruit salad'",
     "notes: 'chicken, green beans, \\u00BD cantaloup'",
     "notes: 'free range beef, asparagus, black beans'",
     "notes: 'scrambled egg whites (olive oil), \\u00BE melon'",
     "notes: 'turkey chili with black beans'"].forEach(f =>
      assert.ok(DASH_SCRIPT.includes(f), 'sample-day meal drifted: ' + f));
  });
});

/* ======================================================================== N
   MODAL CORRECTION PASS (28 Aug 2026, night)
   All three Meal Planning dialogs live at body level with full dialog
   semantics and ONE shared, document-level focus mechanism. The sidebar can
   never paint above an open overlay again.
   ========================================================================= */

group('N · Meal Planning dialogs', () => {
  const mainEnd = HTML.dashboard.indexOf('</main>');
  check('all three dialogs live OUTSIDE the <main> scroll container', () => {
    ['sampleModal', 'dayModal', 'assignModal'].forEach(id => {
      const at = HTML.dashboard.indexOf('id="' + id + '"');
      assert.ok(at > mainEnd, '#' + id + ' is back inside <main> — the sidebar would paint above it');
    });
  });
  check('every inner card is a labelled modal dialog', () => {
    [['sampleModal', 'sampleTitle'], ['dayModal', 'dayModalTitle'], ['assignModal', 'assignTitle']]
      .forEach(([id, title]) => {
        const block = HTML.dashboard.slice(HTML.dashboard.indexOf('id="' + id + '"'),
                                           HTML.dashboard.indexOf('id="' + id + '"') + 900);
        assert.ok(/role="dialog"/.test(block), '#' + id + ' card lost role="dialog"');
        assert.ok(/aria-modal="true"/.test(block), '#' + id + ' card lost aria-modal');
        assert.ok(new RegExp('aria-labelledby="' + title + '"').test(block), '#' + id + ' lost aria-labelledby');
        assert.ok(new RegExp('id="' + title + '"').test(HTML.dashboard), 'heading #' + title + ' is missing');
        assert.ok(new RegExp('id="' + id + '" aria-hidden="true"').test(HTML.dashboard),
          '#' + id + ' does not start aria-hidden');
      });
  });
  check('the Assign Date label is programmatically associated', () => {
    assert.ok(/<label for="assignDate">Date<\/label>/.test(HTML.dashboard),
      'the Date label lost its for="assignDate"');
  });
  check('one shared helper opens, traps, closes and restores', () => {
    assert.ok(/const VeyeDialog = /.test(DASH_SCRIPT), 'VeyeDialog is gone');
    // reliable post-render focus entry: frame-sequenced retries, not a timeout
    assert.ok(/requestAnimationFrame\(\(\) => requestAnimationFrame\(\(\) => attempt\(0\)\)\)/.test(DASH_SCRIPT),
      'the frame-sequenced focus entry is gone');
    assert.ok(/dlg\.contains\(document\.activeElement\)/.test(DASH_SCRIPT),
      'entry no longer verifies focus actually landed inside');
    // document-level trap that recovers when focus is outside the dialog
    assert.ok(/if \(!dlg\.contains\(document\.activeElement\)\) \{[\s\S]{0,120}\.focus\(\); return;/.test(DASH_SCRIPT),
      'the outside-focus recovery is gone from the Tab trap');
    // topmost-only Escape via the stack
    assert.ok(/stack\[stack\.length - 1\]\.id/.test(DASH_SCRIPT), 'the topmost-dialog stack is gone');
    // all three dialogs route through it
    ["VeyeDialog.open('sampleModal')", "VeyeDialog.open('dayModal', '#dayName')",
     "VeyeDialog.open('assignModal', '#assignDate')",
     "VeyeDialog.close('sampleModal')", "VeyeDialog.close('dayModal')",
     "VeyeDialog.close('assignModal')"].forEach(c =>
      assert.ok(DASH_SCRIPT.includes(c), c + ' is missing'));
  });
  check('confirming an assignment restores focus to the re-rendered opener', () => {
    // assignDayToDate() -> renderYourDays() destroys the original Assign
    // button, so the confirm handler passes close() a resolver for the SAME
    // day's freshly rendered [data-assign] control. The exact-opener path
    // stays first, so Escape/Cancel behaviour is untouched.
    assert.ok(/function close\(id, fallback\)/.test(DASH_SCRIPT),
      'VeyeDialog.close lost its optional fallback');
    assert.ok(/document\.contains\(rec\.opener\) && rec\.opener\.focus\) \{\s*rec\.opener\.focus\(\);\s*\} else if \(fallback\)/.test(DASH_SCRIPT),
      'the fallback must run ONLY when the exact opener is gone');
    assert.ok(/typeof fallback === 'function' \? fallback\(\) : fallback/.test(DASH_SCRIPT),
      'the fallback resolver handling is gone');
    assert.ok(DASH_SCRIPT.includes(`VeyeDialog.close('assignModal',`) &&
              /\.day-card \[data-assign="' \+ dayId \+ '"\]/.test(DASH_SCRIPT),
      'the Assign confirmation no longer targets the re-rendered day button');
    assert.ok(/const dayId = assignTargetId;/.test(DASH_SCRIPT),
      'the day id is no longer captured before the re-render');
  });
  check('no stray per-modal open/close plumbing survives', () => {
    assert.ok(!/sampleOpener/.test(DASH_SCRIPT), 'the old sampleOpener plumbing is back');
    assert.ok(!/function sampleFocusables/.test(DASH_SCRIPT), 'the old per-modal trap is back');
  });
  check('day/assign workflows keep their wiring', () => {
    ['daySaveBtn', 'dayAddMeal', 'assignConfirm', 'data-close-day', 'data-close-assign',
     'data-dup=', 'data-del=', 'data-assign='].forEach(t =>
      assert.ok(HTML.dashboard.includes(t), t + ' went missing'));
  });
});

/* ======================================================================== O
   CLIENT READABILITY + COMPANION + BODY-COMPOSITION PASS (11 Sep 2026)
   Pins only the three requested surface changes. Medical calculations and
   the shared Health Number storage contract remain covered by earlier groups.
   ========================================================================= */

group('O · Sep client UI corrections', () => {
  check('blood-entry text and controls meet the larger readability scale', () => {
    assert.ok(/\.lab-group__title \{[^}]*font-size:\s*18px/.test(DASH_STYLE),
      'blood group headings are smaller than 18px');
    assert.ok(/\.lab-field label \{[\s\S]*?font-size:\s*15\.5px/.test(DASH_STYLE),
      'blood marker labels are smaller than the approved readable size');
    assert.ok(/\.lab-input \{[\s\S]*?height:\s*48px/.test(DASH_STYLE),
      'blood inputs lost their 48px target height');
    assert.ok(/\.lab-input input \{[\s\S]*?font-size:\s*16px/.test(DASH_STYLE),
      'blood input values are smaller than 16px');
    assert.ok(/\.lab-unit \{[\s\S]*?font-size:\s*13px/.test(DASH_STYLE),
      'blood units are smaller than 13px');
  });
  check('Companion plus menu has three useful, real prototype destinations', () => {
    assert.ok(/id="chatAddBtn"[^>]*aria-haspopup="menu"[^>]*aria-expanded="false"/.test(HTML.dashboard),
      'the plus button is not an accessible menu trigger');
    ['food-diary', 'mood', 'progress'].forEach(dest =>
      assert.ok(HTML.dashboard.includes('data-chat-shortcut="' + dest + '"'),
        'Companion quick action is missing: ' + dest));
    assert.ok(/e\.key === 'Escape'[\s\S]{0,130}closeChatAddMenu\(true\)/.test(DASH_SCRIPT),
      'Escape no longer closes the quick-action menu and restores focus');
  });
  check('message actions are scoped correctly by message author', () => {
    assert.ok(/data-msg-action="copy"/.test(DASH_SCRIPT), 'Copy is missing');
    assert.ok(/role === 'bot'[\s\S]{0,260}data-msg-action="helpful"[\s\S]{0,220}data-msg-action="feedback"/.test(DASH_SCRIPT),
      'Helpful and Feedback are not limited to Companion responses');
    assert.ok(/navigator\.clipboard\?\.writeText/.test(DASH_SCRIPT) && /document\.execCommand\('copy'\)/.test(DASH_SCRIPT),
      'Copy does not include both modern and file-safe fallback paths');
    ['Not relevant', 'Incorrect', 'Other'].forEach(choice =>
      assert.ok(DASH_SCRIPT.includes('data-feedback="' + choice + '"'), 'feedback choice missing: ' + choice));
  });
  check('BMI overview uses the client-requested composition and dated trend visual', () => {
    assert.ok(/function bmiProgressViz\(saved\)/.test(DASH_SCRIPT), 'BMI progress visual helper is missing');
    assert.ok(/class="bmi-card-pie"/.test(DASH_SCRIPT), 'the lean-mass/body-fat pie is missing');
    assert.ok(/Body fat % over time/.test(DASH_SCRIPT), 'the dated body-fat trend is missing');
    assert.ok(/viz:\s*bmiProgressViz\(bmiSaved\)/.test(DASH_SCRIPT),
      'the BMI card is not wired to the new visual');
    assert.ok(!/viz:\s*'<div class="viz-rings">'[\s\S]{0,350}action:\s*'bmi'/.test(DASH_SCRIPT),
      'the unclear three-ring BMI card returned');
    assert.ok(/No body-fat trend recorded/.test(DASH_SCRIPT),
      'the BMI card lacks an honest no-data state');
  });
});

/* ======================================================================== P
   CLIENT PRESENTATION FINISH (11 Sep 2026)
   Pins the Resources composition, readable nested assessment, progress
   summary, and useful profile controls requested for the handoff build.
   ========================================================================= */

group('P · Client presentation finish', () => {
  check('Health Assessment overview shows real dated bars and latest result', () => {
    assert.ok(/function assessmentProgressViz\(saved\)/.test(DASH_SCRIPT),
      'the Health Assessment progress helper is missing');
    assert.ok(/viz:\s*assessmentProgressViz\(assessSaved\)/.test(DASH_SCRIPT),
      'the My Progress Health Assessment card is not using the result visual');
    assert.ok(/lower bars show improvement/.test(DASH_SCRIPT),
      'the lower-is-better direction is not explained');
  });
  check('nested Health Assessment uses the larger client reading scale', () => {
    assert.ok(/\.assess-q \{[^}]*font-size:\s*16px/.test(DASH_STYLE),
      'question text is smaller than 16px');
    assert.ok(/\.assess-opt \{[^}]*min-height:\s*48px[^}]*font-size:\s*15px/.test(DASH_STYLE),
      'answer controls lost their readable size');
    assert.ok(/\.module-card-head h2,[^}]*font-size:\s*28px/.test(DASH_STYLE),
      'nested report headings lost the 28px scale');
  });
  check('Resources matches the website composition without the expired offer', () => {
    assert.ok(/class="res-feature"/.test(HTML.dashboard), 'the website-style Resources feature rail is missing');
    assert.ok(/assets\/web\/img\/promo-art\.png/.test(HTML.dashboard), 'the supplied Resources artwork is missing');
    assert.ok(!/30% OFF|OFFER ENDS 06\/30\/24/.test(HTML.dashboard),
      'the expired commercial offer was reintroduced');
    assert.strictEqual((HTML.dashboard.match(/data-resource="/g) || []).length, 5,
      'all four resource cards and the library feature must be actionable');
    assert.ok(/querySelectorAll\('\[data-resource\]'\)/.test(DASH_SCRIPT),
      'Resource actions have no feedback handler');
  });
  check('Profile layout and useful account controls are functional', () => {
    ['settingsUnits', 'settingsTimezone', 'settingsDownloadBtn'].forEach(id =>
      assert.ok(HTML.dashboard.includes('id="' + id + '"'), 'missing settings control: ' + id));
    assert.ok(/\.settings-profile \{[^}]*grid-template-columns:\s*160px minmax\(0,1fr\)/.test(DASH_STYLE),
      'profile photo and fields are no longer held in the aligned grid');
    assert.ok(/new Blob\(\[JSON\.stringify\(payload/.test(DASH_SCRIPT),
      'demo-data download is not wired');
    assert.ok(/prefs\.units/.test(DASH_SCRIPT) && /prefs\.timezone/.test(DASH_SCRIPT),
      'units or time zone are not restored');
  });
});

/* --------------------------------------------------------------- reporting -- */

const pad = s => (s + ' ').padEnd(28, '.');
console.log('\nVEYE UI Contract Tests');
console.log('----------------------');
groups.forEach(g => {
  console.log(`${pad(g.name)} ${g.failed ? `FAIL (${g.failed}/${g.passed + g.failed})` : `PASS (${g.passed})`}`);
});
if (failures.length) {
  console.log('\nFailures:');
  failures.forEach(f => console.log(`  [${f.group}] ${f.what}\n      ${f.message.split('\n')[0]}`));
}
console.log(`\nTotal: ${passed} passed, ${failures.length} failed  (${passed + failures.length} assertions)\n`);
process.exit(failures.length ? 1 : 0);
