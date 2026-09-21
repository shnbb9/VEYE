"use client";

import { useEffect, useId, type ReactNode } from "react";

/* The prototype's side drawer (components/drawer): scrim + right-hand panel
   with head / body / foot. Escape and the scrim close it. */
export function Drawer({ eyebrow, title, desc, children, foot, onClose }: {
  eyebrow?: string; title: string; desc?: ReactNode; children: ReactNode; foot?: ReactNode; onClose: () => void;
}) {
  const id = useId();
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <div className="drawer-scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby={id}>
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
