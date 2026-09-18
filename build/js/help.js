// VEYE — Help page: category filtering, live search, and "Ask a Question".
// All five categories carry the client's copy; the empty state is kept for a
// search that matches nothing.
(function () {
  var cats   = Array.prototype.slice.call(document.querySelectorAll('.help-cat'));
  var items  = Array.prototype.slice.call(document.querySelectorAll('.faq__item'));
  var cols   = Array.prototype.slice.call(document.querySelectorAll('.faq__col'));
  var empty  = document.querySelector('.faq__empty');
  var ask    = document.getElementById('helpAsk');
  var input  = document.querySelector('.help-search__input');
  var head   = document.querySelector('.help__cat');
  if (!items.length) return;

  var activeCat = 'diet';    // matches the button marked active in the markup
  var query = '';

  var CAT_TITLES = {
    about:        'About Veye',
    subscription: 'Subscription and My Account',
    diet:         'Diet and Nutrition Terminology',
    platform:     'Using the Platform',
    technical:    'Technical Issues'
  };

  function matches(item) {
    if (query) return item.textContent.toLowerCase().indexOf(query) > -1;
    return item.getAttribute('data-cat') === activeCat;
  }

  function render() {
    // the heading tracks whatever the list is currently showing: the active
    // category, or "Search Results" while a query is in the field
    if (head) {
      var title = query ? 'Search Results' : CAT_TITLES[activeCat];
      if (title) head.textContent = title;
    }

    var count = 0;
    items.forEach(function (item) {
      var ok = matches(item);
      if (ok) count++;
      item.hidden = !ok;
    });
    var total = items.filter(matches).length;

    // hide a column entirely when it has nothing left, so the grid gap doesn't
    // leave a stranded empty track
    cols.forEach(function (col) {
      var any = Array.prototype.slice.call(col.querySelectorAll('.faq__item'))
        .some(function (i) { return !i.hidden; });
      col.hidden = !any;
    });

    if (empty) {
      empty.hidden = total !== 0;
      empty.textContent = query
        ? 'No articles match “' + query + '”.'
        : 'No articles in this category yet.';
    }
  }

  cats.forEach(function (btn) {
    btn.addEventListener('click', function () {
      activeCat = btn.getAttribute('data-cat');
      query = '';
      if (input) input.value = '';
      cats.forEach(function (b) {
        var on = b === btn;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      render();
    });
  });

  if (input) {
    input.addEventListener('input', function () {
      query = input.value.trim().toLowerCase();
      // searching looks across every category, so drop the category highlight
      if (query) cats.forEach(function (b) { b.classList.remove('is-active'); b.setAttribute('aria-pressed', 'false'); });
      else cats.forEach(function (b) {
        var on = b.getAttribute('data-cat') === activeCat;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      render();
    });
  }

  // "Ask a Question" — prototype only: opens a field, accepts a question and
  // acknowledges it. Deliberately not wired to AI, an API, email or storage.
  if (ask) {
    var panel  = document.getElementById('helpAskPanel');
    var field  = document.getElementById('helpAskInput');
    var submit = document.getElementById('helpAskSubmit');
    var done   = document.getElementById('helpAskDone');

    ask.addEventListener('click', function () {
      var open = panel.hidden;
      panel.hidden = !open;
      ask.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open && field) field.focus();
    });

    function send() {
      if (!field || !field.value.trim()) { if (field) field.focus(); return; }
      field.value = '';
      done.hidden = false;
      setTimeout(function () { done.hidden = true; }, 4000);
    }
    if (submit) submit.addEventListener('click', send);
    if (field) field.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); send(); }
    });
  }

  render();
})();
