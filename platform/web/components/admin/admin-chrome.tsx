"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { RequireRole, useSession } from "@/components/session";

/* The Veye Admin Console shell, ported from admin-panel/prototype-client
   (rail + top utility bar + page canvas). Its stylesheets are the prototype's
   own files served verbatim from /admin-css; the class names below are the
   prototype's. Only the Companion area is a production surface today. */

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
    case "check-circle": return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="m8.5 12 2.5 2.5 4.5-5" /></svg>;
    case "info": return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M12 8h.01M11 12h1v4h1" /></svg>;
    case "menu": return <svg {...common}><path d="M4 7h16M4 12h16M4 17h16" /></svg>;
    case "plus": return <svg {...common}><path d="M12 5v14M5 12h14" /></svg>;
    case "eye": return <svg {...common}><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></svg>;
    case "chevron-right": return <svg {...common}><path d="m9 6 6 6-6 6" /></svg>;
    default: return null;
  }
}

export function AdminChrome({ children }: { children: ReactNode }) {
  return (
    <RequireRole role="admin" fallback={<Opening />}>
      <AdminFrame>{children}</AdminFrame>
    </RequireRole>
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
  const router = useRouter();
  const session = useSession();
  const [railOpen, setRailOpen] = useState(false);
  const account = session.account;
  const initials = account ? `${account.first_name[0] ?? ""}${account.last_name[0] ?? ""}`.toUpperCase() : "";
  const section = pathname.startsWith("/admin/companion") ? "companion" : "home";

  async function signOut() {
    router.replace("/login");
    await session.signOut();
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
              <li>
                <Link className={`nav-link${section === "home" ? " is-active" : ""}`} href="/admin" aria-current={section === "home" ? "page" : undefined} onClick={() => setRailOpen(false)}>
                  <Icon name="home" /><span>Home</span>
                </Link>
              </li>
              <li>
                <Link className={`nav-link${section === "companion" ? " is-active" : ""}`} href="/admin/companion/conversations" aria-current={section === "companion" ? "page" : undefined} onClick={() => setRailOpen(false)}>
                  <Icon name="sprout" /><span>Companion</span>
                </Link>
              </li>
            </ul>
            <div className="rail__group" style={{ marginTop: 16 }}>
              <div className="rail__group-label">Not yet in production</div>
              {["Members", "Care Studio", "Assessments", "Requests", "Content", "Insights"].map((label) => (
                <span key={label} className="nav-link is-disabled" aria-disabled="true"><Icon name="lock" size={18} /><span>{label}</span></span>
              ))}
            </div>
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
              <div className="who" style={{ padding: "2px 8px 2px 2px" }}>
                <span className="avatar">{initials}</span>
                <span className="who__text"><span className="who__name">{account?.first_name} {account?.last_name}</span><span className="who__role">Administrator</span></span>
              </div>
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
