"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useToast } from "@/components/member/member-chrome";
import { getMood, localDateKey, logMood, removeMood, type Mood, type MoodEntry, type MoodOverview } from "@/lib/member-api";

/* The approved Mood Tracker (build/dashboard.html, #view-mood): a monthly
   calendar, one mood a day with an optional note, the four header figures
   (days logged, streak, most felt, Balance score by the client's formula)
   and the mood palette. Entries persist on the server; the figures are
   computed there so the console shows the same numbers. Not redesigned. */

const MOODS: Record<Mood, { emoji: string; label: string; color: string }> = {
  happy: { emoji: "😊", label: "Happy", color: "#7DBE5F" },
  excited: { emoji: "🤩", label: "Excited", color: "#F2C94A" },
  calm: { emoji: "😌", label: "Calm", color: "#7BB6D6" },
  neutral: { emoji: "😐", label: "Neutral", color: "#B0B5BF" },
  tired: { emoji: "😴", label: "Tired", color: "#5C7A9C" },
  stressed: { emoji: "😫", label: "Stressed", color: "#E89A4A" },
  sad: { emoji: "😔", label: "Sad", color: "#9B7AC6" },
  angry: { emoji: "😡", label: "Angry", color: "#D55E4A" },
};
const MOOD_KEYS = Object.keys(MOODS) as Mood[];

function parseKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}
const formatLong = (d: Date) => d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
const formatShort = (d: Date) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });

export default function MoodPage() {
  const toast = useToast();
  const [month, setMonth] = useState(() => { const now = new Date(); return new Date(now.getFullYear(), now.getMonth(), 1); });
  const [data, setData] = useState<MoodOverview | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(localDateKey());
  const [picker, setPicker] = useState<{ dateKey: string } | null>(null);
  const [noteModal, setNoteModal] = useState<{ dateKey: string; mood: Mood; note: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const monthKey = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}`;
  const todayKey = localDateKey();

  const load = useCallback(async () => {
    try {
      setData(await getMood(monthKey));
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Your moods could not be loaded.");
    }
  }, [monthKey]);
  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { setPicker(null); setNoteModal(null); } };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const byDay = useMemo(() => new Map((data?.entries ?? []).map((entry) => [entry.entry_date, entry])), [data]);
  const stats = data?.stats;

  async function save(dateKey: string, mood: Mood, note: string) {
    setSaving(true);
    try {
      await logMood(dateKey, mood, note);
      setNoteModal(null);
      setPicker(null);
      setSelected(dateKey);
      await load();
      toast.flash("Mood saved");
    } catch (reason) {
      toast.flash(reason instanceof Error ? reason.message : "Your mood could not be saved");
    } finally { setSaving(false); }
  }

  async function remove(dateKey: string) {
    try {
      await removeMood(dateKey);
      await load();
      toast.flash("Mood removed");
    } catch (reason) {
      toast.flash(reason instanceof Error ? reason.message : "The mood could not be removed");
    }
  }

  // ---- calendar cells
  const y = month.getFullYear();
  const m = month.getMonth();
  const firstDow = new Date(y, m, 1).getDay();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const today = parseKey(todayKey);
  const selectedEntry = byDay.get(selected) ?? null;
  const selectedDate = parseKey(selected);
  const isToday = selected === todayKey;

  return (
    <>
      <header className="mood-hero fade-in">
        <div className="mood-hero-text">
          <span className="mood-eyebrow">Wellness Journal</span>
          <h1>Mood Tracker</h1>
          <p>Check in with yourself daily. Watch the patterns. Care for your mind the way you care for your body.</p>
        </div>
        <button className="mood-log-cta" id="openMoodPicker" type="button" onClick={() => setPicker({ dateKey: todayKey })}>
          <span className="cta-emoji">😀</span>
          Log Your Mood Today
          <span className="cta-arrow">&rarr;</span>
        </button>
      </header>

      <div className="mood-stats-row fade-in d1">
        <div className="mood-stat-card"><div className="stat-num" id="statLogged" data-testid="mood-logged">{stats ? stats.days_logged_this_month : "—"}</div><div className="stat-label">Days logged this month</div></div>
        <div className="mood-stat-card accent-gold"><div className="stat-num" id="statStreak" data-testid="mood-streak">{stats ? stats.day_streak : "—"}</div><div className="stat-label">Day streak</div></div>
        <div className="mood-stat-card accent-sage">
          <div className="stat-num" id="statTopMood" title={stats?.top_mood_label ?? undefined} data-testid="mood-top">{stats?.top_mood ? MOODS[stats.top_mood].emoji : "—"}</div>
          <div className="stat-label">Most felt mood</div>
        </div>
        <div className="mood-stat-card accent-blue">
          <div className="stat-num" id="statBalance" data-testid="mood-balance"
               title="Rolling 30-day average: positive moods (happy, calm, excited) count 100, neutral 50, tired and sad 25, stressed and angry 0.">
            {stats && stats.balance_score !== null ? `${stats.balance_score}%` : "—"}
          </div>
          <div className="stat-label">Balance score</div>
        </div>
      </div>

      {error && <p className="chat-error" role="alert">{error}</p>}

      <div className="mood-grid">
        <div className="mood-cal-card fade-in d2">
          <div className="cal-head">
            <button className="cal-nav" type="button" aria-label="Previous month" onClick={() => setMonth(new Date(y, m - 1, 1))}>
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="10,3 5,8 10,13" /></svg>
            </button>
            <h2 id="calMonthLabel">{month.toLocaleString(undefined, { month: "long", year: "numeric" })}</h2>
            <button className="cal-nav" type="button" aria-label="Next month" onClick={() => setMonth(new Date(y, m + 1, 1))}>
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6,3 11,8 6,13" /></svg>
            </button>
          </div>
          <div className="cal-weekdays"><span>Sun</span><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span></div>
          <div className="cal-days" id="calDays">
            {Array.from({ length: firstDow }, (_, i) => <div className="cal-day blank" aria-hidden="true" key={`blank-${i}`} />)}
            {Array.from({ length: daysInMonth }, (_, i) => {
              const d = i + 1;
              const date = new Date(y, m, d);
              const key = localDateKey(date);
              const entry = byDay.get(key);
              const future = date > today;
              const classes = ["cal-day", key === todayKey ? "today" : "", entry ? `has-mood mood-${entry.mood}` : "", key === selected ? "selected" : "", future ? "future" : ""].filter(Boolean).join(" ");
              return (
                <button key={key} className={classes} data-date={key} type="button" disabled={future} aria-disabled={future || undefined}
                        aria-label={future ? `${d} — not yet` : undefined} title={future ? "Not yet — a mood is logged for today or an earlier day" : undefined}
                        style={entry ? ({ "--mood-color": MOODS[entry.mood].color } as React.CSSProperties) : undefined}
                        onClick={() => setSelected(key)}>
                  <span className="day-num">{d}</span>
                  {entry && <span className="day-emoji">{MOODS[entry.mood].emoji}</span>}
                  {key === todayKey && <span className="day-today-dot" aria-hidden="true" />}
                </button>
              );
            })}
          </div>
        </div>

        <aside className="mood-side">
          <div className="day-detail fade-in d3" id="dayDetail" data-testid="mood-day-detail">
            {selectedEntry ? (
              <>
                <span className="modal-eyebrow">{isToday ? "Today" : formatShort(selectedDate)}</span>
                <div className="detail-emoji" style={{ background: `${MOODS[selectedEntry.mood].color}22`, boxShadow: `0 0 0 6px ${MOODS[selectedEntry.mood].color}10` }}>{MOODS[selectedEntry.mood].emoji}</div>
                <span className="detail-date">{formatLong(selectedDate)}</span>
                <h3>You felt <span style={{ color: MOODS[selectedEntry.mood].color }}>{MOODS[selectedEntry.mood].label}</span></h3>
                {selectedEntry.note ? <blockquote className="detail-note">&ldquo;{selectedEntry.note}&rdquo;</blockquote> : <p className="detail-note empty">No note for this day.</p>}
                <div className="detail-actions">
                  <button className="btn-ghost detail-action-btn" type="button" onClick={() => setNoteModal({ dateKey: selected, mood: selectedEntry.mood, note: selectedEntry.note })}>
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M11.3 2.1l2.6 2.6L5.2 13.4l-3.1.5.5-3.1z" /></svg>
                    Edit text
                  </button>
                  <button className="btn-ghost detail-action-btn" type="button" onClick={() => setPicker({ dateKey: selected })}>Change mood</button>
                  <button className="btn-link detail-action-btn detail-action-btn--danger" type="button" onClick={() => void remove(selected)}>
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2.5 4.5h11M6.5 4.5V3a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v1.5M4 4.5l.7 8.4a1 1 0 0 0 1 .9h4.6a1 1 0 0 0 1-.9l.7-8.4" /></svg>
                    Remove
                  </button>
                </div>
              </>
            ) : (
              <>
                <span className="modal-eyebrow">{isToday ? "Today" : formatShort(selectedDate)}</span>
                <div className="detail-emoji empty">💬</div>
                <span className="detail-date">{formatLong(selectedDate)}</span>
                <h3>{isToday ? "No mood logged yet" : "Nothing logged for this day"}</h3>
                <p className="detail-note">{isToday ? "How are you feeling? Take a moment to check in with yourself." : "Looking back, you didn't record anything here."}</p>
                <button className={isToday ? "btn-primary btn-small" : "btn-ghost btn-small"} type="button" onClick={() => setPicker({ dateKey: selected })}>
                  {isToday ? "Log Today" : `Log mood for ${formatShort(selectedDate)}`}
                </button>
              </>
            )}
          </div>

          <div className="mood-legend fade-in d4">
            <h4>Mood Palette</h4>
            <div className="legend-list">
              {MOOD_KEYS.map((key) => (
                <div className="legend-item" key={key}><span className="legend-dot" style={{ background: MOODS[key].color }} /><span className="legend-emoji">{MOODS[key].emoji}</span> {MOODS[key].label}</div>
              ))}
            </div>
          </div>
        </aside>
      </div>

      {/* Mood picker */}
      <div className={`modal-overlay${picker ? " open" : ""}`} id="moodPickerModal" aria-hidden={!picker} onClick={(event) => { if (event.target === event.currentTarget) setPicker(null); }}>
        {picker && (
          <div className="modal-card modal-picker" role="dialog" aria-modal="true" aria-labelledby="pickerHeading">
            <button className="modal-close" type="button" aria-label="Close" onClick={() => setPicker(null)}>&times;</button>
            <span className="modal-eyebrow">Mood Check-in</span>
            <h3 id="pickerHeading">{picker.dateKey === todayKey ? "How are you feeling today?" : `How were you feeling on ${formatShort(parseKey(picker.dateKey))}?`}</h3>
            <p className="modal-sub">Tap an emoji that matches your day. You can change it anytime.</p>
            <div className="emoji-picker">
              {MOOD_KEYS.map((key) => (
                <button className="emoji-btn" data-mood={key} type="button" key={key}
                        onClick={() => setNoteModal({ dateKey: picker.dateKey, mood: key, note: byDay.get(picker.dateKey)?.note ?? "" })}>
                  <span className="emo">{MOODS[key].emoji}</span><span className="lbl">{MOODS[key].label}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Note entry */}
      <div className={`modal-overlay${noteModal ? " open" : ""}`} id="moodNoteModal" aria-hidden={!noteModal} onClick={(event) => { if (event.target === event.currentTarget) setNoteModal(null); }}>
        {noteModal && <NoteModal modal={noteModal} todayKey={todayKey} saving={saving} onChange={(note) => setNoteModal({ ...noteModal, note })}
                                 onCancel={() => setNoteModal(null)} onSave={() => void save(noteModal.dateKey, noteModal.mood, noteModal.note)} />}
      </div>
    </>
  );
}

function NoteModal({ modal, todayKey, saving, onChange, onCancel, onSave }: {
  modal: { dateKey: string; mood: Mood; note: string }; todayKey: string; saving: boolean;
  onChange: (note: string) => void; onCancel: () => void; onSave: () => void;
}) {
  const mood = MOODS[modal.mood];
  const date = parseKey(modal.dateKey);
  return (
    <div className="modal-card modal-note" role="dialog" aria-modal="true" aria-labelledby="noteHeading">
      <button className="modal-close" type="button" aria-label="Close" onClick={onCancel}>&times;</button>
      <div className="note-emoji-big" id="noteEmojiBig">{mood.emoji}</div>
      <span className="modal-eyebrow" id="noteDate">{modal.dateKey === todayKey ? `Today · ${formatShort(date)}` : formatLong(date)}</span>
      <h3 id="noteHeading">You&rsquo;re feeling <span style={{ color: mood.color }}>{mood.label}</span></h3>
      <p className="modal-sub">Capture a couple of lines about your day &mdash; what triggered the mood, what you&rsquo;d like to remember.</p>
      <div className="note-input-wrap">
        <textarea id="noteText" rows={3} maxLength={200} placeholder="A quick note about today..." value={modal.note} onChange={(event) => onChange(event.target.value)} autoFocus />
        <small className="char-count"><span id="charCount">{modal.note.length}</span> / 200</small>
      </div>
      <div className="modal-actions">
        <button className="btn-ghost" type="button" onClick={onCancel}>Cancel</button>
        <button className="btn-primary" id="saveMoodBtn" type="button" disabled={saving} onClick={onSave}>{saving ? "Saving…" : "Save Mood"}</button>
      </div>
    </div>
  );
}

export type { MoodEntry };
