"use client";

import { useId, useRef, type ReactNode } from "react";
import { useModalDialog } from "@/components/use-modal-dialog";

/* The prototype's side drawer (components/drawer): scrim + right-hand panel
   with head / body / foot. The scrim closes it; everything a modal owes the
   keyboard comes from useModalDialog. */
export function Drawer({ eyebrow, title, desc, children, foot, onClose }: {
  eyebrow?: string; title: string; desc?: ReactNode; children: ReactNode; foot?: ReactNode; onClose: () => void;
}) {
  const id = useId();
  const panel = useRef<HTMLElement>(null);
  // Escape, the focus trap, the scroll lock and returning focus to whatever
  // opened the drawer. Escape alone used to be all of it, so Tab out of an
  // open editor landed on Unpublish in the row behind the scrim.
  useModalDialog(true, panel, onClose, ".drawer__body input, .drawer__body select, .drawer__body textarea");

  return (
    <>
      <div className="drawer-scrim" onClick={onClose} />
      <aside className="drawer" ref={panel} role="dialog" aria-modal="true" aria-labelledby={id}>
        <div className="drawer__head">
          <div style={{ minWidth: 0 }}>
            {eyebrow && <span className="t-eyebrow">{eyebrow}</span>}
            <h2 id={id} style={{ fontSize: 20, marginTop: 2 }}>{title}</h2>
            {desc && <p className="t-support" style={{ marginTop: 4 }}>{desc}</p>}
          </div>
          <button className="icon-btn" type="button" aria-label="Close panel" onClick={onClose}>
            <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
        </div>
        <div className="drawer__body">{children}</div>
        {foot && <div className="drawer__foot">{foot}</div>}
      </aside>
    </>
  );
}

export function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
      {hint && <span className="field__hint">{hint}</span>}
    </div>
  );
}
