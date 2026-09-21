import Link from "next/link";
import { NavIcon } from "@/components/member/nav-icons";

/* A member section that has no production vertical slice yet. Uses the
   prototype's own development-section card (.mind-card / .dev-more) so the
   screen belongs to the product, and states the real status — including
   what the client still needs to decide — without describing scope the
   client has not defined. */
export function HoldingScreen({
  title, icon, reason, backHref, backLabel,
}: {
  title: string;
  icon: string;
  /** What is genuinely missing before this section can be built. */
  reason?: string;
  backHref?: string;
  backLabel?: string;
}) {
  return (
    <>
      <h1 className="fd-title">{title}</h1>
      <div className="mind-card hold-card fade-in d1" data-testid="holding-screen">
        <span className="mind-card__icon" aria-hidden="true"><NavIcon name={icon} /></span>
        <h2>In Development</h2>
        <p className="dev-more">Under development &mdash; more coming.</p>
        <p className="dev-note">
          {title} is not connected in the Veye application yet.{" "}
          {reason ?? "This section arrives with its own release."}{" "}
          Your Health Number, Body Composition, Blood Test Markers, Health Assessment and Simple Quiz are live in My Progress,
          and the Mood Tracker and Food Diary save to your account today.
        </p>
        <div className="hold-actions">
          <Link className="btn-primary" href={backHref ?? "/app"}>{backLabel ?? "Back to Dashboard"}</Link>
        </div>
      </div>
    </>
  );
}
