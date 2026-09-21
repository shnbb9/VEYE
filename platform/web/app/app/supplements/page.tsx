"use client";

import { useEffect, useState } from "react";
import { getPublishedCare, type MemberCareItem } from "@/lib/api";

/* Supplements (build/dashboard.html, #view-supplements): the client's
   development notice and intro line, then the PUBLISHED Care Studio items
   for this section — each a card of approved educational copy with its
   cautions. Dosage is chosen by condition and is copy here, never derived
   from a tracker. Draft items (the provisional Vitamin Overview awaiting
   citations) do not appear until Cara publishes them. */

export default function SupplementsPage() {
  const [items, setItems] = useState<MemberCareItem[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    getPublishedCare("supplement").then(setItems).catch((reason: Error) => setError(reason.message));
  }, []);

  const intro = items?.find((item) => item.category === "Overview");
  const rest = (items ?? []).filter((item) => item !== intro);

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
            {intro.body.split(/\n\n+/).map((paragraph, index) => <p key={index}>{paragraph}</p>)}
            {rest.filter((item) => item.content_type === "copy").map((item) => (
              <div key={item.id}>
                <p className="sup-card__head">{item.title}</p>
                <ul>{item.body.split(/\n+/).filter(Boolean).map((line, index) => <li key={index}>{line}</li>)}</ul>
              </div>
            ))}
          </div>
        </div>
      )}

      {rest.filter((item) => item.content_type !== "copy").map((item) => (
        <section className="sup-card sup-other" key={item.id} aria-label={item.title}>
          <div className="sup-card__body">
            {item.description && <p className="sup-provisional">{item.description}</p>}
            <h2 className="sup-card__head sup-other__title">{item.title}</h2>
            {item.body.split(/\n\n+/).map((paragraph, index) => <p key={index}>{paragraph}</p>)}
            {item.references && <p className="sup-provisional">References: {item.references}</p>}
          </div>
        </section>
      ))}

      <p className="rec-disclaimer dev-disclaimer">{intro?.cautions ?? "For educational purposes only. Not medical advice. Consult your healthcare provider."}</p>
      <p className="dev-more">Under development &mdash; more coming.</p>
    </div>
  );
}
