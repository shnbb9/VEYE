/* Progress Trackers on the Dashboard (concept A, chosen by the owner 25 Nov
   2026; the application's components/member/tracker-cards.tsx): the five
   instruments, each on its own scale, with the client's bands, the latest
   result and what changed. Nothing shares an axis, nothing is smoothed, every
   value is printed, and a tracker with no result rests (Cara's decision tree).

   Reads only what this browser has saved. Bands and goals come from the one
   engine (veye-calculations.js) — this file holds no score and no boundary. */
(function () {
  'use strict';

  var DAY = 86400000;
  var TINT = { good: '#D9E9CC', relative: '#E9F1DB', moderate: '#F7EBCB', high: '#F5DFD7', verylow: '#D9E9CC', low: '#E9F1DB', significant: '#F1D3C8', poor: '#EAC2B4' };
  var MARKERS = [{ key: 'tg_hdl', label: 'TG / HDL', unit: '' }, { key: 'aa_epa', label: 'AA / EPA', unit: '' }, { key: 'hba1c', label: 'HbA1c', unit: ' %' }, { key: 'homa_ir', label: 'HOMA-IR', unit: '', from: 'homa' }];
  var showBmi = false;
  var openTables = {};

  function esc(v) { return String(v).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function load(key) { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; } }
  function short(at, year) { return new Date(at).toLocaleDateString(undefined, year ? { day: 'numeric', month: 'short', year: 'numeric' } : { day: 'numeric', month: 'short' }); }
  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : null; }
  function history(key) {
    return VeyeCalculations.history.migrate(load(key)).history
      .map(function (h) { return { at: Date.parse(h.updated), result: h.result, answers: h.answers }; })
      .filter(function (h) { return isFinite(h.at) && h.result; }).sort(function (a, b) { return a.at - b.at; });
  }
  /* A date that tells two results of one day apart. */
  function stamp(points, i) {
    var day = function (at) { return new Date(at).toDateString(); };
    var same = points.some(function (p, j) { return j !== i && day(p.at) === day(points[i].at); });
    return short(points[i].at) + (same ? ' ' + new Date(points[i].at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '');
  }

  /* The bands the engine itself returns, read off it step by step. */
  function bandsOf(low, high, step, read) {
    var out = [];
    for (var v = low; v <= high + 1e-9; v += step) {
      var r = read(Math.round(v * 10) / 10), last = out[out.length - 1];
      if (last && last.label === r.status) last.upto = v; else out.push({ from: v, upto: v, label: r.status, bucket: r.bucket });
    }
    return out;
  }

  function line(points, low, high, color, bands, step, unit, describe, W) {
    var H = 200, L = 34, R = 14, T = 24, B = 30;
    var first = points[0].at, last = points[points.length - 1].at;
    var x = function (at) { return last === first ? (L + W - R) / 2 : L + 12 + ((at - first) / (last - first)) * (W - L - R - 24); };
    var y = function (v) { return H - B - ((v - low) / ((high - low) || 1)) * (H - T - B); };
    var ticks = last === first ? [first] : (last - first < 2 * DAY || W < 360) ? [first, last] : [first, first + (last - first) / 2, last];
    var rects = (bands || []).map(function (b, i) {
      var from = i ? b.from - step / 2 : low, to = b.upto >= high ? high : b.upto + step / 2;
      return '<rect x="' + L + '" y="' + y(to) + '" width="' + (W - L - R) + '" height="' + Math.max(0, y(from) - y(to)) + '" fill="' + (TINT[b.bucket] || '#EEF2E6') + '"/>';
    }).join('');
    var rules = [low, high].map(function (v) { return '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v) + '" y2="' + y(v) + '" class="tracker-plot__rule"/><text x="' + (L - 6) + '" y="' + (y(v) + 4) + '" text-anchor="end" class="tracker-plot__tick">' + v + (unit || '') + '</text>'; }).join('');
    var path = points.length > 1 ? '<polyline points="' + points.map(function (p) { return x(p.at).toFixed(1) + ',' + y(p.value).toFixed(1); }).join(' ') + '" fill="none" stroke="' + color + '" stroke-width="2.4" stroke-linejoin="round"/>' : '';
    var dots = points.map(function (p, i) {
      var end = i === points.length - 1, gap = i ? x(p.at) - x(points[i - 1].at) : 99;
      var label = end || i === 0 || gap > 34 ? '<text x="' + x(p.at) + '" y="' + (y(p.value) - 12) + '" text-anchor="' + (points.length === 1 ? 'middle' : i === 0 ? 'start' : end ? 'end' : 'middle') + '" class="tracker-plot__value">' + esc(p.label) + '</text>' : '';
      return '<circle cx="' + x(p.at) + '" cy="' + y(p.value) + '" r="' + (end ? 8 : 5) + '" fill="' + (end ? color : '#fff') + '" stroke="' + color + '" stroke-width="2.2"/>' + label;
    }).join('');
    var dates = ticks.map(function (t, i) { return '<text x="' + x(t) + '" y="' + (H - 8) + '" text-anchor="' + (ticks.length === 1 ? 'middle' : i === 0 ? 'start' : i === ticks.length - 1 ? 'end' : 'middle') + '" class="tracker-plot__tick">' + short(t) + '</text>'; }).join('');
    var key = bands ? '<ul class="tracker-key">' + bands.map(function (b) { return '<li><span style="background:' + (TINT[b.bucket] || '#EEF2E6') + '" aria-hidden="true"></span>' + esc(b.label) + ' ' + (b.from === b.upto ? b.upto : b.from + '–' + b.upto) + '</li>'; }).join('') + '</ul>' : '';
    return '<div class="tracker-plot"><svg viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" role="img" aria-label="' + esc(describe) + '">' + rects + rules + path + dots + dates + '</svg>' + key + '</div>';
  }

  function barsChart(points, high, color, describe, W) {
    var shown = points.slice(-Math.max(2, Math.min(6, Math.floor(W / 74))));
    var H = 200, L = 26, T = 22, B = 30, step = (W - L) / shown.length, bar = Math.min(44, step * 0.55);
    var y = function (v) { return H - B - (v / high) * (H - T - B); };
    return '<div class="tracker-plot"><svg viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" role="img" aria-label="' + esc(describe) + '">' +
      [0, high].map(function (v) { return '<line x1="' + L + '" x2="' + W + '" y1="' + y(v) + '" y2="' + y(v) + '" class="tracker-plot__rule"/><text x="' + (L - 6) + '" y="' + (y(v) + 4) + '" text-anchor="end" class="tracker-plot__tick">' + v + '</text>'; }).join('') +
      shown.map(function (p, i) {
        var cx = L + step * (i + 0.5), end = i === shown.length - 1;
        return '<rect x="' + (cx - bar / 2) + '" y="' + y(p.value) + '" width="' + bar + '" height="' + Math.max(1, y(0) - y(p.value)) + '" rx="5" fill="' + (end ? color : '#F3E2CC') + '" stroke="' + color + '" stroke-width="1.6"/>' +
          '<text x="' + cx + '" y="' + (y(p.value) - 6) + '" text-anchor="middle" class="tracker-plot__value">' + esc(p.label) + '</text><text x="' + cx + '" y="' + (H - 8) + '" text-anchor="middle" class="tracker-plot__tick">' + short(p.at) + '</text>';
      }).join('') + '</svg>' + (shown.length < points.length ? '<p class="tracker-note">The latest ' + shown.length + ' of ' + points.length + '. The table lists them all.</p>' : '') + '</div>';
  }

  function card(o) {
    var id = 'trackerTable-' + o.key, open = !!openTables[o.key];
    return '<article class="tracker-card' + (o.rest ? ' tracker-card--rest' : '') + '" data-testid="tracker-' + o.key + '" style="border-top-color:' + o.color + '"><h3 class="tracker-card__name">' + o.name + '</h3>' +
      (o.rest ? '<p class="tracker-card__rest">At rest &mdash; no result yet.</p>'
        : '<p class="tracker-card__headline">' + o.headline + (o.chip ? '<span class="tracker-card__chip">' + esc(o.chip) + '</span>' : '') + '</p><p class="tracker-card__change">' + o.change + '</p>' + o.body) +
      '<div class="tracker-card__foot">' + (o.table ? '<button type="button" class="tracker-btn" data-tracker-table="' + o.key + '" aria-expanded="' + open + '" aria-controls="' + id + '">' + (open ? 'Hide table' : 'Show table') + '<span class="sr-only">: ' + o.name + ' results</span></button>' : '') +
      '<button type="button" class="tracker-btn tracker-btn--main" data-tracker-go="' + o.view + '">' + o.action + '<span class="sr-only"> ' + o.name + '</span></button></div>' +
      (o.table ? '<div id="' + id + '" class="tracker-table"' + (open ? '' : ' hidden') + '><table><caption class="sr-only">' + o.name + ' results</caption><thead><tr>' + o.table.heads.map(function (h) { return '<th scope="col">' + h + '</th>'; }).join('') + '</tr></thead><tbody>' +
        o.table.rows.map(function (r) { return '<tr>' + r.map(function (c, j) { return j ? '<td>' + esc(c) + '</td>' : '<th scope="row">' + esc(c) + '</th>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>' : '') + '</article>';
  }

  function change(points, digits) {
    if (points.length === 1) return 'First result, ' + short(points[0].at, true) + '. <b>Lower is better.</b>';
    var delta = points[points.length - 1].value - points[points.length - 2].value, when = stamp(points, points.length - 2);
    return (delta === 0 ? 'No change since ' + when + '.' : (delta < 0 ? 'Down ' : 'Up ') + Math.abs(delta).toFixed(digits) + ' since ' + when + '.') + ' <b>Lower is better.</b>';
  }
  function say(name, points) { return name + ', ' + points.map(function (p) { return p.label + ' on ' + short(p.at, true); }).join(', ') + '.'; }

  function render() {
    var host = document.getElementById('trackerCards');
    if (!host || !window.VeyeCalculations) return;
    var E = VeyeCalculations, W = 420, out = [];
    var wide = host.clientWidth;
    if (wide) W = Math.max(240, Math.round((wide > 760 ? (wide - 20) / 2 : wide) - (wide > 480 ? 50 : 34)));

    var hn = history('veye_health_quiz').filter(function (h) { return typeof h.result.number === 'number'; });
    var base = { key: 'health-number', name: 'Health Number', color: '#2F5F9E', view: 'quiz-health' };
    if (!hn.length) out.push(card(Object.assign(base, { rest: true, action: 'Take the quiz' })));
    else {
      var pts = hn.map(function (h) { return { at: h.at, value: h.result.number, label: h.result.number.toFixed(1), status: h.result.status }; }), now = pts[pts.length - 1];
      var hnBands = bandsOf(E.healthNumber.MIN, E.healthNumber.MAX, 0.5, function (v) { return E.healthNumber.interpret(v, {}); });
      out.push(card(Object.assign(base, { action: 'Retake', headline: now.label, chip: now.status, change: change(pts, 1),
        body: line(pts, E.healthNumber.MIN, E.healthNumber.MAX, base.color, hnBands, 0.5, '', say('Health Number', pts) + ' Lower is better.', W),
        table: { heads: ['Date', 'Health Number', 'Band'], rows: pts.slice().reverse().map(function (p) { return [short(p.at, true), p.label, p.status]; }) } })));
    }

    var ha = history('veye_assessment').filter(function (h) { return typeof h.result.total === 'number'; });
    base = { key: 'health-assessment', name: 'Health Assessment', color: '#5B4A9C', view: 'assessment' };
    if (!ha.length) out.push(card(Object.assign(base, { rest: true, action: 'Take the assessment' })));
    else {
      var hp = ha.map(function (h) { return { at: h.at, value: h.result.total, label: String(h.result.total), status: E.hsr.interpret(h.result.total).status }; }), hnow = hp[hp.length - 1];
      out.push(card(Object.assign(base, { action: 'Retake', headline: hnow.label + ' <small>of 33</small>', chip: hnow.status, change: change(hp, 0),
        body: line(hp, 11, 33, base.color, bandsOf(11, 33, 1, E.hsr.interpret), 1, '', say('Health Assessment', hp) + ' Lower is better.', W),
        table: { heads: ['Date', 'Score', 'Band'], rows: hp.slice().reverse().map(function (p) { return [short(p.at, true), p.label, p.status]; }) } })));
    }

    var entries = (((load('veye_blood') || {}).entries) || []).slice().sort(function (a, b) { return Date.parse(a.date) - Date.parse(b.date); });
    base = { key: 'blood-markers', name: 'Blood Markers', color: '#B2483B', view: 'blood' };
    if (!entries.length) out.push(card(Object.assign(base, { rest: true, action: 'Add results' })));
    else {
      var value = function (e, m) { return num(e[m.from || m.key]); };
      var tally = function (e) { var known = MARKERS.filter(function (m) { return value(e, m) !== null; }); return { known: known.length, good: known.filter(function (m) { return E.blood.GOALS[m.key].test(value(e, m)); }).length }; };
      var bNow = entries[entries.length - 1], bWas = entries[entries.length - 2], t = tally(bNow), w = bWas ? tally(bWas) : null;
      var listHtml = '<ul class="marker-list">' + MARKERS.map(function (m) {
        var text = E.blood.GOALS[m.key].goal, range = text.match(/[\d.]+/g).map(Number), lowG = range.length > 1 ? range[0] : null, highG = range[range.length - 1];
        var v = value(bNow, m), prev = bWas ? value(bWas, m) : null, ok = v !== null && E.blood.GOALS[m.key].test(v);
        var top = Math.max(highG * 2, v || 0, prev || 0) * 1.1 || 1;
        var bottom = lowG ? Math.max(0, Math.min(lowG - (highG - lowG) * 2, v === null ? lowG : v, prev === null ? lowG : prev)) : 0;
        var x = function (n) { return Math.min(100, Math.max(0, ((n - bottom) / (top - bottom)) * 100)) + '%'; };
        return '<li data-marker="' + m.key + '"><span class="marker-list__name"><b>' + m.label + '</b><small>ideal ' + esc(text.replace('<', 'below').replace('-', ' – ').replace('%', ' %')) + '</small></span>' +
          '<span class="marker-list__track" aria-hidden="true"><span class="marker-list__goal" style="left:' + x(lowG === null ? bottom : lowG) + ';right:calc(100% - ' + x(highG) + ')"></span>' +
          (prev === null ? '' : '<span class="marker-list__was" style="left:' + x(prev) + '"></span>') + (v === null ? '' : '<span class="marker-list__now' + (ok ? ' is-in' : '') + '" style="left:' + x(v) + '"></span>') + '</span>' +
          '<span class="marker-list__value">' + (v === null ? '<span class="marker-list__none">Not entered</span>' : '<b>' + v + m.unit + '</b> ' + (ok ? 'in range' : 'outside')) + '</span></li>';
      }).join('') + '</ul><p class="tracker-note">Dot: latest, filled inside the ideal range. ' + (bWas ? 'Grey tick: the result before. ' : '') + 'Other markers have no ideal range from Veye, so none is drawn.</p>';
      out.push(card(Object.assign(base, { action: 'Add results', headline: t.known ? t.good + ' of ' + t.known + ' <small>in the ideal range</small>' : '<small>No marker with an ideal range yet</small>',
        change: 'On ' + short(Date.parse(bNow.date), true) + '.' + (w && w.known ? ' On ' + short(Date.parse(bWas.date), true) + ': ' + w.good + ' of ' + w.known + '.' : ''), body: listHtml,
        table: { heads: ['Date'].concat(MARKERS.map(function (m) { return m.label; })), rows: entries.slice().reverse().map(function (e) { return [short(Date.parse(e.date), true)].concat(MARKERS.map(function (m) { var v = value(e, m); return v === null ? '—' : v + m.unit; })); }) } })));
    }

    var bc = history('veye_bmi');
    base = { key: 'body-composition', name: 'Body Composition', color: '#2F7A35', view: 'bmi' };
    if (!bc.length) out.push(card(Object.assign(base, { rest: true, action: 'Add measurements' })));
    else {
      var fat = bc.filter(function (h) { return num(h.result.bf) !== null; }).map(function (h) { return { at: h.at, value: num(h.result.bf), label: num(h.result.bf) + '%' }; });
      var bmi = bc.filter(function (h) { return num(h.result.bmi) !== null; }).map(function (h) { return { at: h.at, value: num(h.result.bmi), label: num(h.result.bmi).toFixed(1) }; });
      var asBmi = !!(showBmi && bmi.length) || !fat.length, set = asBmi ? bmi : fat, latest = bc[bc.length - 1].result;
      var cNow = set[set.length - 1], cWas = set[set.length - 2];
      var lo = Math.min.apply(null, set.map(function (p) { return p.value; })), hi = Math.max.apply(null, set.map(function (p) { return p.value; })), pad = Math.max(1, Math.ceil((hi - lo) * 0.25));
      out.push(card(Object.assign(base, { action: 'Update',
        headline: cNow ? cNow.label + ' <small>' + (asBmi ? 'BMI' : 'body fat') + '</small>' : '<small>No supported result</small>',
        change: (!cNow ? '' : !cWas ? 'First result, ' + short(cNow.at, true) + '.' : cNow.value === cWas.value ? 'No change since ' + stamp(set, set.length - 2) + '.' : Math.abs(cNow.value - cWas.value).toFixed(1) + (asBmi ? '' : ' points') + (cNow.value < cWas.value ? ' lower' : ' higher') + ' than ' + stamp(set, set.length - 2) + '.') +
          (!asBmi && num(latest.bmi) !== null ? ' Standard BMI ' + num(latest.bmi).toFixed(1) + ', reported separately.' : ''),
        body: (fat.length && bmi.length ? '<div class="tracker-switch" role="group" aria-label="Which measure"><button type="button" data-tracker-measure="fat" aria-pressed="' + !asBmi + '">Body fat</button><button type="button" data-tracker-measure="bmi" aria-pressed="' + asBmi + '">BMI</button></div>' : '') +
          (cNow ? line(set, Math.max(0, Math.floor(lo) - pad), Math.ceil(hi) + pad, base.color, null, 1, asBmi ? '' : '%', say(asBmi ? 'BMI' : 'Body fat', set), W) : '') + '<p class="tracker-note">Veye has no range for this, so none is drawn.</p>',
        table: { heads: ['Date', 'Body fat', 'BMI'], rows: bc.slice().reverse().map(function (h) { return [short(h.at, true), num(h.result.bf) === null ? 'Not available' : num(h.result.bf) + '%', num(h.result.bmi) === null ? '—' : num(h.result.bmi).toFixed(1)]; }) } })));
    }

    var sq = history('veye_simple_quiz').filter(function (h) { return typeof h.result.noCount === 'number'; });
    base = { key: 'simple-quiz', name: 'Simple Quiz', color: '#B5650A', view: 'quiz-simple' };
    if (!sq.length) out.push(card(Object.assign(base, { rest: true, action: 'Take the quiz' })));
    else {
      var sp = sq.map(function (h) { return { at: h.at, value: h.result.noCount, label: String(h.result.noCount), yes: h.result.yesCount }; }), sNow = sp[sp.length - 1], of = sNow.value + sNow.yes;
      out.push(card(Object.assign(base, { action: 'Take the quiz', headline: sNow.value + ' No <small>of ' + of + ' answers</small>',
        change: 'On ' + short(sNow.at, true) + '.' + (sp.length > 1 ? ' On ' + stamp(sp, sp.length - 2) + ': ' + sp[sp.length - 2].value + ' No.' : ''),
        body: barsChart(sp, of, base.color, say('Simple Quiz No answers', sp), W) + '<p class="tracker-note">A count of answers, nothing more.</p>',
        table: { heads: ['Date', 'No', 'Yes'], rows: sp.slice().reverse().map(function (p) { return [short(p.at, true), p.label, String(p.yes)]; }) } })));
    }
    host.innerHTML = out.join('');
  }

  document.addEventListener('click', function (e) {
    var el = e.target.closest && e.target.closest('[data-tracker-table],[data-tracker-go],[data-tracker-measure]');
    if (!el || !document.getElementById('trackerCards').contains(el)) return;
    var again = function (selector) { render(); var next = document.querySelector(selector); if (next) next.focus(); };
    if (el.dataset.trackerTable) { openTables[el.dataset.trackerTable] = !openTables[el.dataset.trackerTable]; again('[data-tracker-table="' + el.dataset.trackerTable + '"]'); }
    else if (el.dataset.trackerMeasure) { showBmi = el.dataset.trackerMeasure === 'bmi'; again('[data-tracker-measure="' + el.dataset.trackerMeasure + '"]'); }
    else if (window.VeyeTrackerGo) window.VeyeTrackerGo(el.dataset.trackerGo);
  });
  var timer = null, lastWidth = 0;
  window.addEventListener('resize', function () {
    var host = document.getElementById('trackerCards');
    if (!host || host.clientWidth === lastWidth) return;
    lastWidth = host.clientWidth; clearTimeout(timer); timer = setTimeout(render, 120);
  });
  window.VeyeTrackerCards = { render: render };
})();
