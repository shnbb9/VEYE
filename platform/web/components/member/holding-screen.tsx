import Link from "next/link";
import { NavIcon } from "@/components/member/nav-icons";

/* A member section that has no production vertical slice yet. Uses the
   prototype's own development-section card (.mind-card / .dev-more) so the
   screen belongs to the product, and states the real status without
   describing scope the client has not defined. */
export function HoldingScreen({
  title, icon, backHref, backLabel,
}: {
  title: string;
  icon: string;
  backHref?: string;
  backLabel?: string;
}) {
  return (
    <>
      <h1 className="fd-title">{title}</h1>
      <div className="mind-card hold-card fade-in d1">
        <span className="mind-card__icon" aria-hidden="true"><NavIcon name={icon} /></span>
        <h2>In Development</h2>
        <p className="dev-more">Under development &mdash; more coming.</p>
        <p className="dev-note">
          {title} is not connected in the Veye application yet. Your Health Number, Body Composition and
          Blood Test Markers are live in My Progress; this section arrives with its own release.
        </p>
        <div className="hold-actions">
          <Link className="btn-primary" href={backHref ?? "/app"}>{backLabel ?? "Back to Dashboard"}</Link>
        </div>
      </div>
    </>
  );
}
