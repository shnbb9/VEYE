/* ============================================================
   VEYE — Onboarding quiz engine
   UI = Figma (Desk Onboard B–J). Scoring = HealthNumbers.xlsx.
   ============================================================ */
(function () {
  var CALC = window.VeyeCalculations;

  // The canonical Health Number has TWELVE questions (HealthNumbers.xlsx).
  // `hn` is the client question number; a screen may cover more than one (the
  // sleep screen carries Q8-Q10). BMI is available separately in My Progress,
  // not in onboarding (Functional Edits (1), confirmed 10 Sep 2026).
  // Option labels are the scoring keys, so they must match the engine exactly;
  // the points themselves live only in js/veye-calculations.js.
  var QUESTIONS = [
    // `otherWriteIn` renders the XLSX "Other write in" text field on the Other
    // option (Q1 R11, Q2 R22). The text is metadata only — Other keeps its own
    // score (Q1 = 0, Q2 = 0.5) whether or not anything is typed.
    { id: 'goals', hn: [1], type: 'checkbox', title: 'What are your goals?',
      otherWriteIn: 'Tell us your goal',
      options: CALC.healthNumber.GOAL_OPTIONS.concat(['Other']) },
    { id: 'plans', hn: [2], type: 'checkbox', title: 'Have you tried other food plans?',
      exclusive: 'No other plans', otherWriteIn: 'Enter the plan you tried',
      options: CALC.healthNumber.PLAN_OPTIONS.concat(['Other', 'No other plans']) },
    { id: 'activity', hn: [3], type: 'radio', title: 'Select your activity level',
      options: CALC.healthNumber.ACTIVITY_OPTIONS },
    { id: 'meditate', hn: [4], type: 'yesno', title: 'Do you meditate?' },
    { id: 'tired', hn: [5], type: 'yesno', title: 'Are you tired or do you have poor mental focus during the day?' },
    { id: 'gainWeight', hn: [6], type: 'yesno', title: 'Do you gain weight quickly?' },
    { id: 'abdomenWeight', hn: [7], type: 'yesno', title: 'Is most of your excess weight (if any) around your abdomen?' },
    { id: 'sleep', hn: [8, 9, 10], type: 'sleep', title: null },
    { id: 'diet', hn: [11], type: 'radioOther', title: 'What is your dietary preference?',
      options: CALC.healthNumber.DIET_OPTIONS, otherPlaceholder: 'Enter your dietary preference' },
    { id: 'source', hn: [12], type: 'radioOther', title: 'How did you find out about Veye?',
      options: CALC.healthNumber.SOURCE_OPTIONS, otherPlaceholder: 'Enter information' }
  ];
  var TOTAL = 12; // canonical Health Number questions, not screens

  var state = {};
  var idx = 0;        // index into visible questions
  // The old mandatory "Our mission…" sign-up gate is gone. Finishing the last
  // question opens the email result-gate modal; a valid address reveals the
  // result, and signing up is optional from there.
  var phase = 'q';    // 'q' | 'result'

  function visible() { return QUESTIONS.filter(function (q) { return !q.showIf || q.showIf(state); }); }

  /** Highest canonical Health Number question reached at this screen. */
  function hnReached(vis, i) {
    for (var k = i; k >= 0; k--) {
      if (vis[k].hn && vis[k].hn.length) return vis[k].hn[vis[k].hn.length - 1];
    }
    return 0;
  }

  var root = document.getElementById('quizMain');
  var trackEl = document.getElementById('quizTrack');
  var countEl = document.getElementById('quizCount');
  var fillWrap = document.getElementById('quizProgress');

  // Progress bar geometry from the Figma frames + "progress.png", rescaled so
  // the twelve canonical Health Number questions fill the same 384px track.
  // One segment per canonical question; the sleep screen completes Q8-Q10.
  var SEG_END = [32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384];
  var SEG_COL = ['#B7E355', '#ADDC48', '#A5D538', '#9BCA30', '#90BE29', '#85B422',
                 '#7EAA1B', '#709815', '#59731F', '#364A08', '#8AA0A8', '#A5CBD9'];

  function renderProgress(n) {
    var segs = '', nums = '', i, prev;
    for (i = 0; i < n && i < SEG_END.length; i++) {
      // lightest/shortest on top, so every step keeps its own rounded band
      segs += '<span class="pseg" style="width:' + SEG_END[i] + 'px;background:' +
              SEG_COL[i] + ';z-index:' + (20 - i) + '"></span>';
      prev = i ? SEG_END[i - 1] : 0;
      nums += '<span class="pnum" style="left:' + ((prev + SEG_END[i]) / 2) + 'px;color:' +
              (i < 4 ? '#446514' : '#F6FFE8') + '">' + (i + 1) + '</span>';
    }
    trackEl.innerHTML = segs + nums;
    trackEl.setAttribute('aria-valuenow', n);
  }

  // ---------- rendering ----------
  // Attribute-safe. User-typed write-in text goes through here, so quotes and
  // angle brackets must not be able to break out of the attribute.
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
      .replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function optCard(label, selected, radio, checkHtml) {
    return '<div class="opt' + (radio ? ' opt--radio' : '') + (selected ? ' selected' : '') + '" data-val="' + esc(label) + '">' +
      '<span>' + label + '</span><span class="opt__check"></span></div>';
  }

  function render() {
    var vis = visible();
    if (phase === 'q') {
      var q = vis[idx];
      fillWrap.style.visibility = 'visible';
      var n = hnReached(vis, idx);
      renderProgress(n);
      countEl.textContent = n + '/' + TOTAL;
      root.classList.toggle('quiz__main--bmi', q.type === 'bmi');
      root.classList.toggle('quiz__main--yn', q.type === 'yesno');
      root.innerHTML = renderQuestion(q) + navHtml(true, 'Next', !isAnswered(q));
    } else {
      fillWrap.style.visibility = 'hidden';
      countEl.textContent = '';
      root.classList.remove('quiz__main--bmi', 'quiz__main--yn');
      var hn = computeHealthNumber();
      persist(hn);
      root.innerHTML = renderResult(hn);
    }
    bind();
  }

  function renderQuestion(q) {
    var t = q.title ? '<h2 class="quiz__title">' + q.title + '</h2>' : '';
    if (q.type === 'checkbox' || q.type === 'radio') {
      var sel = state[q.id] || (q.type === 'checkbox' ? [] : null);
      var opts = q.options.map(function (label) {
        var on = q.type === 'checkbox' ? sel.indexOf(label) > -1 : sel === label;
        // XLSX "Other write in": the Other option carries an inline text field.
        // Optional — the client source does not require the text to be filled.
        if (q.otherWriteIn && label === 'Other') {
          return '<div class="opt opt--other' + (on ? ' selected' : '') + '" data-val="Other">' +
            '<span>Other</span><input data-other placeholder="' + esc(q.otherWriteIn) +
            '" value="' + esc(state[q.id + 'Other'] || '') + '"><span class="opt__check"></span></div>';
        }
        return optCard(label, on, q.type === 'radio');
      }).join('');
      return t + '<div class="quiz__options">' + opts + '</div>';
    }
    if (q.type === 'yesno') {
      var v = state[q.id];
      return t + '<div class="quiz__options quiz__options--yn">' +
        optCard('Yes', v === 'yes', true) + optCard('No', v === 'no', true) + '</div>';
    }
    if (q.type === 'bmiIntro') {
      var s = state.bmiIntro || {};
      return t +
        '<div class="quiz__options quiz__options--yn quiz__options--bmi" data-group="doBmi">' +
          optCard('Yes', s.doBmi === 'yes', true).replace('data-val', 'data-sub="doBmi" data-val') +
          optCard('No', s.doBmi === 'no', true).replace('data-val', 'data-sub="doBmi" data-val') +
        '</div>' +
        '<h2 class="quiz__title" style="margin-top:34px">Choose the biology that best describes you</h2>' +
        '<div class="quiz__options quiz__options--stack" data-group="biology">' +
          optCard('Man', s.biology === 'Man', true).replace('data-val', 'data-sub="biology" data-val') +
          optCard('Woman', s.biology === 'Woman', true).replace('data-val', 'data-sub="biology" data-val') +
        '</div>';
    }
    if (q.type === 'bmi') {
      var b = state.bmi || {};
      var bi = state.bmiIntro || {};
      // Body Fat Analysis .docx defines different inputs per sex:
      //   Woman -> weight, height, waist/abdomen, HIPS
      //   Man   -> weight, height, waist,         WRIST
      // The illustration keeps both tapes (approved manager feedback); only the
      // required DATA INPUT changes. `slot` keeps the Figma position classes.
      var isMan = bi.biology === 'Man';
      var f = function (slot, key, label, instr, ph) {
        return '<div class="bmi-field bmi-field--' + slot + '"><label>' + label + '</label><p>' + instr + '</p>' +
          '<input data-bmi="' + key + '" value="' + (b[key] || '') + '" inputmode="decimal" placeholder="' + (ph || 'Enter measurement') + '"></div>';
      };
      return t +
        '<div class="quiz__options quiz__options--yn quiz__options--bmi" data-group="doBmi">' +
          optCard('Yes', bi.doBmi === 'yes', true).replace('data-val', 'data-sub="doBmi" data-val') +
          optCard('No', bi.doBmi === 'no', true).replace('data-val', 'data-sub="doBmi" data-val') +
        '</div>' +
        '<div class="bmi-wrap">' +
          '<img class="bmi-figure" src="assets/web/img/bmi-figure-tapes.png?v=2" alt="Body outline showing the abdomen and wrist measuring tapes">' +
          f('weight', 'weight', 'Weight', 'Measure your weight and round to the nearest five pounds, i.e., 120 or 145', 'Enter your weight') +
          f('abdomen', 'abdomen', isMan ? 'Waist' : 'Abdomen', 'Measure at the belly button, keep the tape level, and use half-inch increments, i.e., 26.5 or 30.0') +
          f('height', 'height', 'Height', 'Measure your height by taking off your shoes, and use half-inch increments, i.e., 62.5 or 64.00') +
          (isMan
            ? f('wrist', 'wrist', 'Wrist', 'Measure your dominant hand above your wrist bone where your wrist bends. Use half-inch increments, i.e., 7 or 7.5')
            : f('wrist', 'hips', 'Hips', 'Measure at your widest point, keep the tape level, and use half-inch increments, i.e., 30.0 or 30.5')) +
        '</div>';
    }
    if (q.type === 'sleep') {
      var sl = state.sleep || {};
      var yn = function (key, q2) {
        return '<div class="sleep-q"><h3>' + q2 + '</h3><div class="quiz__options quiz__options--yn" data-sleep="' + key + '">' +
          '<div class="opt opt--radio' + (sl[key] === 'yes' ? ' selected' : '') + '" data-sub="' + key + '" data-val="yes"><span>Yes</span><span class="opt__check"></span></div>' +
          '<div class="opt opt--radio' + (sl[key] === 'no' ? ' selected' : '') + '" data-sub="' + key + '" data-val="no"><span>No</span><span class="opt__check"></span></div>' +
        '</div></div>';
      };
      return yn('enough', 'Do you feel like you get enough sleep?') +
        yn('well', 'Do you sleep well?') +
        '<div class="sleep-q"><h3>How many hours do you sleep per night?</h3>' +
          '<div style="text-align:center"><input class="num-input" data-sleep-hours value="' + (sl.hours || '') + '" inputmode="numeric" placeholder="Enter sleep hours"></div></div>';
    }
    if (q.type === 'radioOther') {
      var st = state[q.id] || {};
      var opts2 = q.options.map(function (label) {
        return optCard(label, st.choice === label, true);
      }).join('');
      var other = '<div class="opt opt--radio opt--other' + (st.choice === 'Other' ? ' selected' : '') + '" data-val="Other">' +
        '<span>Other</span><input data-other placeholder="' + esc(q.otherPlaceholder) + '" value="' + esc(st.other || '') + '"><span class="opt__check"></span></div>';
      return t + '<div class="quiz__options">' + opts2 + other + '</div>';
    }
    return t;
  }

  function navHtml(showPrev, nextLabel, nextDisabled) {
    return '<div class="quiz__nav">' +
      (showPrev ? '<button class="quiz__btn quiz__btn--prev" data-prev>Previous</button>' : '') +
      '<button class="quiz__btn quiz__btn--next"' + (nextDisabled ? ' disabled' : '') + ' data-next>' + nextLabel + '</button></div>';
  }

  // ---------- answer-required gating ----------
  // Per Arnold's Figma review comments: a step can't be advanced until it's answered.
  function isAnswered(q) {
    if (q.type === 'checkbox') return (state[q.id] || []).length > 0;
    if (q.type === 'radio') return !!state[q.id];
    if (q.type === 'yesno') return state[q.id] === 'yes' || state[q.id] === 'no';
    if (q.type === 'bmiIntro') {
      var s = state.bmiIntro || {};
      return !!s.doBmi && !!s.biology;
    }
    if (q.type === 'bmi') {
      var s = state.bmiIntro || {};
      if (!s.doBmi || !s.biology) return false;
      var b = state.bmi || {};
      var fourth = s.biology === 'Man' ? 'wrist' : 'hips';
      return !!(b.weight && b.abdomen && b.height && b[fourth]);
    }
    if (q.type === 'sleep') {
      var sl = state.sleep || {};
      return !!sl.enough && !!sl.well && sl.hours !== undefined && String(sl.hours).trim() !== '';
    }
    if (q.type === 'radioOther') {
      var st = state[q.id] || {};
      if (!st.choice) return false;
      if (st.choice === 'Other') return !!(st.other && st.other.trim());
      return true;
    }
    return true;
  }

  function updateNextState() {
    if (phase !== 'q') return;
    var q = visible()[idx];
    var btn = root.querySelector('[data-next]');
    if (!btn || !q) return;
    if (isAnswered(q)) btn.removeAttribute('disabled');
    else btn.setAttribute('disabled', '');
  }

  // ---------- interaction ----------
  function bind() {
    root.querySelectorAll('.opt').forEach(function (el) {
      el.addEventListener('click', function (e) {
        if (e.target.tagName === 'INPUT') return;
        onSelect(el);
      });
    });
    root.querySelectorAll('input[data-bmi]').forEach(function (el) {
      el.addEventListener('input', function () { state.bmi = state.bmi || {}; state.bmi[el.getAttribute('data-bmi')] = el.value; updateNextState(); });
    });
    var hrs = root.querySelector('input[data-sleep-hours]');
    if (hrs) hrs.addEventListener('input', function () { state.sleep = state.sleep || {}; state.sleep.hours = hrs.value; updateNextState(); });
    var oth = root.querySelector('input[data-other]');
    if (oth) oth.addEventListener('input', function () {
      var q = visible()[idx];
      var card = oth.closest('.opt');
      if (q.type === 'checkbox') {
        // Multi-select: the text is metadata on the side; typing also ticks Other
        // so the 0.5 (Q2) / 0 (Q1) score is applied exactly once.
        state[q.id + 'Other'] = oth.value;
        state[q.id] = state[q.id] || [];
        if (state[q.id].indexOf('Other') === -1) {
          if (q.exclusive) {
            var xi = state[q.id].indexOf(q.exclusive);
            if (xi > -1) state[q.id].splice(xi, 1);
          }
          state[q.id].push('Other');
        }
        var chosen = state[q.id];
        card.parentElement.querySelectorAll('.opt').forEach(function (o) {
          o.classList.toggle('selected', chosen.indexOf(o.getAttribute('data-val')) > -1);
        });
      } else {
        state[q.id] = state[q.id] || {}; state[q.id].other = oth.value; state[q.id].choice = 'Other';
        markRadio(card);
      }
      updateNextState();
    });
    var p = root.querySelector('[data-prev]'); if (p) p.addEventListener('click', prev);
    var n = root.querySelector('[data-next]'); if (n) n.addEventListener('click', next);

    // Result screen: signing up is optional and never automatic.
    var su = root.querySelector('[data-signup]');
    // CALC.storage.navigate keeps the saved Health Number travelling with the
    // user: on file:// (Firefox) each page has its own localStorage partition.
    if (su) su.addEventListener('click', function () { CALC.storage.navigate('signup.html'); });
    var nn = root.querySelector('[data-notnow]');
    if (nn) nn.addEventListener('click', function () {
      var actions = root.querySelector('.result__actions');
      var note = root.querySelector('#resultNote');
      if (actions) actions.hidden = true;
      if (note) note.hidden = false;
    });
  }

  // ---------- result-ready email gate ----------
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/;
  var modalEl = null;

  function onEsc(e) { if (e.key === 'Escape') closeEmailGate(); }

  function closeEmailGate() {
    if (!modalEl) return;
    modalEl.parentNode.removeChild(modalEl);
    modalEl = null;
    document.removeEventListener('keydown', onEsc);
  }

  function openEmailGate() {
    if (modalEl) return;
    modalEl = document.createElement('div');
    modalEl.className = 'hn-modal';
    modalEl.setAttribute('role', 'dialog');
    modalEl.setAttribute('aria-modal', 'true');
    modalEl.setAttribute('aria-labelledby', 'hnModalTitle');
    modalEl.innerHTML =
      '<div class="hn-modal__card">' +
        '<button type="button" class="hn-modal__close" data-hn-close aria-label="Close">&times;</button>' +
        '<h2 class="hn-modal__title" id="hnModalTitle">Your Health Number is Ready</h2>' +
        '<p class="hn-modal__copy">Enter your email address to view your Health Number.</p>' +
        '<label class="hn-modal__label" for="hnEmail">Email Address</label>' +
        '<input class="hn-modal__input" id="hnEmail" type="email" inputmode="email" autocomplete="email" placeholder="you@example.com">' +
        '<p class="hn-modal__err" id="hnErr" role="alert"></p>' +
        '<button type="button" class="quiz__btn quiz__btn--next hn-modal__cta" data-hn-go>View My Health Number</button>' +
      '</div>';
    document.body.appendChild(modalEl);

    var input = modalEl.querySelector('#hnEmail');
    var err = modalEl.querySelector('#hnErr');

    function fail(msg) { err.textContent = msg; input.classList.add('is-invalid'); input.focus(); }

    function go() {
      var v = (input.value || '').trim();
      if (!v) { fail('Please enter your email address.'); return; }
      if (!EMAIL_RE.test(v)) { fail('Please enter a valid email address.'); return; }
      // Prototype: held for this session only, to pre-fill the optional sign-up
      // form. No request is made, no account is created, nothing is stored server-side.
      try { sessionStorage.setItem('veye_prefill_email', v); } catch (e) {}
      closeEmailGate();
      phase = 'result';
      window.scrollTo(0, 0);
      render();
    }

    modalEl.querySelector('[data-hn-go]').addEventListener('click', go);
    modalEl.querySelector('[data-hn-close]').addEventListener('click', closeEmailGate);
    modalEl.addEventListener('mousedown', function (e) { if (e.target === modalEl) closeEmailGate(); });
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); go(); } });
    input.addEventListener('input', function () { input.classList.remove('is-invalid'); err.textContent = ''; });
    document.addEventListener('keydown', onEsc);
    input.focus();
  }

  function markRadio(card) {
    var group = card.parentElement;
    group.querySelectorAll('.opt').forEach(function (o) { o.classList.remove('selected'); });
    card.classList.add('selected');
  }

  function onSelect(el) {
    var q = visible()[idx];
    var val = el.getAttribute('data-val');
    var sub = el.getAttribute('data-sub');
    if (sub) { // bmiIntro sub-groups or sleep sub-groups
      if (q.type === 'bmiIntro' || q.type === 'bmi') {
        state.bmiIntro = state.bmiIntro || {};
        // doBmi drives showIf, so normalise the label ("Yes"/"No") to lower case
        state.bmiIntro[sub] = (sub === 'doBmi') ? val.toLowerCase() : val;
      }
      else if (q.type === 'sleep') { state.sleep = state.sleep || {}; state.sleep[sub] = val; }
      markRadio(el); updateNextState(); return;
    }
    if (q.type === 'checkbox') {
      state[q.id] = state[q.id] || [];
      var i = state[q.id].indexOf(val);
      if (i > -1) { state[q.id].splice(i, 1); }
      else { state[q.id].push(val); }
      // "No other plans" is mutually exclusive with any named plan (XLSX R23).
      if (q.exclusive) {
        if (val === q.exclusive && state[q.id].indexOf(val) > -1) state[q.id] = [q.exclusive];
        else if (val !== q.exclusive) {
          var ei = state[q.id].indexOf(q.exclusive);
          if (ei > -1) state[q.id].splice(ei, 1);
        }
      }
      // Un-ticking Other drops its write-in text too, so no orphaned metadata
      // is saved (e.g. after switching to the exclusive "No other plans").
      if (q.otherWriteIn && state[q.id].indexOf('Other') === -1) delete state[q.id + 'Other'];
      var chosen = state[q.id];
      el.parentElement.querySelectorAll('.opt').forEach(function (o) {
        o.classList.toggle('selected', chosen.indexOf(o.getAttribute('data-val')) > -1);
      });
      var oi = el.parentElement.querySelector('input[data-other]');
      if (oi && !state[q.id + 'Other']) oi.value = '';
    } else if (q.type === 'radio') {
      state[q.id] = val; markRadio(el);
    } else if (q.type === 'yesno') {
      state[q.id] = val === 'Yes' ? 'yes' : 'no'; markRadio(el);
    } else if (q.type === 'radioOther') {
      state[q.id] = state[q.id] || {}; state[q.id].choice = val; markRadio(el);
    }
    updateNextState();
  }

  function next() {
    if (phase === 'result') return;
    var vis = visible();
    if (!isAnswered(vis[idx])) { updateNextState(); return; } // can't advance until this step is answered
    // Last question answered — stay on the page and ask for an email before
    // revealing the number. No navigation happens here.
    if (idx >= vis.length - 1) { openEmailGate(); return; }
    idx++;
    window.scrollTo(0, 0); render();
  }
  function prev() {
    if (phase === 'result') { phase = 'q'; idx = visible().length - 1; render(); return; }
    if (idx > 0) { idx--; render(); }
    else { CALC.storage.navigate('index.html'); }
  }

  // ---------- scoring ----------
  // Delegated to the shared engine so onboarding and the dashboard cannot drift
  // apart. There is no second scoring table in this file.
  function computeHealthNumber() { return CALC.healthNumber.score(state); }
  function blurbFor(hn) { return CALC.healthNumber.interpret(hn, state).desc; }

  // Seeing the number does not sign anyone in, so there is no route to the
  // dashboard from here — Sign Up is offered, and declining keeps the result.
  function renderResult(hn) {
    var pct = Math.round(hn / 10 * 100);
    var displayNumber = Number(hn).toFixed(1);
    return '<div class="result">' +
      '<h2 class="result__title">Your Health Number</h2>' +
      '<div class="result__ring" style="--pct:' + pct + '%"><b>' + displayNumber + '</b></div>' +
      '<p class="result__scale">On a scale of 1 to 10, where 1 is very healthy and 10 is very unhealthy, your health number is <strong>' + displayNumber + '</strong>.</p>' +
      '<p class="result__blurb">' + blurbFor(hn) + '</p>' +
      '<div class="result__actions">' +
        '<button class="quiz__btn quiz__btn--next" data-signup>Sign Up</button>' +
        '<button class="quiz__btn quiz__btn--prev" data-notnow>Not now</button>' +
      '</div>' +
      '<p class="result__note" id="resultNote" hidden>Your Health Number stays on this screen &mdash; you can create an account whenever you are ready. <a href="index.html">Back to Veye</a></p>' +
    '</div>';
  }

  function persist(hn) {
    try {
      // One canonical write updates onboarding, Dashboard, My Progress and
      // history together. `hn` is intentionally not written separately: the
      // shared engine recalculates it from these exact answers.
      CALC.healthNumber.saveRecord(state, { source: 'onboarding' });
      // Body-composition measurements belong to My Progress. Completing the
      // Health Number must not overwrite existing veye_bmi records.
    } catch (e) {}
  }

  /** Retained non-serving legacy helper; onboarding no longer calls it.
   *  If the optional BMI branch was completed, calculate the body composition
   *  here and save it in the SAME `veye_bmi` model the dashboard/My Progress
   *  already read, so the user never re-enters these measurements. Dated history
   *  is kept alongside the `latest`/`input`/`result` keys the existing UI uses. */
  function persistBodyComposition() {
    var bi = state.bmiIntro || {};
    if (!bi.biology || String(bi.doBmi).toLowerCase() !== 'yes') return;
    var b = state.bmi || {};
    var isMan = bi.biology === 'Man';
    var input = {
      sex: isMan ? 'male' : 'female',
      weight: parseFloat(b.weight),
      height: parseFloat(b.height),
      abdomen: parseFloat(b.abdomen),
      waist: parseFloat(b.abdomen)
    };
    if (isMan) input.wrist = parseFloat(b.wrist); else input.hips = parseFloat(b.hips);
    if (!input.weight || !input.height) return;

    var comp = CALC.bodyFat.compose({
      sex: bi.biology, weight: input.weight, height: input.height,
      abdomen: input.abdomen, waist: input.waist, hips: input.hips, wrist: input.wrist
    });

    var payload = { input: input, data: input, updated: new Date().toISOString(),
                    source: 'onboarding' };
    if (comp.ok) {
      payload.result = {
        sex: input.sex, bf: comp.bodyFatPercent, lean: 100 - comp.bodyFatPercent,
        weight: input.weight, fatLbs: comp.fatMassLb, leanLbs: comp.leanMassLb,
        bmi: comp.bmi, source: 'onboarding'
      };
    } else {
      // Outside the client table — record the measurements without inventing a
      // body-fat figure, and say why.
      payload.result = { sex: input.sex, weight: input.weight, bmi: comp.bmi,
                         unavailable: comp.reason, source: 'onboarding' };
    }
    var prior = CALC.history.migrate(JSON.parse(localStorage.getItem('veye_bmi') || 'null'));
    var store = CALC.history.push(prior, { input: input, result: payload.result, updated: payload.updated });
    payload.latest = store.latest;
    payload.history = store.history;
    localStorage.setItem('veye_bmi', JSON.stringify(payload));
  }

  document.getElementById('quizBack').addEventListener('click', prev);

  // QA helper: ?step=N / ?phase=result / ?gate=1 (opens the email modal)
  var openGateOnLoad = false;
  try {
    var qs = new URLSearchParams(location.search);
    if (qs.has('phase') && qs.get('phase') === 'result') phase = 'result';
    if (qs.has('step')) idx = Math.max(0, Math.min(parseInt(qs.get('step'), 10) || 0, visible().length - 1));
    openGateOnLoad = qs.has('gate');
  } catch (e) {}

  render();
  if (openGateOnLoad) openEmailGate();
})();
