"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { getFitnessLibrary, type FitnessGoalKey, type FitnessLibrary, type FitnessVideo } from "@/lib/member-api";
import { prefersReducedMotion } from "@/lib/member-format";

/* The Fitness library (owner request, 15 Nov 2026) in the approved
   prototype's frame (build/dashboard.html, .fit-card): the four goal tabs, the
   big player and the cards in rows of three. The console chooses each goal's
   videos and its MAIN video; the main video waits in the big player, every
   card plays in it ("Now Playing"), and more than nine videos page.

   Nothing from YouTube or Vimeo loads until the member presses play: the
   player shows the video's still and a play button, and only then is the
   provider's privacy-domain player put on the page. */

type Props = { tabs: { key: string; label: string; icon: ReactNode }[] };

const playUrl = (video: FitnessVideo) => `${video.embed_url}${video.embed_url.includes("?") ? "&" : "?"}autoplay=1`;

export function FitnessLibrarySection({ tabs }: Props) {
  const [request, setRequest] = useState<{ goal?: FitnessGoalKey; page: number }>({ page: 1 });
  const [library, setLibrary] = useState<FitnessLibrary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [playing, setPlaying] = useState<FitnessVideo | null>(null);
  const [started, setStarted] = useState(false);
  const hero = useRef<HTMLElement>(null);

  useEffect(() => {
    let live = true;
    setLoading(true);
    getFitnessLibrary(request.goal, request.page)
      .then((next) => {
        if (!live) return;
        setLibrary(next);
        setError("");
        // A new goal opens on its main video; paging keeps what is playing.
        setPlaying((current) => (current && current.goal === next.goal ? current : next.main));
      })
      .catch((reason: Error) => { if (live) setError(reason.message); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [request]);

  function chooseGoal(goal: FitnessGoalKey) {
    if (goal === library?.goal && request.page === 1 && !error && !loading) return;
    setStarted(false);
    setPlaying(null);
    setRequest({ goal, page: 1 });
  }

  function play(video: FitnessVideo) {
    if (loading) return;   // a card of the goal being left
    setPlaying(video);
    setStarted(true);
    hero.current?.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
  }

  // The goal asked for is the one shown as chosen, even while it loads.
  const goal = request.goal ?? library?.goal ?? "weight";
  const label = library?.goals.find((g) => g.key === goal)?.label ?? "";

  return (
    <>
      <h2 className="fit-lib-title">Fitness library</h2>
      <section className="fit-card" aria-label="Fitness library" data-testid="fitness-library">
        <div className="fit-tabs" role="tablist" aria-label="Fitness goals">
          {tabs.map((tab) => {
            const count = library?.goals.find((g) => g.key === tab.key)?.count ?? 0;
            const active = tab.key === goal;
            return (
              <button key={tab.key} className={`fit-tab${active ? " is-active" : ""}`} type="button" role="tab"
                      aria-selected={active} data-fit-category={tab.key} aria-controls="fitLibraryPanel"
                      aria-label={`${tab.label}, ${count} video${count === 1 ? "" : "s"}`}
                      onClick={() => chooseGoal(tab.key as FitnessGoalKey)}>
                <span className="fit-tab__icon" aria-hidden="true">{tab.icon}</span><span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        <div id="fitLibraryPanel" role="tabpanel" aria-label={label} aria-busy={loading}>
          {error && <p className="fdx-err" role="alert">{error}</p>}
          {library && library.goal !== goal && !error ? (
            <p className="fit-empty" role="status">Loading {label} videos&hellip;</p>
          ) : library && !library.main ? (
            <p className="fit-empty" data-testid="fitness-empty">No videos in {label} yet &mdash; they will appear here as the Veye team adds them.</p>
          ) : playing ? (
            <figure className="fit-hero fit-hero--video" id="fitHero" ref={hero} data-testid="fitness-player">
              <div className="fit-hero__image">
                {started ? (
                  <iframe key={playing.id} src={playUrl(playing)} title={`${playing.title} (${playing.provider === "vimeo" ? "Vimeo" : "YouTube"} video)`}
                          allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen" allowFullScreen
                          referrerPolicy="strict-origin-when-cross-origin" />
                ) : (
                  <button className="fit-hero__play" type="button" onClick={() => setStarted(true)} data-testid="fitness-play"
                          aria-label={`Play ${playing.title}`}>
                    {playing.thumbnail_url ? <img src={playing.thumbnail_url} alt="" referrerPolicy="no-referrer" /> : null}
                    <svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="30" fill="rgba(23,31,12,.45)" stroke="#fff" strokeWidth="2" /><path d="M26 20.5 45 32 26 43.5z" fill="#fff" /></svg>
                  </button>
                )}
              </div>
              <figcaption>
                <strong>{playing.title}</strong>
                <span className="fit-preview-kind">{playing.subtitle || (playing.is_main ? "Featured" : "")}</span>
              </figcaption>
            </figure>
          ) : null}

          {library && library.goal === goal && library.videos.length > 0 && (
            <div className="fit-thumbs" aria-label={`${label} videos`} data-testid="fitness-videos">
              {library.videos.map((video) => {
                const now = playing?.id === video.id;
                return (
                  <button key={video.id} type="button" onClick={() => play(video)} aria-pressed={now}
                          className={`fit-thumb fit-thumb--video${video.is_main ? " fit-thumb--featured" : ""}${now ? " is-playing" : ""}`}
                          data-testid="fitness-video">
                    <span className="fit-thumb__image">
                      {video.thumbnail_url ? <img src={video.thumbnail_url} alt="" loading="lazy" referrerPolicy="no-referrer" /> : null}
                      {now && <span className="fit-thumb__playing">Now Playing</span>}
                      {video.is_main && <span className="fit-thumb__chip">Featured</span>}
                    </span>
                    <span className="fit-thumb__cap"><b>{video.title}</b>{video.subtitle && <span>{video.subtitle}</span>}</span>
                  </button>
                );
              })}
            </div>
          )}

          {library && library.goal === goal && library.pages > 1 && (
            <nav className="fit-pages" aria-label={`${label} video pages`} data-testid="fitness-pages">
              <button type="button" disabled={library.page <= 1} onClick={() => setRequest({ goal, page: library.page - 1 })}>
                <span aria-hidden="true">&lsaquo;</span> Previous
              </button>
              {Array.from({ length: library.pages }, (_, i) => i + 1).map((n) => (
                <button key={n} type="button" aria-current={n === library.page ? "page" : undefined} aria-label={`Page ${n}`}
                        onClick={() => setRequest({ goal, page: n })}>{n}</button>
              ))}
              <button type="button" disabled={library.page >= library.pages} onClick={() => setRequest({ goal, page: library.page + 1 })}>
                Next <span aria-hidden="true">&rsaquo;</span>
              </button>
            </nav>
          )}
        </div>
      </section>
    </>
  );
}
