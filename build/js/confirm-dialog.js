/* "Are you sure?", in the application's own clothes instead of the browser's
   (platform/web/components/confirm-dialog.tsx and use-exit-ghost.ts).

     if (!(await VeyeConfirm.ask({ title: 'Stop sharing?', confirm: 'Stop sharing' }))) return;

   Escape, the backdrop and the safe button all answer no, and the safe button
   is the one that has the focus. */
(function () {
  'use strict';
  const still = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let open = null;
  /* components/confirm-dialog.module.css, rule for rule. */
  const CSS = `.vconfirm { position: fixed; inset: 0; z-index: 1000; display: grid; place-items: center; padding: 16px; background: rgba(23, 31, 12, 0.45); animation: vconfirmVeil 160ms ease-out; } .vconfirm__card { width: min(430px, 100%); max-height: calc(100vh - 32px); overflow-y: auto; background: #fff; border-radius: 18px; box-shadow: 0 20px 50px rgba(23, 31, 12, 0.24); padding: 26px 26px 22px; color: #2e4a1a; animation: vconfirmRise 180ms cubic-bezier(0.2, 0.8, 0.2, 1); } .vconfirm__title { margin: 0; font-family: 'Teachers', sans-serif; font-size: 20px; line-height: 1.3; font-weight: 600; color: #384c0c; } .vconfirm__text { margin-top: 10px; font-size: 15px; line-height: 1.55; color: #55694a; } .vconfirm__text p { margin: 0; } .vconfirm__actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 22px; flex-wrap: wrap; } .vconfirm__yes, .vconfirm__no { min-height: 44px; padding: 10px 20px; border-radius: 999px; font: 600 14.5px/1.2 'Teachers', sans-serif; cursor: pointer; transition: background 140ms ease, border-color 140ms ease; } .vconfirm__yes { border: 1px solid #446514; background: #446514; color: #fff; } .vconfirm__yes:hover { background: #384c0c; border-color: #384c0c; } .vconfirm__yes--danger { border-color: #9c3a24; background: #9c3a24; } .vconfirm__yes--danger:hover { background: #7f2d1b; border-color: #7f2d1b; } .vconfirm__no { border: 1px solid #c9d8b4; background: #fff; color: #384c0c; } .vconfirm__no:hover { background: #f4f8ec; } .vconfirm__yes:focus-visible, .vconfirm__no:focus-visible { outline: 3px solid #8dc412; outline-offset: 2px; } @keyframes vconfirmVeil { from { opacity: 0; } } @keyframes vconfirmRise { from { opacity: 0; transform: translateY(8px); } } @media (max-width: 480px) { .vconfirm__card { padding: 22px 18px 18px; } .vconfirm__actions { flex-direction: column-reverse; } .vconfirm__yes, .vconfirm__no { width: 100%; } } @media (prefers-reduced-motion: reduce) { .vconfirm, .vconfirm__card { animation: none; } }`;
  const sheet = document.createElement('style');
  sheet.textContent = CSS;
  document.head.appendChild(sheet);

  function ask(question) {
    if (open) open(false);
    return new Promise(settle => {
      const before = document.activeElement;
      const overlay = document.createElement('div');
      overlay.className = 'vconfirm';
      overlay.innerHTML = '<div class="vconfirm__card" role="alertdialog" aria-modal="true" aria-labelledby="vconfirmTitle"><h2 class="vconfirm__title" id="vconfirmTitle"></h2>' +
        '<div class="vconfirm__text" id="vconfirmText" hidden></div><div class="vconfirm__actions"><button type="button" class="vconfirm__no" data-confirm-no></button>' +
        '<button type="button" class="vconfirm__yes"></button></div></div>';
      const card = overlay.firstChild;
      card.querySelector('.vconfirm__title').textContent = question.title;
      if (question.text) {
        const text = card.querySelector('.vconfirm__text');
        text.textContent = question.text; text.hidden = false;
        card.setAttribute('aria-describedby', 'vconfirmText');
      }
      const no = card.querySelector('.vconfirm__no'), yes = card.querySelector('.vconfirm__yes');
      no.textContent = question.cancel || 'Cancel';
      yes.textContent = question.confirm;
      if (question.danger) yes.classList.add('vconfirm__yes--danger');
      const overflow = document.body.style.overflow;
      function answer(value) {
        if (open !== answer) return;
        open = null;
        document.removeEventListener('keydown', onKey, true);
        document.body.style.overflow = overflow;
        // What fades is only a picture: it cannot be focused, pressed or read.
        overlay.inert = true;
        overlay.setAttribute('aria-hidden', 'true');
        overlay.style.pointerEvents = 'none';
        overlay.classList.add('is-leaving');
        overlay.querySelectorAll('[id], [role]').forEach(el => { el.removeAttribute('id'); el.removeAttribute('role'); });
        if (still() || !overlay.animate) overlay.remove();
        else { const leave = overlay.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 150, fill: 'forwards' }); leave.onfinish = leave.oncancel = () => overlay.remove(); setTimeout(() => overlay.remove(), 350); }
        if (before && before.isConnected && before.focus) before.focus();
        settle(value);
      }
      function onKey(event) {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); answer(false); }
        if (event.key === 'Tab') { event.preventDefault(); (document.activeElement === no ? yes : no).focus(); }
      }
      open = answer;
      overlay.addEventListener('mousedown', event => { if (event.target === overlay) answer(false); });
      no.addEventListener('click', () => answer(false));
      yes.addEventListener('click', () => answer(true));
      document.addEventListener('keydown', onKey, true);
      document.body.style.overflow = 'hidden';
      document.body.appendChild(overlay);
      no.focus();
    });
  }
  window.VeyeConfirm = { ask: ask };
})();
