"use client";

import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useExitGhost } from "@/components/use-exit-ghost";
import { useModalDialog } from "@/components/use-modal-dialog";
import styles from "@/components/confirm-dialog.module.css";

/* "Are you sure?", in the application's own clothes instead of the browser's.
 *
 *   if (!(await ask({ title: "Stop sharing?", confirm: "Stop sharing" }))) return;
 *
 * Escape, the backdrop, leaving the page and the safe button all answer no, and
 * the safe button is the one that has the focus. One host, in the root layout. */

export type Question = { title: string; text?: ReactNode; confirm: string; cancel?: string; danger?: boolean };
type Asked = Question & { settle: (yes: boolean) => void };

let show: ((asked: Asked) => void) | null = null;

export function ask(question: Question): Promise<boolean> {
  return new Promise((settle) => {
    if (show) show({ ...question, settle });
    else settle(window.confirm(question.title));   // no host on this page: the browser's own, rather than none
  });
}

export function ConfirmHost() {
  const pathname = usePathname();
  const [asked, setAsked] = useState<Asked | null>(null);
  const current = useRef<Asked | null>(null);
  const answer = (yes: boolean) => {
    const open = current.current;
    current.current = null;
    setAsked(null);
    open?.settle(yes);
  };

  useEffect(() => {
    show = (next) => { current.current?.settle(false); current.current = next; setAsked(next); };
    return () => { show = null; };
  }, []);
  // The page that asked has gone: the question goes with it, unanswered is no.
  useEffect(() => () => { if (current.current) { current.current.settle(false); current.current = null; setAsked(null); } }, [pathname]);

  return asked ? <ConfirmDialog key={asked.title} question={asked} onAnswer={answer} /> : null;
}

function ConfirmDialog({ question, onAnswer }: { question: Question; onAnswer: (yes: boolean) => void }) {
  const id = useId();
  const overlay = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  useModalDialog(true, card, () => onAnswer(false), "[data-confirm-no]");
  useExitGhost(overlay);
  return createPortal(
    <div className={styles.overlay} ref={overlay} onMouseDown={(event) => { if (event.target === event.currentTarget) onAnswer(false); }}>
      <div className={styles.card} ref={card} role="alertdialog" aria-modal="true" aria-labelledby={id}
           aria-describedby={question.text ? `${id}-text` : undefined} data-testid="confirm-dialog">
        <h2 className={styles.title} id={id}>{question.title}</h2>
        {question.text && <div className={styles.text} id={`${id}-text`}>{question.text}</div>}
        <div className={styles.actions}>
          <button type="button" className={styles.no} onClick={() => onAnswer(false)} data-confirm-no data-testid="confirm-no">{question.cancel ?? "Cancel"}</button>
          <button type="button" className={`${styles.yes}${question.danger ? ` ${styles.danger}` : ""}`} onClick={() => onAnswer(true)} data-testid="confirm-yes">{question.confirm}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
