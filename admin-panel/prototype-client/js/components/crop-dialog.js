/* ============================================================================
   Veye Admin — the circular crop editor
   ----------------------------------------------------------------------------
   The console's AvatarCropDialog (platform/web components/avatar-crop-dialog.
   tsx) in plain script, for Settings → Your account (owner request, 15 Nov
   2026: "crop it exactly like it's going to appear in my avatar"). The same
   words, controls and sizes; styles are the crop-* rules in css/prototype.css,
   and the buttons borrow the console's own classes, as there.

   The administrator moves and zooms the picture inside a square frame whose
   inscribed circle IS the avatar. What is saved is the square in the kept
   original's own pixels, { x, y, size }; both avatar sizes are cut from that
   square, so the frame, the two previews and the saved avatar are the same
   pixels. Moving: drag (mouse, touch, pen), two-finger pinch, the wheel, the
   zoom slider and its buttons, or the keyboard on the focused frame (arrows
   move, + and - zoom, 0 resets).

   PROTOTYPE SIMPLIFICATION: there is no server, so the picture is made
   smaller in the browser and kept in this prototype's localStorage state —
   the original at most 1600 px on its long side, the avatar at the API's
   512 px (full) and 128 px (thumb). The console keeps the upload itself and
   cuts its sizes on the server. Re-encoding as JPEG drops EXIF (location,
   camera), as the API's rebuild does; a transparent PNG is laid on white.
   ============================================================================ */

(function () {

const esc = window.Veye.UI.esc;

const TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 10000000;   // the console's limit, 10 MB
const MIN_CROP_SIDE = 64;     // never zoom in past a 64 px square of the original
const MAX_ZOOM = 8;
const KEY_STEP = 10;          // CSS px per arrow press (Shift: four times that)
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

/** The console's checks before anything is read; '' when the file is fine. */
function refusal(file) {
  if (!file || TYPES.indexOf(file.type) < 0) return 'Please choose a JPG, PNG or WebP image.';
  if (file.size > MAX_BYTES) return 'The photo is too large. Please use an image under 10 MB.';
  return '';
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => (img.naturalWidth && img.naturalHeight ? resolve(img) : reject(new Error('unreadable')));
    img.onerror = () => reject(new Error('unreadable'));
    img.src = src;
  });
}

/** JPEG data URL: the whole picture at most `maxSide` px on its long side,
    or — with a crop — that square at `side` px. Browsers draw a phone photo
    upright (EXIF orientation), so these are the pixels the editor showed. */
function toJpeg(img, o) {
  let sx = 0, sy = 0, sw = img.naturalWidth, sh = img.naturalHeight, w, h;
  if (o.crop) { sx = o.crop.x; sy = o.crop.y; sw = sh = o.crop.size; w = h = o.side; }
  else {
    const k = Math.min(1, o.maxSide / Math.max(sw, sh));
    w = Math.max(1, Math.round(sw * k)); h = Math.max(1, Math.round(sh * k));
  }
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', o.quality);
}

/** The original that is kept to be cut from again (see the note above). */
function keepOriginal(file) {
  const url = URL.createObjectURL(file);
  return loadImage(url).then((img) => { const src = toJpeg(img, { maxSide: 1600, quality: 0.92 }); URL.revokeObjectURL(url); return src; },
    (err) => { URL.revokeObjectURL(url); throw err; });
}

/** One avatar size from the square: the API's min(side, crop size). */
function cut(img, crop, side) {
  return toJpeg(img, { crop, side: Math.min(side, crop.size), quality: 0.88 });
}

/* ------------------------------------------------------------ the dialog --
   The modal behaviour the console's useModalDialog gives it: remembers the
   opener, locks the page scroll, moves focus inside, keeps Tab inside, closes
   on Escape (and on a route change) and gives focus back when it closes. */
const FOCUSABLE = 'button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])';
const focusables = (root) => [...root.querySelectorAll(FOCUSABLE)].filter((node) => !node.disabled && node.offsetParent !== null);

/**
 * @param {object} opts { src, initial:{x,y,size}|null, title, saveLabel, primaryClass, secondaryClass,
 *                        onSave(crop) -> Promise (reject with an Error to show its message),
 *                        onCancel(), onDone() — after it has closed on a save }
 */
function open(opts) {
  const saveLabel = opts.saveLabel || 'Save picture';
  const opener = document.activeElement;
  const overlay = document.createElement('div');
  overlay.className = 'crop-overlay';
  overlay.innerHTML = `
    <div class="crop-card" role="dialog" aria-modal="true" aria-labelledby="avatarCropTitle" aria-describedby="avatarCropHelp" data-testid="crop-dialog">
      <h2 class="crop-title" id="avatarCropTitle">${esc(opts.title || 'Crop your picture')}</h2>
      <p class="crop-sub" id="avatarCropHelp">Drag to move the picture and zoom to fit. The circle is exactly how your picture will appear.</p>
      <div class="crop-stage">
        <div class="crop-frame" data-crop-frame tabindex="0" role="group" aria-label="Picture position. Use the arrow keys to move it, plus and minus to zoom." data-testid="crop-frame" data-crop="">
          <img class="crop-image" alt="" draggable="false" style="opacity:0">
          <span class="crop-mask" aria-hidden="true"></span>
        </div>
        <div class="crop-previews" aria-hidden="true">
          <span class="crop-preview-label">Preview</span>
          <span class="crop-preview" data-preview="96" data-testid="crop-preview"></span>
          <span class="crop-preview" data-preview="40"></span>
        </div>
      </div>
      <div class="crop-zoom">
        <button type="button" class="crop-zoom-btn" aria-label="Zoom out" data-zoom="out" disabled>&minus;</button>
        <input type="range" min="1" max="1" step="0.01" value="1" aria-label="Zoom" disabled data-testid="crop-zoom">
        <button type="button" class="crop-zoom-btn" aria-label="Zoom in" data-zoom="in" disabled>+</button>
      </div>
      <p class="crop-hint">Only this square is used for your picture; the photo you chose is kept so you can adjust it later.</p>
      <p class="crop-error" role="alert" data-crop-error hidden></p>
      <div class="crop-actions">
        <button type="button" class="${opts.secondaryClass}" data-crop-cancel>Cancel</button>
        <button type="button" class="${opts.primaryClass}" data-crop-save data-testid="crop-save" disabled>${esc(saveLabel)}</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const previousOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';

  const card = overlay.firstElementChild;
  const frameEl = card.querySelector('[data-crop-frame]');
  const img = frameEl.querySelector('img');
  const range = card.querySelector('input[type="range"]');
  const zoomOut = card.querySelector('[data-zoom="out"]');
  const zoomIn = card.querySelector('[data-zoom="in"]');
  const previews = [...card.querySelectorAll('[data-preview]')];
  const errorEl = card.querySelector('[data-crop-error]');
  const cancelBtn = card.querySelector('[data-crop-cancel]');
  const saveBtn = card.querySelector('[data-crop-save]');

  // State lives in the PICTURE's pixels: the crop square's side follows from
  // the zoom, and (cx, cy) is its centre.
  let natural = null, frame = 300, zoom = 1, centre = null, busy = false, unreadable = false, closed = false;
  const minSide = () => (natural ? Math.min(natural.w, natural.h) : 1);
  const maxZoom = () => (natural ? clamp(minSide() / Math.min(MIN_CROP_SIDE, minSide()), 1, MAX_ZOOM) : 1);
  const side = () => minSide() / zoom;
  const keepInside = (cx, cy, s) => (natural ? { cx: clamp(cx, s / 2, natural.w - s / 2), cy: clamp(cy, s / 2, natural.h - s / 2) } : { cx, cy });

  // The square that will be saved: integers, inside the picture.
  function crop() {
    if (!natural || !centre) return null;
    const size = Math.min(Math.round(side()), natural.w, natural.h);
    return { size, x: clamp(Math.round(centre.cx - size / 2), 0, natural.w - size), y: clamp(Math.round(centre.cy - size / 2), 0, natural.h - size) };
  }

  function paint() {
    const square = crop();
    frameEl.setAttribute('data-crop', square ? `${square.x},${square.y},${square.size}` : '');
    if (natural && centre) {
      const scale = frame / side();
      img.style.opacity = '';
      img.style.width = `${natural.w * scale}px`;
      img.style.height = `${natural.h * scale}px`;
      img.style.left = `${frame / 2 - centre.cx * scale}px`;
      img.style.top = `${frame / 2 - centre.cy * scale}px`;
    }
    // The previews show the integer square that will be saved, not the live
    // one, so they are exactly the avatar.
    previews.forEach((p) => {
      const px = Number(p.dataset.preview);
      p.style.width = p.style.height = `${px}px`;
      if (!square || !natural) return;
      const k = px / square.size;
      p.style.backgroundSize = `${natural.w * k}px ${natural.h * k}px`;
      p.style.backgroundPosition = `${-square.x * k}px ${-square.y * k}px`;
    });
    const most = maxZoom();
    range.max = String(most);
    range.value = String(zoom);
    range.disabled = !natural || most <= 1;
    zoomOut.disabled = zoom <= 1 || !natural;
    zoomIn.disabled = zoom >= most || !natural;
    cancelBtn.disabled = busy;
    saveBtn.disabled = busy || !square || unreadable;
  }

  function setZoomKeeping(next) {
    zoom = clamp(next, 1, maxZoom());
    if (centre) centre = keepInside(centre.cx, centre.cy, minSide() / zoom);
    paint();
  }
  function panBy(dx, dy) {
    if (!centre) return;
    const s = side(), scale = frame / s;   // CSS px per picture px
    centre = keepInside(centre.cx - dx / scale, centre.cy - dy / scale, s);
    paint();
  }

  function showUnreadable() {
    if (unreadable) return;
    unreadable = true;
    const note = document.createElement('p');
    note.className = 'crop-error';
    note.setAttribute('role', 'alert');
    note.textContent = 'That file could not be read as an image. Please choose a JPG, PNG or WebP picture.';
    card.querySelector('.crop-stage').replaceWith(note);
    card.querySelector('.crop-zoom').remove();
    card.querySelector('.crop-hint').remove();
    paint();
    cancelBtn.focus();
  }

  img.addEventListener('load', () => {
    const w = img.naturalWidth, h = img.naturalHeight;
    if (!w || !h) { showUnreadable(); return; }
    natural = { w, h };
    const least = Math.min(w, h);
    const start = opts.initial;
    if (start && start.size > 0 && start.x + start.size <= w && start.y + start.size <= h) {
      zoom = clamp(least / start.size, 1, clamp(least / Math.min(MIN_CROP_SIDE, least), 1, MAX_ZOOM));
      centre = { cx: start.x + start.size / 2, cy: start.y + start.size / 2 };
    } else {
      zoom = 1;
      centre = { cx: w / 2, cy: h / 2 };
    }
    previews.forEach((p) => { p.style.backgroundImage = `url("${opts.src}")`; });
    paint();
  });
  img.addEventListener('error', showUnreadable);
  img.src = opts.src;

  // The frame is responsive: measure it, so dragging maps CSS px to pixels.
  const measure = () => { frame = frameEl.clientWidth || 300; paint(); };
  const observer = 'ResizeObserver' in window ? new ResizeObserver(measure) : null;
  if (observer) observer.observe(frameEl);
  measure();

  // ---- pointers: drag with one, pinch with two ----------------------------
  const pointers = new Map();
  let pinch = null;
  const spread = () => { const [a, b] = [...pointers.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
  frameEl.addEventListener('pointerdown', (e) => {
    frameEl.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) pinch = { distance: spread(), zoom };
  });
  frameEl.addEventListener('pointermove', (e) => {
    const previous = pointers.get(e.pointerId);
    if (!previous) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size >= 2 && pinch) {
      const now = spread();
      if (pinch.distance > 0) setZoomKeeping(pinch.zoom * (now / pinch.distance));
    } else {
      panBy(e.clientX - previous.x, e.clientY - previous.y);
    }
  });
  const up = (e) => { pointers.delete(e.pointerId); if (pointers.size < 2) pinch = null; };
  frameEl.addEventListener('pointerup', up);
  frameEl.addEventListener('pointercancel', up);
  // The wheel zooms; not passive, so the page behind does not scroll.
  frameEl.addEventListener('wheel', (e) => { e.preventDefault(); setZoomKeeping(zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08)); }, { passive: false });
  frameEl.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? KEY_STEP * 4 : KEY_STEP;
    // The arrows move the PICTURE, as a drag does.
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (Object.prototype.hasOwnProperty.call(moves, e.key)) { e.preventDefault(); panBy(moves[e.key][0], moves[e.key][1]); return; }
    if (e.key === '+' || e.key === '=') { e.preventDefault(); setZoomKeeping(zoom * 1.1); return; }
    if (e.key === '-' || e.key === '_') { e.preventDefault(); setZoomKeeping(zoom / 1.1); return; }
    if (e.key === '0') { e.preventDefault(); setZoomKeeping(1); }
  });
  zoomOut.addEventListener('click', () => setZoomKeeping(zoom / 1.15));
  zoomIn.addEventListener('click', () => setZoomKeeping(zoom * 1.15));
  range.addEventListener('input', () => setZoomKeeping(Number(range.value)));

  // ---- keyboard, closing ---------------------------------------------------
  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel(); return; }
    if (e.key !== 'Tab') return;
    const items = focusables(card);
    if (!items.length) { e.preventDefault(); return; }
    const first = items[0], last = items[items.length - 1];
    if (!card.contains(document.activeElement)) { e.preventDefault(); (e.shiftKey ? last : first).focus(); return; }
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  document.addEventListener('keydown', onKey, true);
  // A route change must not leave the editor standing over the next screen.
  const onRoute = () => { busy = false; cancel(); };
  window.addEventListener('hashchange', onRoute);
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) cancel(); });

  function finish() {
    if (closed) return;
    closed = true;
    if (observer) observer.disconnect();
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('hashchange', onRoute);
    overlay.remove();
    document.body.style.overflow = previousOverflow;
    if (opener && document.contains(opener) && opener.focus) opener.focus();
  }
  function cancel() {
    if (busy) return;
    finish();
    if (opts.onCancel) opts.onCancel();
  }
  cancelBtn.addEventListener('click', cancel);
  saveBtn.addEventListener('click', () => {
    const square = crop();
    if (!square || busy) return;
    busy = true;
    errorEl.hidden = true;
    saveBtn.textContent = 'Saving…';
    paint();
    Promise.resolve().then(() => opts.onSave(square)).then(() => {
      busy = false;
      finish();
      if (opts.onDone) opts.onDone();
    }, (reason) => {
      busy = false;
      errorEl.textContent = reason && reason.message ? reason.message : 'The picture could not be saved.';
      errorEl.hidden = false;
      saveBtn.textContent = saveLabel;
      paint();
    });
  });

  // Focus goes to the frame, retried across frames while the card settles.
  let tries = 0;
  const attempt = () => {
    if (closed) return;
    frameEl.focus();
    if (!card.contains(document.activeElement) && tries++ < 30) requestAnimationFrame(attempt);
  };
  requestAnimationFrame(() => requestAnimationFrame(attempt));
}

window.Veye = window.Veye || { screens: {} };
window.Veye.Crop = { refusal, loadImage, keepOriginal, cut, open };

})();
