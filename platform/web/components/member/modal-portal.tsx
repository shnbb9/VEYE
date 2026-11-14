"use client";

import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

/* A dialog overlay has to be a child of <body>, not of the page.
 *
 * `section.content` is `position: relative; z-index: 1`, which makes it a
 * stacking context. An overlay rendered inside it is confined to that context
 * however high its own z-index is, so the scrim painted *under* the sidebar
 * (z-index 5) and the top strip (30): the nav stayed at full brightness and
 * `document.elementFromPoint` over it returned the nav link, not the scrim.
 * A member could click straight through an open dialog to another screen.
 *
 * Meal Planning already escaped this by portalling to <body>; this is the
 * same move, shared.
 */
export function ModalPortal({ id, open, onBackdrop, children }: {
  id: string; open: boolean; onBackdrop: () => void; children: ReactNode;
}) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => { setHost(document.body); }, []);
  if (!host) return null;
  return createPortal(
    <div className={`modal-overlay${open ? " open" : ""}`} id={id} aria-hidden={!open}
         onClick={(event: MouseEvent<HTMLDivElement>) => { if (event.target === event.currentTarget) onBackdrop(); }}>
      {children}
    </div>,
    host,
  );
}
