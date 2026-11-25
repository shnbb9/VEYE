/* ============================================================================
   Care Studio → Fitness library
   ----------------------------------------------------------------------------
   The console's screen (platform/web app/admin/care/fitness-library): the
   member Fitness screen's four goals, filled with YouTube or Vimeo links. One
   video per goal is the main video; the rest follow in this order, nine to a
   page. Hidden videos stay here. Veye stores links, never video files — and
   this prototype looks nothing up, so it shows no picture from the provider.
   ============================================================================ */

(function () {

const { icon } = window.Veye;
const R = window.Veye.R;
const S = window.Veye.S;
const H = window.Veye.H;
const UI = window.Veye.UI;
const esc = UI.esc;

const GOALS = [['stronger', 'Get Stronger'], ['weight', 'Lose Weight'], ['fit', 'Get Fit'], ['performance', 'Boost Performance']];
const label = (key) => GOALS.find(([k]) => k === key)[1];
const NAV = [['fitness', 'Fitness'], ['supplement', 'Supplements'], ['resource', 'Resources']].map(([k, l]) => ({ key: k, label: l, route: '/care/' + k }))
  .concat([{ key: 'library', label: 'Fitness library', route: '/care/fitness-library' }]);

/** The video's address, or null: only the providers the console accepts. */
function parseLink(raw) {
  let url;
  try { url = new URL(raw.trim()); } catch (e) { return null; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const host = url.hostname.replace(/^www\.|^m\./, '').toLowerCase();
  const id = (v) => (/^[A-Za-z0-9_-]{11}$/.test(v || '') ? v : null);
  if (host === 'youtu.be') return id(url.pathname.slice(1)) && { provider: 'youtube', url: url.href };
  if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    const v = url.searchParams.get('v') || (url.pathname.match(/^\/(?:embed|shorts|live)\/([^/]+)/) || [])[1];
    return id(v) && { provider: 'youtube', url: url.href };
  }
  if (host === 'vimeo.com' || host === 'player.vimeo.com') return /\/(\d{6,12})(?:\/[0-9a-f]+)?\/?$/.test(url.pathname) ? { provider: 'vimeo', url: url.href } : null;
  return null;
}

let view = { goal: 'weight', note: '', error: '', editing: null, form: { url: '', title: '', subtitle: '' } };

const all = () => S.get().fitnessVideos;
const inGoal = (goal) => all().filter((v) => v.goal === goal).sort((a, b) => a.order - b.order);
const save = (videos) => S.set({ fitnessVideos: videos }, { silent: true });
/** Every goal with a published video has exactly one main video. */
function settle(goal) {
  const shown = inGoal(goal).filter((v) => v.published);
  const main = shown.find((v) => v.is_main) || shown[0];
  save(all().map((v) => (v.goal === goal ? { ...v, is_main: !!main && v.id === main.id } : v)));
}

function render(outlet) {
  const videos = inGoal(view.goal);
  outlet.innerHTML = `<div class="page">
    ${H.pageHead({ title: 'Fitness library', desc: 'The videos members see on the Fitness screen, goal by goal. The main video plays at the top; the rest follow in this order, nine to a page.',
      crumbs: [{ label: 'Home', route: '/home' }, { label: 'Care Studio', route: '/care' }, { label: 'Fitness library' }] })}
    ${H.subnav(NAV, 'library')}
    <div class="row gap-2 wrap" role="group" aria-label="Goal" style="margin-bottom:var(--s-5)" data-testid="fitness-goals">
      ${GOALS.map(([k, l]) => `<button type="button" class="btn btn--sm ${k === view.goal ? 'btn--primary' : 'btn--secondary'}" aria-pressed="${k === view.goal}" data-goal="${k}">${l} (${inGoal(k).length})</button>`).join('')}
    </div>
    ${H.errorbar(view.error)}
    ${view.note ? `<p class="notice notice--quiet" role="status" data-testid="fitness-note">${esc(view.note)}</p>` : ''}
    <div class="card" style="margin-bottom:var(--s-5)">
      <div class="card__head"><h2 class="card__title">Add a video to ${label(view.goal)}</h2></div>
      <form class="card__body stack gap-4" method="post" id="fitForm" data-testid="fitness-add" novalidate>
        ${H.field({ id: 'fit-url', label: 'YouTube or Vimeo link', type: 'url', required: true, maxlength: 500, placeholder: 'https://youtu.be/…  or  https://vimeo.com/…', value: view.form.url,
          hint: 'Unlisted videos work. Members watch them inside Veye, in the provider’s privacy-enhanced player.' })}
        ${H.field({ id: 'fit-title', label: 'Title members see', required: true, maxlength: 160, value: view.form.title })}
        ${H.field({ id: 'fit-subtitle', label: 'Subtitle', maxlength: 200, value: view.form.subtitle })}
        <div><button class="btn btn--primary" type="submit">${icon('plus', { size: 18 })} Add video</button></div>
      </form>
    </div>
    <div class="card">
      <div class="card__head"><h2 class="card__title">${label(view.goal)} — ${videos.length} video${videos.length === 1 ? '' : 's'}</h2></div>
      <div class="rows" data-testid="fitness-list">
        ${videos.length ? '' : `<p class="t-support" style="padding:var(--s-5)">No videos in ${label(view.goal)} yet. The first one you add becomes the main video.</p>`}
        ${videos.map((v, i) => `<div class="rowitem" style="grid-template-columns:128px minmax(0,1fr) auto" data-testid="fitness-row">
          <span class="fit-still" aria-hidden="true">${icon('video', { size: 26 })}</span>
          <div>${view.editing === v.id ? `<div class="stack gap-2">
              <input class="input" aria-label="Title" maxlength="160" id="editTitle" value="${esc(v.title)}"><input class="input" aria-label="Subtitle" maxlength="200" id="editSubtitle" value="${esc(v.subtitle)}">
              <div class="row gap-2"><button class="btn btn--primary btn--sm" type="button" data-save="${v.id}">Save</button><button class="btn btn--ghost btn--sm" type="button" data-cancel>Cancel</button></div></div>`
            : `<div class="rowitem__title">${esc(v.title)} ${v.is_main ? H.chip('Main video', 'live') : ''}${v.published ? '' : H.chip('Hidden', 'archived')}</div>
              ${v.subtitle ? `<div class="rowitem__meta">${esc(v.subtitle)}</div>` : ''}
              <div class="rowitem__meta">${v.provider === 'vimeo' ? 'Vimeo' : 'YouTube'} · Updated ${esc(H.fmtDate(v.updated_at))}</div>`}</div>
          <div class="rowitem__side row gap-2 wrap" style="justify-content:flex-end">
            ${!v.is_main && v.published ? `<button class="btn btn--secondary btn--sm" type="button" data-main="${v.id}">Make main video</button>` : ''}
            <button class="btn btn--ghost btn--sm" type="button" data-move="${v.id}" data-by="-1" ${i === 0 ? 'disabled' : ''} aria-label="Move ${esc(v.title)} up">↑</button>
            <button class="btn btn--ghost btn--sm" type="button" data-move="${v.id}" data-by="1" ${i === videos.length - 1 ? 'disabled' : ''} aria-label="Move ${esc(v.title)} down">↓</button>
            <button class="btn btn--ghost btn--sm" type="button" data-toggle="${v.id}">${v.published ? 'Hide' : 'Show'}</button>
            <button class="btn btn--ghost btn--sm" type="button" data-edit="${v.id}">Edit</button>
            <button class="btn btn--ghost btn--sm" type="button" data-remove="${v.id}">Remove</button>
          </div></div>`).join('')}
      </div>
    </div>
  </div>`;

  const done = (note) => { view.note = note; view.error = ''; render(outlet); };
  const change = (id, patch) => save(all().map((v) => (v.id === id ? { ...v, ...patch, updated_at: S.now() } : v)));
  const on = (attr, fn) => outlet.querySelectorAll(`[data-${attr}]`).forEach((b) => b.addEventListener('click', () => fn(all().find((v) => v.id === b.dataset[attr]), b)));
  outlet.querySelectorAll('[data-goal]').forEach((b) => b.addEventListener('click', () => { view = { ...view, goal: b.dataset.goal, editing: null, note: '', error: '' }; render(outlet); }));
  const form = outlet.querySelector('#fitForm');
  form.addEventListener('input', () => { view.form = { url: form.querySelector('#fit-url').value, title: form.querySelector('#fit-title').value, subtitle: form.querySelector('#fit-subtitle').value }; });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const { url, title, subtitle } = view.form;
    const link = parseLink(url);
    if (!title.trim()) { view.error = 'Give the video the title members see.'; render(outlet); return; }
    if (!link) { view.error = 'That is not a YouTube or Vimeo video link.'; render(outlet); return; }
    if (inGoal(view.goal).some((v) => v.url === link.url)) { view.error = `That video is already in ${label(view.goal)}.`; render(outlet); return; }
    const order = Math.max(0, ...inGoal(view.goal).map((v) => v.order)) + 1;
    save([...all(), { id: S.newId(), goal: view.goal, title: title.trim(), subtitle: subtitle.trim(), provider: link.provider, url: link.url, order, published: true, is_main: false, updated_at: S.now() }]);
    settle(view.goal);
    S.audit('fitness_video.added', 'fitness_video', view.goal, { goal: view.goal });
    view.form = { url: '', title: '', subtitle: '' };
    done(`“${title.trim()}” is in ${label(view.goal)}.`);
  });
  on('main', (v) => { save(all().map((x) => (x.goal === v.goal ? { ...x, is_main: x.id === v.id } : x))); done(`“${v.title}” is now the main video.`); });
  on('move', (v, b) => {
    const list = inGoal(v.goal); const i = list.findIndex((x) => x.id === v.id); const other = list[i + Number(b.dataset.by)];
    change(v.id, { order: other.order }); change(other.id, { order: v.order }); done('The order is saved.');
  });
  on('toggle', (v) => { change(v.id, { published: !v.published }); settle(v.goal); done(v.published ? 'Hidden from members.' : 'Shown to members.'); });
  on('edit', (v) => { view.editing = v.id; render(outlet); });
  on('save', (v) => { const title = outlet.querySelector('#editTitle').value.trim(); if (!title) return; change(v.id, { title, subtitle: outlet.querySelector('#editSubtitle').value.trim() }); view.editing = null; done('Saved.'); });
  outlet.querySelectorAll('[data-cancel]').forEach((b) => b.addEventListener('click', () => { view.editing = null; render(outlet); }));
  on('remove', async (v) => {
    const r = await UI.confirm({ title: 'Remove this video?', message: `“${esc(v.title)}” leaves ${label(v.goal)}. Members stop seeing it at once.`, reversible: 'You can add the link again.', confirmLabel: 'Remove', danger: true });
    if (!r.ok) return;
    save(all().filter((x) => x.id !== v.id)); settle(v.goal); done('Removed.');
  });
}

window.Veye.screens = window.Veye.screens || {};
window.Veye.screens['fitness-library'] = { render: (outlet) => { view = { goal: 'weight', note: '', error: '', editing: null, form: { url: '', title: '', subtitle: '' } }; render(outlet); } };

})();
