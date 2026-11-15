"use client";

import { useEffect, useRef, useState } from "react";
import { getPublishedCare, type MemberCareItem } from "@/lib/api";
import { prefersReducedMotion } from "@/lib/member-format";

/* Supplements (build/dashboard.html, #view-supplements): the client's
   development notice and intro line, then the PUBLISHED Care Studio items
   for this section — the card of approved educational copy with its dosage
   lists, and behind "Other Supplements" the Vitamin Overview with its
   provisional line, exactly as the prototype draws them (owner, 15 Nov 2026:
   the page had lost the button and the overview). Dosage is chosen by
   condition and is copy here, never derived from a tracker. Everything is
   edited in Care Studio; this page only lays it out. */

/** Paragraphs of a Care Studio body. A paragraph that starts with **Name**
 *  draws the name in bold, as the prototype's vitamin overview does; the
 *  first plain paragraph of an article is its introduction. Text only — no
 *  markup from the body ever reaches the page. */
function Paragraphs({ text, article }: { text: string; article: boolean }) {
  return (
    <>
      {text.split(/\n\n+/).map((paragraph, index) => {
        const named = /^\*\*(.+?)\*\*\s*([\s\S]*)$/.exec(paragraph);
        if (named) return <p key={index}><strong>{named[1]}</strong> {named[2]}</p>;
        return <p key={index} className={article && index === 0 ? "sup-other__intro" : undefined}>{paragraph}</p>;
      })}
    </>
  );
}

export default function SupplementsPage() {
  const [items, setItems] = useState<MemberCareItem[] | null>(null);
  const [error, setError] = useState("");
  const [otherOpen, setOtherOpen] = useState(false);
  const otherPanel = useRef<HTMLElement>(null);

  useEffect(() => {
    getPublishedCare("supplement").then(setItems).catch((reason: Error) => setError(reason.message));
  }, []);

  // The prototype's toggle: opening brings the overview into view and moves
  // focus to it, so a keyboard or screen-reader user lands on what opened.
  useEffect(() => {
    if (!otherOpen || !otherPanel.current) return;
    otherPanel.current.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
    otherPanel.current.focus({ preventScroll: true });
  }, [otherOpen]);

  const intro = items?.find((item) => item.category === "Overview");
  const rest = (items ?? []).filter((item) => item !== intro);
  const lists = rest.filter((item) => item.content_type === "copy");
  const others = rest.filter((item) => item.content_type !== "copy");

  return (
    <div className="view-supplements">
      <h1 className="fd-title">Supplements</h1>
      <p className="dev-note">Supplements &mdash; this section is being developed. For now, Veye offers some important information.</p>
      {intro?.description && <p className="dev-lede">{intro.description}</p>}
      {error && <p className="fdx-err" role="alert">{error}</p>}
      {items && items.length === 0 && <p className="dev-note">No supplement information has been published yet.</p>}

      {intro && (
        <div className="sup-card">
          <img className="sup-card__img" src="/assets/web/img/supplements.png" alt="" onError={(event) => { event.currentTarget.style.display = "none"; }} />
          <div className="sup-card__body">
            <Paragraphs text={intro.body} article={false} />
            {lists.map((item) => (
              <div key={item.id}>
                <p className="sup-card__head">{item.title}</p>
                <ul>{item.body.split(/\n+/).filter(Boolean).map((line, index) => <li key={index}>{line}</li>)}</ul>
              </div>
            ))}
          </div>
        </div>
      )}

      {others.length > 0 && (
        <>
          <button className="hn-anchor-cta sup-other-btn" id="supOtherBtn" type="button" aria-expanded={otherOpen} aria-controls="supOtherPanel"
                  onClick={() => setOtherOpen((open) => !open)} data-testid="supplements-other">
            Other Supplements
            <span className="arrow arrow--ring" aria-hidden="true">
              <svg viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><circle cx="14" cy="14" r="13" /><path d="M6.5 14h14.2M16.6 9.9L20.8 14l-4.2 4.1" /></svg>
            </span>
          </button>
          {others.map((item, index) => (
            <section className="sup-card sup-other" key={item.id} id={index === 0 ? "supOtherPanel" : undefined}
                     ref={index === 0 ? otherPanel : undefined} tabIndex={-1} hidden={!otherOpen}
                     aria-label={`Other supplements — ${item.title}`}>
              <div className="sup-card__body">
                {item.description && <p className="sup-provisional">{item.description}</p>}
                <h2 className="sup-card__head sup-other__title">{item.title}</h2>
                <Paragraphs text={item.body} article />
                {item.references && <p className="sup-provisional">References: {item.references}</p>}
              </div>
            </section>
          ))}
        </>
      )}

      <p className="rec-disclaimer dev-disclaimer">{intro?.cautions ?? "For educational purposes only. Not medical advice. Consult your healthcare provider."}</p>
      <p className="dev-more">Under development &mdash; more coming.</p>
    </div>
  );
}
