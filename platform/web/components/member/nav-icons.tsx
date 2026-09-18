/* Sidebar and top-bar glyphs, copied from build/dashboard.html. Several are
   traced from the WordPress dashboard reference (see the prototype's comments);
   the paths are reproduced exactly so the rail reads identically. */

const ICONS: Record<string, React.ReactElement> = {
  dashboard: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="1.4" y="1" width="8.5" height="6.8" rx="1.7"/><rect x="12.4" y="1" width="9.3" height="11.8" rx="1.7"/><rect x="1.4" y="10.3" width="8.5" height="11.9" rx="1.7"/><rect x="12.4" y="15.4" width="9.3" height="6.8" rx="1.7"/></svg>
  ),
  companion: (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a8 8 0 0 1-12 7l-5 1 1.5-4A8 8 0 1 1 21 12z"/><circle cx="9" cy="11" r="1" fill="currentColor"/><circle cx="15" cy="11" r="1" fill="currentColor"/></svg>
  ),
  progress: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="1" width="21.2" height="21.2" rx="1.9"/><path d="M5.2 1c0 2.8 2.3 5.1 5.1 5.1s5.1-2.3 5.1-5.1"/><path d="M12 3.5v1.7"/><rect x="3.5" y="8.6" width="6" height="11" rx="3"/><rect x="12.8" y="8.6" width="6" height="11" rx="3"/></svg>
  ),
  mood: (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8 14 Q 12 17.5, 16 14"/><circle cx="9" cy="10" r="1" fill="currentColor"/><circle cx="15" cy="10" r="1" fill="currentColor"/></svg>
  ),
  "food-choices": (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round"><path d="M6.3 11.7C9 7.6 12.4 5.9 15.6 5.9c4.1 0 7.3 2.6 7.3 5.8s-3.2 5.8-7.3 5.8c-3.2 0-6.6-1.7-9.3-5.8z"/><path d="M7 10.2C4.9 8.8 2.9 7.9 1 7.4c.4 1.3.6 2.3.6 3.2L5 11.7l-3.4 1.1c0 .9-.2 1.9-.6 3.2 1.9-.5 3.9-1.4 6-2.8"/><path d="M8.2 11.7q2.55-1.9 5.1 0-2.55 1.9-5.1 0z"/><path d="M16.6 7.3q-1.3 4.4 0 8.8"/><path d="M18.2 10.7v.9"/></svg>
  ),
  "meal-planning": (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="3" x2="8" y2="7"/><line x1="16" y1="3" x2="16" y2="7"/></svg>
  ),
  "food-diary": (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M11.6 5.2C9.3 3.1 6.1 2.2 3.9 2.3 2.4 2.4 1.3 2.9 1.3 3.9v12.9c0 .9 1.1 1.3 2.6 1.6 3.1.6 6 1.5 7.7 2 1.7-.5 4.6-1.4 7.7-2 1.5-.3 2.6-.7 2.6-1.6V3.9c0-1-1.1-1.5-2.6-1.6-2.2-.1-5.4.8-7.7 2.9z"/><path d="M11.6 5.2v15.2"/></svg>
  ),
  supplements: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="3.2" width="13.2" height="3.7" rx="1"/><path d="M4.3 4v2.4M7.6 4v2.4M10.9 4v2.4" strokeWidth="1.15"/><rect x="1.75" y="7.6" width="11.7" height="12.5" rx="1.3"/><path d="M4.7 9.1h8.8v7.3H4.7z"/><rect x="12.7" y="12.7" width="4.4" height="7.4" rx="2.2"/><rect x="12.7" y="16.4" width="8.8" height="3.7" rx="1.85"/></svg>
  ),
  fitness: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="5.1" y="1.5" width="13" height="6.5" rx="2.6"/><rect x="8.7" y="3.7" width="7.3" height="2.9" rx="1.2"/><path d="M6.9 8.2C4.2 9.6 2.2 12.5 2.2 16c0 2.3.8 4.4 2.2 5.9h14.2c1.4-1.5 2.2-3.6 2.2-5.9 0-3.5-2-6.4-4.7-7.8"/><ellipse cx="11.6" cy="15.05" rx="5.7" ry="4.7"/><circle cx="11.6" cy="13.6" r="1.15" strokeWidth="1.1"/><circle cx="11.6" cy="16.25" r="1.5" strokeWidth="1.1"/></svg>
  ),
  mindfulness: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="5" r="2.3"/><path d="M12 7.6v3.8"/><path d="M12 11.4c-2.1 0-4 1.2-4.9 3.2"/><path d="M12 11.4c2.1 0 4 1.2 4.9 3.2"/><path d="M7.1 14.6c-1.7.8-2.7 1.9-2.7 3 0 .7.5 1.3 1.3 1.7"/><path d="M16.9 14.6c1.7.8 2.7 1.9 2.7 3 0 .7-.5 1.3-1.3 1.7"/><path d="M8 18.2c1 .9 2.4 1.4 4 1.4s3-.5 4-1.4"/></svg>
  ),
  resources: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="2.45" width="21.3" height="15.4" rx="1.6"/><rect x="2.5" y="4.65" width="17.6" height="9.55" rx="0.8"/><path d="M7.2 12.1S4.6 10.4 4.6 8.6a1.55 1.55 0 0 1 2.6-1 1.55 1.55 0 0 1 2.6 1c0 1.8-2.6 3.5-2.6 3.5z"/><path d="M11.3 9.05h2.2l1.2-2.2 1.4 4.4 1.1-2.2h2.9"/><path d="M10.9 15.6h1.5"/><path d="M10.2 17.85 6.65 20.5h10l-3.55-2.65"/></svg>
  ),
  settings: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>
  ),
  logout: (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
  ),
  bell: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>
  ),
  chat: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9 8.5 8.5 0 0 1 8.5 8.5z"/></svg>
  ),
};

export function NavIcon({ name }: { name: string }) {
  return ICONS[name] ?? null;
}

/** The ringed arrow used on the prototype's module and card call-to-actions. */
export function ArrowCircle() {
  return (
    <span className="arrow-circle" aria-hidden="true">
      <svg viewBox="0 0 26 26" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"><circle cx="13" cy="13" r="12.2"/><path d="M7 13h13M16.5 9.5 20 13l-3.5 3.5"/></svg>
    </span>
  );
}

/** The "Back to My Progress" chevron used on every nested progress screen. */
export function BackChevron() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="10,3 5,8 10,13"/></svg>
  );
}
