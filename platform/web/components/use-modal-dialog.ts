"use client";

import { useEffect, useRef, type RefObject } from "react";

/* What `aria-modal="true"` promises, in one place.
 *
 * Seven dialogs in this application declared `aria-modal="true"`. One of them
 * behaved like a modal. In the other six, Tab walked straight out of the open
 * dialog into the page behind the scrim — out of the Content editor onto that
 * row's Unpublish, out of the invite panel onto an administrator's Deactivate —
 * with nothing on screen to say where focus had gone. A screen reader was being
 * told the rest of the page was inert while the keyboard proved it was not.
 *
 * The behaviour here is the one Meal Planning already had, generalised: it
 * remembers the opener, moves focus inside (retrying across animation frames,
 * because the dialog may still be animating in), locks the scroll container,
 * cycles Tab and Shift+Tab inside the dialog, closes the topmost dialog on
 * Escape, and gives focus back to the opener when it closes.
 */

type Opened = { el: HTMLElement; onClose: () => void };

/** Innermost first, so a dialog opened from a dialog owns the keyboard. */
const stack: Opened[] = [];

/* The scroll lock belongs to the stack, not to a dialog. Each dialog
   remembering and restoring its own previous value leaks the lock when they
   close out of order: Mood Tracker's picker locks, its note locks (recording
   "hidden" as the value to go back to), the picker deactivates, and the note's
   restore then leaves the page unscrollable. */
let locked: { el: HTMLElement; previous: string } | null = null;

function lockScroll() {
  if (locked) return;
  const el = scroller();
  locked = { el, previous: el.style.overflow };
  el.style.overflow = "hidden";
}

function unlockScroll() {
  if (!locked) return;
  locked.el.style.overflow = locked.previous;
  locked = null;
}

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(
    'button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])',
  )].filter((el) => !(el as HTMLButtonElement).disabled && el.offsetParent !== null);
}

/** The element that actually scrolls: the member shell's .main, else the page. */
function scroller(): HTMLElement {
  return document.querySelector<HTMLElement>(".main") ?? document.body;
}

function onKeyDown(event: KeyboardEvent) {
  const top = stack[stack.length - 1];
  if (!top || !document.contains(top.el)) return;

  if (event.key === "Escape") { event.preventDefault(); top.onClose(); return; }
  if (event.key !== "Tab") return;

  const items = focusables(top.el);
  if (!items.length) { event.preventDefault(); return; }
  const first = items[0];
  const last = items[items.length - 1];

  // Focus outside the dialog at all (a stray click on the page behind, or the
  // browser's own starting point) comes back in rather than carrying on.
  if (!top.el.contains(document.activeElement)) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
    return;
  }
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}

/**
 * @param open      whether the dialog is on screen
 * @param ref       the element carrying role="dialog"
 * @param onClose   called on Escape; the caller owns the open state
 * @param preferSel optional selector for the control focus should land on
 */
export function useModalDialog(
  open: boolean,
  ref: RefObject<HTMLElement | null>,
  onClose: () => void,
  preferSel?: string,
) {
  // Escape must call the latest handler, not the one captured when it opened.
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const el = ref.current;
    if (!open || !el) return;

    const opener = document.activeElement as HTMLElement | null;
    const entry: Opened = { el, onClose: () => close.current() };
    stack.push(entry);
    if (stack.length === 1) document.addEventListener("keydown", onKeyDown);

    lockScroll();

    // The dialog may still be animating in, so keep trying for a few frames.
    let frame = 0;
    const attempt = (n: number) => {
      if (!document.contains(el)) return;
      const target = (preferSel ? el.querySelector<HTMLElement>(preferSel) : null) ?? focusables(el)[0];
      // Plain focus, so the browser scrolls the control into view if the body
      // is taller than the dialog. (A `preventScroll` variant was tried and
      // removed: the dialog that looked scrolled on open was scrolled by the
      // Tab walk in the test that captured it, and forcing the body back to
      // the top would focus an invisible control in a taller dialog.)
      target?.focus();
      if (el.contains(document.activeElement)) return;
      if (n < 30) frame = requestAnimationFrame(() => attempt(n + 1));
    };
    frame = requestAnimationFrame(() => { frame = requestAnimationFrame(() => attempt(0)); });

    return () => {
      cancelAnimationFrame(frame);
      const index = stack.indexOf(entry);
      if (index >= 0) stack.splice(index, 1);
      if (!stack.length) {
        document.removeEventListener("keydown", onKeyDown);
        unlockScroll();
      }
      // Back to whatever opened it, if that control is still on the page — but
      // only while this dialog still holds the focus. Mood Tracker opens its
      // note from its picker, which deactivates the picker's hook; without this
      // check the picker would pull focus back to the calendar a frame after
      // the note had placed it in the textarea.
      const held = document.activeElement;
      const ours = held === document.body || held === null || el.contains(held);
      if (ours && opener && document.contains(opener) && typeof opener.focus === "function") {
        requestAnimationFrame(() => {
          const now = document.activeElement;
          if (now === document.body || now === null || el.contains(now)) opener.focus();
        });
      }
    };
  }, [open, ref, preferSel]);
}
