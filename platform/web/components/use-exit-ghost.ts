"use client";

import { useLayoutEffect, type RefObject } from "react";
import { prefersReducedMotion } from "@/lib/member-format";

/* A dialog, drawer or menu that closes fades out instead of vanishing between
 * two frames.
 *
 * React has already taken it away by the time there is anything to fade, and
 * every one of them is rendered as `{open && <Dialog/>}`. So what fades is a
 * picture of it, put in its place for a moment: a copy with no id, no name, no
 * role and no test id, that cannot be focused, clicked or read out. Focus has
 * already gone back to what opened it (use-modal-dialog) and nothing waits for
 * the fade, so a click, a test or a screen reader is exactly as fast as before.
 * With reduced motion there is no picture at all. */

const NAMES = ["id", "name", "for", "role", "data-testid", "autofocus", "aria-label", "aria-labelledby", "aria-modal", "aria-live"];

function picture(el: HTMLElement): HTMLElement {
  const copy = el.cloneNode(true) as HTMLElement;
  const from = [el, ...el.querySelectorAll<HTMLElement>("*")];
  const to = [copy, ...copy.querySelectorAll<HTMLElement>("*")];
  to.forEach((node) => NAMES.forEach((name) => node.removeAttribute(name)));
  copy.querySelectorAll("iframe, video, audio, source, script").forEach((node) => node.removeAttribute("src"));
  copy.inert = true;
  copy.setAttribute("aria-hidden", "true");
  copy.dataset.leaving = "";
  copy.style.pointerEvents = "none";
  copy.style.animation = "none";
  // A copy starts scrolled to the top; a jump would be seen.
  const scrolled = from.map((node, i) => [to[i], node.scrollTop] as const).filter(([, top]) => top > 0);
  copy.addEventListener("veye:shown", () => scrolled.forEach(([node, top]) => { node.scrollTop = top; }), { once: true });
  return copy;
}

/**
 * @param ref   what leaves
 * @param to    where it goes as it fades (a transform), if anywhere
 */
export function useExitGhost(ref: RefObject<HTMLElement | null>, to?: string, ms = 150) {
  useLayoutEffect(() => {
    const el = ref.current;
    return () => {
      const parent = el?.parentElement;
      if (!el || !parent || prefersReducedMotion() || typeof el.animate !== "function") return;
      const copy = picture(el);
      // React removes the element after this. In development it also runs every
      // effect twice without removing anything: then there is nothing to fade.
      queueMicrotask(() => {
        if (el.isConnected || !document.body) return;
        (parent.isConnected ? parent : document.body).appendChild(copy);
        copy.dispatchEvent(new Event("veye:shown"));
        const leave = copy.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: to ?? "none" }],
          { duration: ms, easing: "cubic-bezier(.2,.8,.2,1)", fill: "forwards" });
        leave.onfinish = leave.oncancel = () => copy.remove();
        // Nothing depends on the fade being drawn: a page that is not on screen
        // draws nothing, and the picture must not be waiting when it comes back.
        setTimeout(() => copy.remove(), ms + 200);
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
