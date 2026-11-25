"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Chip, Icon, PageHead, Subnav, fmtDate } from "@/components/admin/admin-chrome";
import {
  CARE_KINDS,
  CARE_KIND_LABELS,
  addFitnessVideo,
  getAdminFitnessLibrary,
  makeMainFitnessVideo,
  removeFitnessVideo,
  reorderFitnessVideos,
  updateFitnessVideo,
  type AdminFitnessLibrary,
  type AdminFitnessVideo,
  type FitnessGoalKey,
} from "@/lib/admin-console-api";

/* Care Studio → Fitness library (owner request, 15 Nov 2026). The member
   Fitness screen's four goals, filled from here: paste a YouTube or Vimeo
   link, give it the title members see, and order the goal's videos. One video
   per goal is the MAIN video — it waits in the big player at the top of the
   member screen; the rest follow in this order, nine to a page. The first
   video added to a goal becomes its main video. Hidden videos stay here and
   never reach members. Veye stores links, never video files. */

const GOALS: { key: FitnessGoalKey; label: string }[] = [
  { key: "stronger", label: "Get Stronger" }, { key: "weight", label: "Lose Weight" },
  { key: "fit", label: "Get Fit" }, { key: "performance", label: "Boost Performance" },
];

const EMPTY = { url: "", title: "", subtitle: "" };

export default function FitnessLibraryAdminPage() {
  const [goal, setGoal] = useState<FitnessGoalKey>("weight");
  const [library, setLibrary] = useState<AdminFitnessLibrary | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<{ id: string; title: string; subtitle: string } | null>(null);

  useEffect(() => {
    let live = true;
    setLibrary(null);
    getAdminFitnessLibrary(goal)
      .then((next) => { if (live) { setLibrary(next); setError(""); } })
      .catch((reason: Error) => { if (live) setError(reason.message); });
    return () => { live = false; };
  }, [goal]);

  const shown = useRef(goal);
  shown.current = goal;

  async function run(action: () => Promise<AdminFitnessLibrary>, done: string) {
    setBusy(true); setError(""); setNote("");
    const asked = goal;
    try {
      const next = await action();
      // A slow answer about one goal must not be drawn under another.
      if (shown.current === asked) setLibrary(next);
      setNote(done);
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "That change could not be saved.");
      return false;
    } finally { setBusy(false); }
  }

  async function add(event: FormEvent) {
    event.preventDefault();
    if (await run(() => addFitnessVideo({ goal, url: form.url.trim(), title: form.title.trim(), subtitle: form.subtitle.trim() }),
      `“${form.title.trim()}” is in ${label(goal)}.`)) setForm(EMPTY);
  }

  function move(videos: AdminFitnessVideo[], index: number, delta: number) {
    const ids = videos.map((v) => v.id);
    const [id] = ids.splice(index, 1);
    ids.splice(index + delta, 0, id);
    void run(() => reorderFitnessVideos(goal, ids), "The order is saved.");
  }

  const videos = library?.videos ?? [];
  const count = (key: FitnessGoalKey) => library?.goals.find((g) => g.key === key)?.count;

  return (
    <div className="page">
      <PageHead title="Fitness library"
                desc="The videos members see on the Fitness screen, goal by goal. The main video plays at the top; the rest follow in this order, nine to a page."
                crumbs={[{ label: "Home", href: "/admin" }, { label: "Care Studio", href: "/admin/care" }, { label: "Fitness library" }]} />
      <Subnav items={[...CARE_KINDS.map((k) => ({ key: k, label: CARE_KIND_LABELS[k], href: `/admin/care?kind=${k}` })),
                      { key: "library", label: "Fitness library", href: "/admin/care/fitness-library" }]} active="library" />

      <div className="row gap-2 wrap" role="group" aria-label="Goal" style={{ marginBottom: "var(--s-5)" }} data-testid="fitness-goals">
        {GOALS.map((g) => (
          <button key={g.key} type="button" className={`btn btn--sm ${g.key === goal ? "btn--primary" : "btn--secondary"}`}
                  aria-pressed={g.key === goal} onClick={() => { setGoal(g.key); setEditing(null); setNote(""); }}>
            {g.label}{count(g.key) !== undefined ? ` (${count(g.key)})` : ""}
          </button>
        ))}
      </div>

      {error && <p className="errorbar" role="alert">{error}</p>}
      {note && <p className="notice notice--quiet" role="status" data-testid="fitness-note">{note}</p>}

      <div className="card" style={{ marginBottom: "var(--s-5)" }}>
        <div className="card__head"><h2 className="card__title">Add a video to {label(goal)}</h2></div>
        <form className="card__body stack gap-4" method="post" onSubmit={(event) => void add(event)} data-testid="fitness-add">
          <div className="field">
            <label htmlFor="fit-url">YouTube or Vimeo link <span className="t-muted">(required)</span></label>
            <input className="input" id="fit-url" type="url" inputMode="url" required maxLength={500} placeholder="https://youtu.be/…  or  https://vimeo.com/…"
                   value={form.url} onChange={(event) => setForm({ ...form, url: event.target.value })} />
            <span className="field__hint">Unlisted videos work. Members watch them inside Veye, in the provider&rsquo;s privacy-enhanced player.</span>
          </div>
          <div className="field">
            <label htmlFor="fit-title">Title members see <span className="t-muted">(required)</span></label>
            <input className="input" id="fit-title" required maxLength={160} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="fit-subtitle">Subtitle</label>
            <input className="input" id="fit-subtitle" maxLength={200} value={form.subtitle} onChange={(event) => setForm({ ...form, subtitle: event.target.value })} />
          </div>
          <div><button className="btn btn--primary" type="submit" disabled={busy || !form.url.trim() || !form.title.trim()}><Icon name="plus" size={18} /> Add video</button></div>
        </form>
      </div>

      <div className="card">
        <div className="card__head"><h2 className="card__title">{label(goal)} &mdash; {videos.length} video{videos.length === 1 ? "" : "s"}</h2></div>
        <div className="rows" data-testid="fitness-list">
          {library === null && !error && <p className="loading-row">Loading…</p>}
          {library && videos.length === 0 && (
            <p className="t-support" style={{ padding: "var(--s-5)" }}>No videos in {label(goal)} yet. The first one you add becomes the main video.</p>
          )}
          {videos.map((video, index) => (
            <div key={video.id} className="rowitem" style={{ gridTemplateColumns: "128px minmax(0,1fr) auto" }} data-testid="fitness-row">
              <span style={{ display: "block", width: 128, aspectRatio: "16 / 9", borderRadius: 8, overflow: "hidden", background: "var(--tint-neutral)" }}>
                {video.thumbnail_url && <img src={video.thumbnail_url} alt="" referrerPolicy="no-referrer" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
              </span>
              <div>
                {editing?.id === video.id ? (
                  <div className="stack gap-2">
                    <input className="input" aria-label="Title" maxLength={160} value={editing.title} onChange={(event) => setEditing({ ...editing, title: event.target.value })} />
                    <input className="input" aria-label="Subtitle" maxLength={200} value={editing.subtitle} onChange={(event) => setEditing({ ...editing, subtitle: event.target.value })} />
                    <div className="row gap-2">
                      <button className="btn btn--primary btn--sm" type="button" disabled={busy || !editing.title.trim()}
                              onClick={() => void run(() => updateFitnessVideo(video.id, { title: editing.title, subtitle: editing.subtitle }), "Saved.").then((ok) => { if (ok) setEditing(null); })}>Save</button>
                      <button className="btn btn--ghost btn--sm" type="button" onClick={() => setEditing(null)}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="rowitem__title">{video.title}
                      {video.is_main && <Chip label="Main video" tone="live" />}
                      {!video.published && <Chip label="Hidden" tone="archived" />}
                    </div>
                    {video.subtitle && <div className="rowitem__meta">{video.subtitle}</div>}
                    <div className="rowitem__meta">
                      {video.provider === "vimeo" ? "Vimeo" : "YouTube"} · <a href={video.watch_url} target="_blank" rel="noopener noreferrer">open on {video.provider === "vimeo" ? "Vimeo" : "YouTube"}</a> · Updated {fmtDate(video.updated_at)}{video.updated_by ? ` by ${video.updated_by}` : ""}
                    </div>
                  </>
                )}
              </div>
              <div className="rowitem__side row gap-2 wrap" style={{ justifyContent: "flex-end" }}>
                {!video.is_main && video.published && (
                  <button className="btn btn--secondary btn--sm" type="button" disabled={busy} data-testid="fitness-make-main"
                          onClick={() => void run(() => makeMainFitnessVideo(video.id), `“${video.title}” is now the main video.`)}>Make main video</button>
                )}
                <button className="btn btn--ghost btn--sm" type="button" disabled={busy || index === 0} aria-label={`Move ${video.title} up`}
                        onClick={() => move(videos, index, -1)}>↑</button>
                <button className="btn btn--ghost btn--sm" type="button" disabled={busy || index === videos.length - 1} aria-label={`Move ${video.title} down`}
                        onClick={() => move(videos, index, 1)}>↓</button>
                <button className="btn btn--ghost btn--sm" type="button" disabled={busy}
                        onClick={() => void run(() => updateFitnessVideo(video.id, { published: !video.published }), video.published ? "Hidden from members." : "Shown to members.")}>
                  {video.published ? "Hide" : "Show"}
                </button>
                <button className="btn btn--ghost btn--sm" type="button" disabled={busy} onClick={() => setEditing({ id: video.id, title: video.title, subtitle: video.subtitle })}>Edit</button>
                <button className="btn btn--ghost btn--sm" type="button" disabled={busy}
                        onClick={() => { if (window.confirm(`Remove “${video.title}” from ${label(goal)}? Members stop seeing it at once.`)) void run(() => removeFitnessVideo(video.id), "Removed."); }}>Remove</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function label(goal: FitnessGoalKey): string {
  return GOALS.find((g) => g.key === goal)?.label ?? goal;
}
