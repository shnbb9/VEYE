"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { RequirePortal, useSession } from "@/components/session";

/* The Veye Admin Console shell, ported from admin-panel/prototype-client
   (rail + top utility bar + page canvas). Its stylesheets are the prototype's
   own files served verbatim from /admin-css; the class names below are the
   prototype's. The console is the ADMIN portal: it opens only for an admin
   session (/admin/login), whatever else the account may be. */

export const MAIN_NAV = [
  { key: "home", label: "Home", icon: "home", href: "/admin", match: (p: string) => p === "/admin" },
  { key: "members", label: "Members", icon: "users", href: "/admin/members", match: (p: string) => p.startsWith("/admin/members") },
  { key: "care", label: "Care Studio", icon: "heart", href: "/admin/care", match: (p: string) => p.startsWith("/admin/care") },
  { key: "assessments", label: "Assessments", icon: "clipboard", href: "/admin/assessments", match: (p: string) => p.startsWith("/admin/assessments") },
  { key: "companion", label: "Companion", icon: "sprout", href: "/admin/companion/conversations", match: (p: string) => p.startsWith("/admin/companion") },
  { key: "requests", label: "Requests & Inbox", icon: "inbox", href: "/admin/requests", match: (p: string) => p.startsWith("/admin/requests") },
  { key: "content", label: "Content", icon: "edit", href: "/admin/content", match: (p: string) => p.startsWith("/admin/content") },
  { key: "insights", label: "Insights", icon: "bar-chart", href: "/admin/insights", match: (p: string) => p.startsWith("/admin/insights") },
  { key: "settings", label: "Settings", icon: "settings", href: "/admin/settings", match: (p: string) => p.startsWith("/admin/settings") },
] as const;

const ADMIN_CSS = ["tokens", "base", "layout", "components", "screens", "client", "motion", "responsive"];

export const COMPANION_NAV = [
  { key: "conversations", label: "Conversations", href: "/admin/companion/conversations" },
  { key: "knowledge", label: "Knowledge Sources", href: "/admin/companion/knowledge-sources" },
  { key: "feedback", label: "Feedback", href: "/admin/companion/feedback" },
  { key: "settings", label: "Settings", href: "/admin/companion/settings" },
] as const;

export const ADVANCED_NAV = [
  { key: "ai-monitoring", label: "AI Monitoring", href: "/admin/companion/settings/advanced/ai-monitoring" },
  { key: "retrieval-diagnostics", label: "Retrieval Diagnostics", href: "/admin/companion/settings/advanced/retrieval-diagnostics" },
  { key: "safety-analytics", label: "Safety Analytics", href: "/admin/companion/settings/advanced/safety-analytics" },
  { key: "provider-status", label: "Provider Status", href: "/admin/companion/settings/advanced/provider-status" },
  { key: "audit", label: "Audit", href: "/admin/companion/settings/advanced/audit" },
] as const;

export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, className: "icon", "aria-hidden": true };
  switch (name) {
    case "home": return <svg {...common}><path d="M3 11.5 12 4l9 7.5" /><path d="M5 10.5V20h14v-9.5" /></svg>;
    case "sprout": return <svg {...common}><path d="M12 22V12" /><path d="M12 12c0-4 3-7 8-7 0 4-3 7-8 7z" /><path d="M12 16c0-3-2.5-5.5-6-5.5 0 3 2.5 5.5 6 5.5z" /></svg>;
    case "messages": return <svg {...common}><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" /></svg>;
    case "file-text": return <svg {...common}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /><path d="M9 13h6M9 17h6" /></svg>;
    case "thumbs": return <svg {...common}><path d="M7 10v11H3V10z" /><path d="M7 10l4-7a2 2 0 0 1 2 2v4h5a2 2 0 0 1 2 2.3l-1.4 7A2 2 0 0 1 16.7 21H7" /></svg>;
    case "settings": return <svg {...common}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>;
    case "activity": return <svg {...common}><path d="M3 12h4l3-8 4 16 3-8h4" /></svg>;
    case "search": return <svg {...common}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>;
    case "shield": return <svg {...common}><path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z" /><path d="m9 12 2 2 4-4" /></svg>;
    case "plug": return <svg {...common}><path d="M9 3v5M15 3v5" /><path d="M6 8h12v3a6 6 0 0 1-12 0z" /><path d="M12 17v4" /></svg>;
    case "list": return <svg {...common}><path d="M8 6h13M8 12h13M8 18h13" /><path d="M3 6h.01M3 12h.01M3 18h.01" /></svg>;
    case "log-out": return <svg {...common}><path d="M10 17l5-5-5-5" /><path d="M15 12H3" /><path d="M21 3v18" /></svg>;
    case "lock": return <svg {...common}><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>;
    case "bell": return <svg {...common}><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></svg>;
    case "inbox": return <svg {...common}><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.7 4H7.3a2 2 0 0 0-1.8 1.1z" /></svg>;
    case "check-circle": return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="m8.5 12 2.5 2.5 4.5-5" /></svg>;
    case "info": return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M12 8h.01M11 12h1v4h1" /></svg>;
    case "menu": return <svg {...common}><path d="M4 7h16M4 12h16M4 17h16" /></svg>;
    case "plus": return <svg {...common}><path d="M12 5v14M5 12h14" /></svg>;
    case "eye": return <svg {...common}><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></svg>;
    case "chevron-right": return <svg {...common}><path d="m9 6 6 6-6 6" /></svg>;
    case "chevron-left": return <svg {...common}><path d="m15 6-6 6 6 6" /></svg>;
    case "users": return <svg {...common}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.9" /><path d="M16 3.1a4 4 0 0 1 0 7.8" /></svg>;
    case "heart": return <svg {...common}><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z" /></svg>;
    case "clipboard": return <svg {...common}><rect x="8" y="2" width="8" height="4" rx="1" /><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /><path d="M9 12h6M9 16h6" /></svg>;
    case "edit": return <svg {...common}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4z" /></svg>;
    case "bar-chart": return <svg {...common}><path d="M12 20V10M18 20V4M6 20v-4" /></svg>;
    case "download": return <svg {...common}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M7 10l5 5 5-5" /><path d="M12 15V3" /></svg>;
    case "filter": return <svg {...common}><path d="M22 3H2l8 9.5V19l4 2v-8.5z" /></svg>;
    case "video": return <svg {...common}><path d="m22 8-6 4 6 4V8z" /><rect x="2" y="6" width="14" height="12" rx="2" /></svg>;
    case "link": return <svg {...common}><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" /><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" /></svg>;
    case "alert-circle": return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M12 8v4M12 16h.01" /></svg>;
    case "compass": return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="m16 8-2.5 5.5L8 16l2.5-5.5z" /></svg>;
    default: return null;
  }
}

export function AdminChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "";
  // The console's own door is not behind the console's guard.
  if (pathname === "/admin/login") return <>{children}</>;
  return (
    <RequirePortal portal="admin" fallback={<Opening />}>
      <AdminFrame>{children}</AdminFrame>
    </RequirePortal>
  );
}

function Stylesheets() {
  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link href="https://fonts.googleapis.com/css2?family=Kumbh+Sans:wght@300;400;500;600;700&family=Teachers:wght@400;500;600;700&display=swap" rel="stylesheet" />
      {ADMIN_CSS.map((name) => <link key={name} rel="stylesheet" href={`/admin-css/${name}.css`} />)}
      <link rel="stylesheet" href="/admin-css/admin-app.css" />
    </>
  );
}

function Opening() {
  return <><Stylesheets /><p className="t-support" style={{ padding: 32 }}>Opening the console…</p></>;
}

function AdminFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "";
  const session = useSession();
  const [railOpen, setRailOpen] = useState(false);
  const account = session.admin;
  const initials = account ? `${account.first_name[0] ?? ""}${account.last_name[0] ?? ""}`.toUpperCase() : "";
  const section = MAIN_NAV.find((item) => item.match(pathname))?.key ?? "home";

  async function signOut() {
    // Ends the ADMIN session only; a member session in this browser stays.
    await session.signOut("admin", "/admin/login?flash=signed-out");
  }

  return (
    <>
      <Stylesheets />
      <a className="sr-only sr-only-focusable" href="#main-content">Skip to main content</a>
      <div className={`app${railOpen ? " is-rail-open" : ""}`} id="app">
        <nav className="rail" id="rail" aria-label="Main">
          <Link className="rail__brand" href="/admin" aria-label="Veye Admin Console — go to Home">
            <img src="/admin/veye-logo.png" alt="Veye" width={108} height={34} />
          </Link>
          <div className="rail__org">
            <b>Veye</b>
            <span className="rail__sub">Admin Console</span>
          </div>
          <div className="rail__nav">
            <ul className="rail__list">
              {MAIN_NAV.map((item) => (
                <li key={item.key}>
                  <Link className={`nav-link${section === item.key ? " is-active" : ""}`} href={item.href} aria-current={section === item.key ? "page" : undefined} onClick={() => setRailOpen(false)}>
                    <Icon name={item.icon} /><span>{item.label}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div className="rail__foot">
            <button className="rail__collapse" type="button" onClick={() => void signOut()}><Icon name="log-out" /><span>Sign out</span></button>
          </div>
        </nav>

        <div className="main">
          <header className="topbar" id="topbar">
            <button className="icon-btn" id="railToggleSm" aria-label="Open the menu" type="button" onClick={() => setRailOpen((open) => !open)}><Icon name="menu" /></button>
            <div className="topbar__spacer" />
            <div className="topbar__tools">
              <span className="chip chip--lime">Local development · synthetic data</span>
              <Link className="who" style={{ padding: "2px 8px 2px 2px", textDecoration: "none" }} href="/admin/settings" aria-label="Your account settings">
                <span className="avatar">{initials}</span>
                <span className="who__text"><span className="who__name">{account?.first_name} {account?.last_name}</span><span className="who__role">Administrator</span></span>
              </Link>
            </div>
          </header>
          <main id="main-content" tabIndex={-1}>{children}</main>
        </div>
      </div>
    </>
  );
}

/* ---- page primitives (helpers.js: pageHead, subnav, chip, emptyState) ---- */

export function PageHead({ title, desc, crumbs, actions }: { title: string; desc?: ReactNode; crumbs?: { label: string; href?: string }[]; actions?: ReactNode }) {
  return (
    <div className="page__head">
      {crumbs && (
        <nav className="breadcrumb" aria-label="Breadcrumb">
          {crumbs.map((crumb, index) => {
            const last = index === crumbs.length - 1;
            return last || !crumb.href
              ? <span key={crumb.label} aria-current="page">{crumb.label}</span>
              : <span key={crumb.label}><Link href={crumb.href}>{crumb.label}</Link><span className="breadcrumb__sep"> › </span></span>;
          })}
        </nav>
      )}
      <div className="page__title-row">
        <div className="page__titles">
          <h1>{title}</h1>
          {desc && <p className="page__desc">{desc}</p>}
        </div>
        {actions && <div className="page__actions">{actions}</div>}
      </div>
    </div>
  );
}

export function Subnav({ items, active }: { items: readonly { key: string; label: string; href: string; count?: number }[]; active: string }) {
  return (
    <nav className="subnav" aria-label="Section">
      {items.map((item) => (
        <Link key={item.key} className={`subnav__btn${item.key === active ? " is-active" : ""}`} href={item.href} aria-current={item.key === active ? "page" : undefined}>
          {item.label}{item.count != null && item.count > 0 && <span className="subnav__count">{item.count}</span>}
        </Link>
      ))}
    </nav>
  );
}

const CHIP_TONE: Record<string, string> = {
  Active: "live", Inactive: "draft", Draft: "draft", Archived: "archived", ingested: "live", failed: "error", pending: "draft",
  answered: "live", prohibited: "attention", escalated: "attention", off_topic: "draft", unavailable: "error",
  allow: "live", prohibit: "attention", escalate: "error", helpful: "live", not_helpful: "attention", pass: "live",
  enabled: "live", disabled: "archived", sent: "live", skipped: "draft",
};

export function Chip({ label, tone }: { label: string; tone?: string }) {
  return <span className={`chip chip--${tone ?? CHIP_TONE[label] ?? "draft"}`}>{label.replace(/_/g, " ")}</span>;
}

export function EmptyState({ icon, title, msg }: { icon: string; title: string; msg: string }) {
  return (
    <div className="state">
      <span className="state__icon"><Icon name={icon} /></span>
      <div className="state__title">{title}</div>
      <p className="state__msg">{msg}</p>
    </div>
  );
}

export function Metric({ label, value, note, tone }: { label: string; value: ReactNode; note?: string; tone?: string }) {
  return (
    <div className="metric">
      <span className={`metric__icon${tone ? ` metric__icon--${tone}` : ""}`}><Icon name="activity" size={18} /></span>
      <div className="metric__body">
        <span className="metric__label">{label}</span>
        <span className="metric__value">{value}</span>
        {note && <span className="metric__delta">{note}</span>}
      </div>
    </div>
  );
}

export function fmtDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
