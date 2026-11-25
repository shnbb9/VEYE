"use client";

import { useLayoutEffect, useRef, type RefObject } from "react";
import { prefersReducedMotion } from "@/lib/member-format";

/* Going from one page to another inside a frame that stays: the new content
   fades in, the frame does not move, and nothing waits for it. Opacity only, so
   no fixed or sticky thing on the page is displaced while it runs. The first
   page has its own entrance (or its skeleton) and is left alone. */
export function usePageFade(ref: RefObject<HTMLElement | null>, page: string, ms = 160) {
  const shown = useRef<string | null>(null);
  useLayoutEffect(() => {
    const first = shown.current === null;
    const same = shown.current === page;
    shown.current = page;
    if (first || same || prefersReducedMotion() || typeof ref.current?.animate !== "function") return;
    ref.current.animate([{ opacity: 0 }, { opacity: 1 }], { duration: ms, easing: "ease-out" });
  }, [ref, page, ms]);
}
