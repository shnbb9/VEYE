/* The Food Diary's History as a month, drawn as the application draws it
   (platform/web/components/member/diary-calendar.tsx and lib/diary-dates.ts):
   which days have meals, which were saved, one press to open any of them.

   Days are the member's own, as YYYY-MM-DD, worked out on local year, month
   and day at noon. A key is never turned into an instant and back: read as
   midnight in Greenwich it is the day before for half of the world. */
(function () {
  'use strict';
  const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const parts = key => key.split('-').map(Number);
  const at = (y, m, d) => new Date(y, m, d, 12);
  const keyOf = date => date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
  const toDate = key => { const p = parts(key); return at(p[0], p[1] - 1, p[2]); };
  const addDays = (key, n) => { const p = parts(key); return keyOf(at(p[0], p[1] - 1, p[2] + n)); };
  /* The 31st of January becomes the last day of February, not the 3rd of March. */
  function addMonths(key, n) {
    const p = parts(key);
    const last = at(p[0], p[1] + n, 0).getDate();
    return keyOf(at(p[0], p[1] - 1 + n, Math.min(p[2], last)));
  }
  const monthOf = key => key.slice(0, 7);
  /* Six weeks from Sunday, so every month has the same height. */
  function monthWeeks(month) {
    const p = month.split('-').map(Number);
    const lead = at(p[0], p[1] - 1, 1).getDay();
    const count = at(p[0], p[1], 0).getDate();
    return Array.from({ length: 6 }, (_, week) => Array.from({ length: 7 }, (_, i) => {
      const d = week * 7 + i - lead + 1;
      return d >= 1 && d <= count ? month + '-' + String(d).padStart(2, '0') : null;
    }));
  }
  const say = (key, options) => toDate(key).toLocaleDateString(undefined, options);
  const longDay = key => say(key, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const shortDay = key => say(key, { weekday: 'long', month: 'long', day: 'numeric' });
  const monthLabel = month => say(month + '-01', { month: 'long', year: 'numeric' });
  const mealsOf = n => n + ' meal' + (n === 1 ? '' : 's');

  /* `rows` is what the History list shows, so the two can never disagree:
     { key: { meals, kcal, saved } }. */
  function mount(box, onSelect) {
    let month = null, cursor = null, selected = null, today = null, rows = {}, follow = false;

    const spoken = key => {
      const row = rows[key];
      return longDay(key) + ', ' + (row && row.meals > 0 ? mealsOf(row.meals) + ' logged' : 'nothing logged') + (row && row.saved ? ', saved' : '');
    };
    const tabbable = () => (monthOf(cursor) === month ? cursor : monthOf(selected) === month ? selected : monthOf(today) === month ? today : month + '-01');
    function cell(key, stop) {
      const row = rows[key];
      const classes = ['fdxcal-cell', row && row.meals > 0 && 'has-meals', row && row.saved && 'is-saved', key === selected && 'is-open',
        key === today && 'is-today', key > today && 'is-ahead'].filter(Boolean).join(' ');
      return '<span role="gridcell" aria-selected="' + (key === selected) + '"><button type="button" data-cal-day="' + key + '" tabindex="' + (key === stop ? 0 : -1) +
        '" class="' + classes + '" aria-label="' + spoken(key) + '"' + (key === today ? ' aria-current="date"' : '') + '><span class="fdxcal-num">' + toDate(key).getDate() +
        '</span><i class="fdxcal-mark" aria-hidden="true"></i></button></span>';
    }
    function draw(turned) {
      const stop = tabbable();
      const open = rows[selected];
      const note = open && open.meals > 0 ? mealsOf(open.meals) + ' · ~' + open.kcal + ' kcal' + (open.saved ? ' · saved' : '')
        : open && open.saved ? 'Saved, with nothing logged.' : 'Nothing logged on this day.';
      box.innerHTML =
        '<div class="fdxcal"><div class="fdxcal-head"><button class="fdxcal-turn" type="button" data-cal-turn="-1" aria-label="Previous month">&lsaquo;</button>' +
        '<h4 class="fdxcal-month" id="fdxCalMonth" aria-live="polite">' + monthLabel(month) + '</h4>' +
        '<button class="fdxcal-turn" type="button" data-cal-turn="1" aria-label="Next month">&rsaquo;</button></div>' +
        '<div class="fdxcal-grid" role="grid" aria-labelledby="fdxCalMonth"><div class="fdxcal-row fdxcal-row--head" role="row">' +
        WEEKDAYS.map(name => '<span class="fdxcal-weekday" role="columnheader" aria-label="' + name + '">' + name.slice(0, 2) + '</span>').join('') + '</div>' +
        '<div class="fdxcal-weeks' + (turned ? '' : ' is-still') + '" role="rowgroup">' + monthWeeks(month).map(week => '<div class="fdxcal-row" role="row">' +
          week.map(key => key === null ? '<span class="fdxcal-blank" role="gridcell" aria-hidden="true"></span>' : cell(key, stop)).join('') + '</div>').join('') + '</div></div>' +
        '<div class="fdxcal-foot"><p class="fdxcal-legend" aria-hidden="true"><span><i class="fdxcal-mark fdxcal-mark--logged"></i> Logged</span>' +
        '<span><i class="fdxcal-mark fdxcal-mark--saved"></i> Saved</span></p>' +
        (month !== monthOf(today) ? '<button class="fdxcal-today" type="button" data-cal-today>This month</button>' : '') + '</div>' +
        '<p class="fdxcal-day"><b>' + shortDay(selected) + '</b> ' + note + '</p></div>';
      if (follow) { follow = false; const el = box.querySelector('[data-cal-day="' + cursor + '"]'); if (el) el.focus(); }
    }
    function step(key, shift, from) {
      switch (key) {
        case 'ArrowLeft': return addDays(from, -1);
        case 'ArrowRight': return addDays(from, 1);
        case 'ArrowUp': return addDays(from, -7);
        case 'ArrowDown': return addDays(from, 7);
        case 'Home': return addDays(from, -toDate(from).getDay());
        case 'End': return addDays(from, 6 - toDate(from).getDay());
        case 'PageUp': return addMonths(from, shift ? -12 : -1);
        case 'PageDown': return addMonths(from, shift ? 12 : 1);
        default: return null;
      }
    }
    box.addEventListener('click', event => {
      const turn = event.target.closest('[data-cal-turn]');
      if (turn) { const by = turn.dataset.calTurn; month = monthOf(addMonths(month + '-01', Number(by))); draw(true); box.querySelector('[data-cal-turn="' + by + '"]').focus(); return; }
      if (event.target.closest('[data-cal-today]')) { month = monthOf(today); draw(true); return; }
      const day = event.target.closest('[data-cal-day]');
      if (day) onSelect(day.dataset.calDay, event.detail > 0);
    });
    box.addEventListener('keydown', event => {
      const to = event.target.closest('[data-cal-day]') && step(event.key, event.shiftKey, tabbable());
      if (!to) return;
      event.preventDefault();
      const turned = monthOf(to) !== month;
      cursor = to; month = monthOf(to); follow = true;
      draw(turned);
    });
    return {
      show(state) {
        const moved = state.selected !== selected;
        const focused = box.contains(document.activeElement) && document.activeElement.dataset.calDay;
        selected = state.selected; today = state.today; rows = state.rows;
        const was = month;
        if (moved || month === null) { month = monthOf(selected); cursor = selected; }
        if (focused) { cursor = selected; follow = true; }
        draw(was !== month);
      },
    };
  }

  window.VeyeDiaryCalendar = { mount: mount, addDays: addDays, addMonths: addMonths, monthWeeks: monthWeeks, shortDay: shortDay, keyOf: keyOf };
})();
