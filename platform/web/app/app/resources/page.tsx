"use client";

import { useEffect, useState } from "react";
import { getPublishedCare, type MemberCareItem } from "@/lib/api";
import { useToast } from "@/components/member/member-chrome";

/* Resources (build/dashboard.html, #view-resources): the four approved cards
   (Blogs, Lifestyle, Articles, Biohacks). A card whose content has not been
   published in Care Studio stays honestly "In development" with a disabled
   Coming Soon action; a PUBLISHED card with a link opens it. */

const APPROVED_CARDS = [
  { title: "Blogs", description: "Veye contributors comment on a number of factors related to wellness. Read our regularly updated articles and view the videos that interest you. Not seeing what interests you? Let us know and we will create a post with your interests in mind." },
  { title: "Lifestyle", description: "Explore media that focuses on daily living, personal interests, and hobbies. Veye topics include fashion, food, travel, wellness, plastic surgery, and even home decor. Want recipes, cooking tips, and tips for dining out? We have that, too." },
  { title: "Articles", description: "Research papers, excerpts, and articles giving you insight to the science behind the Veye program. Want academic or accessible, expert content or beginner guides, advanced research or quick reads? Veye has it all." },
  { title: "Biohacks", description: "Interested in making intentional changes to your exercise routine, lifestyle, or environment to optimize your physical and mental performance? Often called \"do-it-yourself biology\", Biohacks use science, data, and self-experimentation to take a proactive role in health and longevity. Discover Veye offerings and recommendations." },
];

export default function ResourcesPage() {
  const [published, setPublished] = useState<MemberCareItem[]>([]);
  const toast = useToast();

  useEffect(() => {
    getPublishedCare("resource").then(setPublished).catch(() => setPublished([]));
  }, []);

  const cards = [
    ...APPROVED_CARDS.map((card) => ({ ...card, item: published.find((p) => p.title === card.title) ?? null })),
    ...published.filter((p) => !APPROVED_CARDS.some((c) => c.title === p.title)).map((p) => ({ title: p.title, description: p.description, item: p })),
  ];

  return (
    <div className="view-resources">
      <h1 className="fd-title">Resources</h1>
      <p className="dev-note">Resources are in development.</p>
      <div className="res-layout">
        <div className="res-grid">
          {cards.map((card) => {
            const live = card.item?.external_url ?? null;
            return (
              <article className="res-card" key={card.title}>
                <div className="res-card__meta"><img className="res-card__icon" src="/assets/web/img/nav-resources.png" alt="" /><span className="res-card__status">{live ? "Published" : "In development"}</span></div>
                <h3>{card.title}</h3>
                <p>{card.item?.description || card.description}</p>
                {live
                  ? <a className="res-btn" href={live} target="_blank" rel="noopener noreferrer">Discover more <span aria-hidden="true">&rarr;</span></a>
                  : <button className="res-btn" type="button" aria-disabled="true" onClick={() => toast.flash(`${card.title} is coming soon.`)}>Coming Soon</button>}
              </article>
            );
          })}
        </div>
        <aside className="res-feature" aria-label="Veye resource library preview">
          <span className="res-feature__eyebrow">Veye Library</span>
          <h2>Wellness guidance, made practical</h2>
          <p>New articles, lifestyle ideas and expert-led resources will be organised here as the library grows.</p>
          <img src="/assets/web/img/promo-art.png" alt="People celebrating progress with a trophy and upward arrow" />
          <button className="res-btn" type="button" aria-disabled="true" title="Coming soon" onClick={() => toast.flash("The Veye Library is coming soon.")}>Browse Veye topics <span aria-hidden="true">&rarr;</span></button>
          <span className="res-card__status">Coming soon</span>
        </aside>
      </div>
      <p className="sr-only" id="resSoonNote">This section is coming soon and cannot be opened yet.</p>
      <p className="dev-more">Under development &mdash; more coming.</p>
    </div>
  );
}
