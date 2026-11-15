"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment, createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { MemberAvatar } from "@/components/member/member-avatar";
import { MEMBER_NAV, activeNavKey, type NavKey } from "@/components/member/member-nav";
import { NavIcon } from "@/components/member/nav-icons";
import { RequirePortal, useSession } from "@/components/session";

/* Member application chrome, ported from the approved consumer prototype
   (build/dashboard.html): the 22px green strip, the white sidebar (208px of
   content plus a 6px scrollbar gutter, since 15 Nov 2026) with its traced
   icon rail, and the cream main canvas with the white action pill.
   The stylesheet is the prototype's own <style> block copied verbatim to
   /member-css/dashboard.css, so every class name below is the prototype's. */

const MEMBER_FONTS =
  "https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500;1,600;1,700&family=Nunito+Sans:wght@300;400;500;600;700;800;900&family=DM+Mono:wght@400;500&family=Kumbh+Sans:wght@200;300;400;500;600;700&family=Teachers:wght@400;500;600&display=swap";

type ToastApi = { message: string; flash: (message: string) => void };
const ToastContext = createContext<ToastApi | null>(null);

function useToastState(): ToastApi {
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(""), 1800);
    return () => clearTimeout(timer);
  }, [message]);
  return { message, flash: setMessage };
}

/** The frame's toast. Pages flash messages into the one toast the member
 *  chrome renders; outside the chrome the hook falls back to local state. */
export function useToast(): ToastApi {
  const shared = useContext(ToastContext);
  const local = useToastState();
  return shared ?? local;
}

function Toast({ message }: { message: string }) {
  return (
    <div
      id="veyeToast"
      role="status"
      aria-live="polite"
      style={{
        position: "fixed", bottom: 24, right: 24, background: "var(--brand-green)", color: "white",
        padding: "10px 18px", borderRadius: 8, fontFamily: "Nunito Sans, sans-serif", fontSize: 13,
        fontWeight: 700, boxShadow: "0 10px 24px rgba(141,196,18,0.36)", zIndex: 300,
        opacity: message ? 1 : 0, transition: "opacity .25s ease", pointerEvents: "none",
      }}
    >
      {message}
    </div>
  );
}

export function MemberChrome({ children }: { children: ReactNode }) {
  return (
    <RequirePortal portal="member" fallback={<SigningIn />}>
      <MemberFrame>{children}</MemberFrame>
    </RequirePortal>
  );
}

function SigningIn() {
  return (
    <>
      <link rel="stylesheet" href="/member-css/dashboard.css" />
      <div className="top-strip" />
      <p style={{ fontFamily: "Nunito Sans, sans-serif", color: "var(--body-text-light)", padding: "40px 32px" }}>Opening your dashboard…</p>
    </>
  );
}

function MemberFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  // The prototype keeps the sidebar on the screen the member came from: the
  // Health Number opened from the dashboard leaves Dashboard highlighted
  // (openSubView never moves the active link). Read from the address after
  // each navigation, so no search-param hook holds up the frame.
  const [fromDashboard, setFromDashboard] = useState(false);
  useEffect(() => {
    setFromDashboard(new URLSearchParams(window.location.search).get("from") === "dashboard");
  }, [pathname]);
  const active: NavKey | null = pathname === "/app/progress/health-number" && fromDashboard ? "dashboard" : activeNavKey(pathname);
  const toast = useToastState();
  const session = useSession();

  async function logOut() {
    // End the MEMBER session on the server, then a full navigation to the
    // site: the next page asks the API afresh, so the guard never races.
    await session.signOut("member", "/");
  }

  return (
    <ToastContext.Provider value={toast}>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link href={MEMBER_FONTS} rel="stylesheet" />
      <link rel="stylesheet" href="/member-css/dashboard.css" />
      <link rel="stylesheet" href="/member-css/member.css" />

      <div className="top-strip" />

      <div className="app">
        <aside className="sidebar">
          <Link href="/" className="sidebar-logo" title="Back to site">
            <img src="/VeyeLogo.png" alt="Veye" className="sidebar-logo-img" />
          </Link>

          <nav className="sidebar-nav">
            {MEMBER_NAV.map((item) => (
              <Fragment key={item.key}>
                {item.separatorBefore && <div className="nav-sep" role="separator" aria-orientation="horizontal" />}
                <NavLink item={item} active={active === item.key} />
              </Fragment>
            ))}
          </nav>

          <div className="sidebar-bottom">
            <Link href="/app/settings" className={`nav-link${active === "settings" ? " active" : ""}`} aria-label="Settings" aria-current={active === "settings" ? "page" : undefined}>
              <NavIcon name="settings" />
              <span>Settings</span>
            </Link>
            <button type="button" className="nav-link logout" aria-label="Log out" onClick={() => void logOut()}>
              <NavIcon name="logout" />
              <span>Log out</span>
            </button>
          </div>
        </aside>

        <main className="main">
          <header className="topbar">
            <div className="topbar-actions">
              <button className="icon-btn" aria-label="Notifications" type="button" onClick={() => toast.flash("Notifications are not connected yet — nothing is waiting for you")}>
                <NavIcon name="bell" />
                <span className="badge-dot" />
              </button>
              <Link className="icon-btn" href="/app/companion" aria-label="Open Veye Companion chat">
                <NavIcon name="chat" />
              </Link>
              <Link className="icon-btn" href="/app/settings" aria-label="Settings">
                <NavIcon name="settings" />
              </Link>
              <Link className="avatar avatar-button avatar-link" href="/app/settings" aria-label="Open profile settings">
                {session.member && <MemberAvatar account={session.member} className="avatar-face" size="small" testId="topbar-avatar" />}
              </Link>
            </div>
          </header>

          <section className="content">
            {/* The prototype's one view-specific compound rule is
                `.view.view-bot.active` (the Companion fills the content area so
                the chat fits without page scroll); the wrapper carries
                view-bot there so that rule applies. */}
            <div className={`view active${pathname?.startsWith("/app/companion") ? " view-bot" : ""}`}>{children}</div>
          </section>
        </main>
      </div>
      <Toast message={toast.message} />
    </ToastContext.Provider>
  );
}

function NavLink({ item, active }: { item: (typeof MEMBER_NAV)[number]; active: boolean }) {
  return (
    <Link href={item.href} className={`nav-link${active ? " active" : ""}`} aria-label={item.label} aria-current={active ? "page" : undefined}>
      <NavIcon name={item.key} />
      <span>{item.label}</span>
    </Link>
  );
}
