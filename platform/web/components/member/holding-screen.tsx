import { NavIcon } from "@/components/member/nav-icons";

/* A member section that has no production vertical slice yet, drawn exactly
   as the approved prototype draws it (build/dashboard.html, #view-mindfulness):
   the development-section card with its icon, "In Development" and the
   client-supplied status line, and nothing else. No future scope is
   described until the client defines it. (14 Nov 2026: the extra
   "not connected" paragraph and Back button were removed for 1:1 parity —
   the status line already says it honestly.) */
export function HoldingScreen({ title, icon }: { title: string; icon: string }) {
  return (
    <>
      <h1 className="fd-title">{title}</h1>
      <div className="mind-card" data-testid="holding-screen">
        <span className="mind-card__icon" aria-hidden="true"><NavIcon name={icon} /></span>
        <h2>In Development</h2>
        <p className="dev-more">Under development &mdash; more coming.</p>
      </div>
    </>
  );
}
