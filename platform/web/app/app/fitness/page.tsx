"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useToast } from "@/components/member/member-chrome";
import { getPublishedCare, type MemberCareItem } from "@/lib/api";

/* The library preview's four goal tabs, exactly as the prototype draws them
   (build/dashboard.html, .fit-tabs). Only "Lose Weight" has a collection; the
   others stay selectable-looking and say so instead of pretending. */
const FIT_TABS: { key: string; label: string; icon: ReactNode }[] = [
  { key: "stronger", label: "Get Stronger", icon: <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M11 27c1.4-5.2 4.7-8.7 9.4-9.6l3.2-.6 2.2-5.2c.5-1.2 1.9-1.8 3.1-1.3l1.2.5c1.2.5 1.7 1.8 1.2 3l-1.9 4.7 4.3 1.2c3.1.9 5.2 3.7 5.2 6.9V31c0 2.4-1.9 4.3-4.3 4.3H20.8c-4.2 0-7.8-3.5-7.8-7.8V27z" /><path d="M12 28.5 7.5 31l-1.8-3.6 5.2-2.7" /><path d="M25.3 19.1c2.4 1.4 4.4 1.6 6.9.8" /></svg> },
  { key: "weight", label: "Lose Weight", icon: <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 16h24v18H12z" /><path d="M16 16V9M32 16V9M9 12h7M32 12h7" /><path d="M15 23h18M19 29h10" /><path d="M21 9c-2.3 2.3-2.3 5.2 0 7.2M27 9c2.3 2.3 2.3 5.2 0 7.2" /></svg> },
  { key: "fit", label: "Get Fit", icon: <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M10 35c4-3.4 6.3-7.5 7.4-13.1.7-3.5 3.1-5.8 6.6-5.8h2.1c3.5 0 5.9 2.3 6.6 5.8C33.8 27.5 36 31.6 40 35" /><path d="M24 16V9M20.5 9h7" /><path d="M15.5 27c2.4 1.1 4.9 1.6 8.5 1.6s6.1-.5 8.5-1.6" /></svg> },
  { key: "performance", label: "Boost Performance", icon: <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M7 20h34M11 15v10M17 12v16M31 12v16M37 15v10" /><path d="M12 34h24M16 30v8M32 30v8" /></svg> },
];

/* Fitness (build/dashboard.html, #view-fitness): Cara's recommendations as
   VEYE cards — an external program opens in a new tab, videos embed through
   the privacy-enhanced YouTube domain, lazily, without autoplay — followed by
   the approved library preview. The cards are the PUBLISHED Care Studio items
   for this section, in display order; nothing here is hard-wired content. */

export default function FitnessPage() {
  const [items, setItems] = useState<MemberCareItem[] | null>(null);
  const [error, setError] = useState("");
  const toast = useToast();

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
                  <div className="fit-embed">
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
        <div className="fit-tabs" role="tablist" aria-label="Fitness goals">
          {FIT_TABS.map((tab) => (
            <button key={tab.key} className={`fit-tab${tab.key === "weight" ? " is-active" : ""}`} type="button" role="tab"
                    aria-selected={tab.key === "weight"} data-fit-category={tab.key}
                    onClick={() => { if (tab.key !== "weight") toast.flash("This fitness collection is coming in a later update."); }}>
              <span className="fit-tab__icon" aria-hidden="true">{tab.icon}</span><span>{tab.label}</span>
            </button>
          ))}
        </div>

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
