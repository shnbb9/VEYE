"use client";

import { useEffect, useState } from "react";
import { getPublishedCare, type MemberCareItem } from "@/lib/api";

/* Fitness (build/dashboard.html, #view-fitness): Cara's recommendations as
   VEYE cards — an external program opens in a new tab, videos embed through
   the privacy-enhanced YouTube domain, lazily, without autoplay — followed by
   the approved library preview. The cards are the PUBLISHED Care Studio items
   for this section, in display order; nothing here is hard-wired content. */

export default function FitnessPage() {
  const [items, setItems] = useState<MemberCareItem[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    getPublishedCare("fitness").then(setItems).catch((reason: Error) => setError(reason.message));
  }, []);

  const programs = (items ?? []).filter((item) => item.content_type !== "video");
  // "VEYE recommends the EYR System." → "Explore EYR" (the approved CTA wording).
  const ctaFor = (item: MemberCareItem) => {
    const name = item.description.match(/recommends the (\S+?)(?: System)?\./i)?.[1];
    return item.content_type === "program" ? `Explore ${name ?? "the program"}` : "Open";
  };
  const videos = (items ?? []).filter((item) => item.content_type === "video" && item.youtube_embed_url);

  return (
    <div className="view-fitness">
      <h1 className="fd-title">Fitness</h1>
      <p className="dev-note">Content in development.</p>

      {error && <p className="fdx-err" role="alert">{error}</p>}
      {items && items.length === 0 && <p className="dev-note">No fitness recommendations have been published yet.</p>}

      {items && items.length > 0 && (
        <section className="fit-recs" aria-label="Veye fitness recommendations">
          {programs.map((item) => (
            <article className="fit-rec fit-rec--program" key={item.id}>
              <div className="fit-rec__badge" aria-hidden="true"><img src="/assets/web/svg/veye-mark.svg" alt="" /></div>
              <div className="fit-rec__body">
                {item.category && <span className="fit-rec__kicker">{item.category}</span>}
                <h2 className="fit-rec__title">{item.title}</h2>
                {item.description && <p className="fit-rec__copy">{item.description}</p>}
                {item.external_url && (
                  <>
                    <a className="btn-primary fit-rec__cta" href={item.external_url} target="_blank" rel="noopener noreferrer">
                      {ctaFor(item)}
                      <span className="fit-rec__ext" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M6.5 3.5H3.5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V9.5M9.5 2.5h4v4M13.5 2.5 7.5 8.5" /></svg></span>
                      <span className="sr-only">(opens {new URL(item.external_url).hostname} in a new tab)</span>
                    </a>
                    <span className="fit-rec__source">External program &middot; {item.external_url.replace(/^https?:\/\//, "")}</span>
                  </>
                )}
                {item.body && <p className="fit-rec__copy">{item.body}</p>}
              </div>
            </article>
          ))}

          {videos.length > 0 && (
            <div className="fit-rec-videos">
              {videos.map((item) => (
                <article className="fit-rec fit-rec--video" key={item.id}>
                  <div className="fit-rec__frame">
                    <iframe src={item.youtube_embed_url ?? undefined} title={`${item.title} (YouTube video)`} loading="lazy"
                            allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; web-share" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />
                  </div>
                  <div className="fit-rec__body">
                    {item.category && <span className="fit-rec__kicker">{item.category}</span>}
                    <h2 className="fit-rec__title">{item.title}</h2>
                    {item.description && <p className="fit-rec__copy">{item.description}</p>}
                    {item.youtube_embed_url && (
                      <a className="fit-rec__alt" href={item.youtube_embed_url.replace("https://www.youtube-nocookie.com/embed/", "https://youtu.be/")} target="_blank" rel="noopener noreferrer">
                        Watch on YouTube<span className="sr-only"> (opens in a new tab)</span>
                      </a>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      <h2 className="fit-lib-title">Fitness library preview</h2>
      <section className="fit-card" aria-label="Fitness library preview">
        <figure className="fit-hero" id="fitHero">
          <div className="fit-hero__image">
            <img src="/assets/web/img/fit-hero.jpg" alt="Bodyweight low-impact exercise preview" />
            <span className="fit-static-badge">Static preview</span>
          </div>
          <figcaption><strong>Bodyweight Low-Impact HIIT</strong><span className="fit-preview-kind">Video coming later</span></figcaption>
        </figure>
        <div className="fit-thumbs" aria-label="More fitness previews">
          <figure className="fit-thumb fit-thumb--featured">
            <div className="fit-thumb__image"><img src="/assets/web/img/fit-thumb1.jpg" alt="Bodyweight Low-Impact HIIT preview" /><span className="fit-thumb__chip">Featured</span></div>
            <span className="fit-thumb__cap"><b>Bodyweight Low-Impact HIIT</b><span>Effective Cardio and Strength Without Jumping</span></span>
          </figure>
          <figure className="fit-thumb">
            <div className="fit-thumb__image"><img src="/assets/web/img/fit-thumb2.jpg" alt="Total Body Strength preview" /><span className="fit-thumb__chip">Preview</span></div>
            <span className="fit-thumb__cap"><b>Total Body Strength</b><span>65-Minute Strength and Endurance Challenge</span></span>
          </figure>
          <figure className="fit-thumb">
            <div className="fit-thumb__image"><img src="/assets/web/img/fit-thumb3.jpg" alt="Total Body Circuits preview" /><span className="fit-thumb__chip">Preview</span></div>
            <span className="fit-thumb__cap"><b>Total Body Circuits</b><span>Build Total Body Strength</span></span>
          </figure>
        </div>
        <p className="fit-preview-note">Preview images are shown here while final video assets and permissions are confirmed.</p>
      </section>

      <p className="dev-more">Under development &mdash; more coming.</p>
    </div>
  );
}
