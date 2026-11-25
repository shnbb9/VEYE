/* Placeholders in the shape of what is coming, so nothing jumps or flashes
   when it arrives. Decorative: one status line is what assistive technology
   hears, and reduced motion stops the shimmer (globals.css). */

function Bars({ count }: { count: number }) {
  return <>{Array.from({ length: count }, (_, i) => <span key={i} className="skel skel--bar" style={{ width: `${92 - (i % 4) * 14}%` }} />)}</>;
}

export function ConsoleSkeleton() {
  return (
    <div className="skel-console" role="status">
      <span className="sr-status">Opening the console…</span>
      <div className="skel-console__rail" aria-hidden="true"><Bars count={10} /></div>
      <div className="skel-console__main" aria-hidden="true"><PageBlocks /></div>
    </div>
  );
}

export function MemberSkeleton() {
  return (
    <div className="skel-member" role="status">
      <span className="sr-status">Opening your dashboard…</span>
      <div className="skel-member__strip" aria-hidden="true" />
      <div className="skel-member__side" aria-hidden="true"><Bars count={9} /></div>
      <div className="skel-member__main" aria-hidden="true"><PageBlocks /></div>
    </div>
  );
}

function PageBlocks() {
  return (
    <>
      <span className="skel skel--title" />
      <div className="skel-grid">{[0, 1, 2, 3].map((i) => <span key={i} className="skel skel--tile" />)}</div>
      <span className="skel skel--block" />
      <span className="skel skel--block" />
    </>
  );
}

/** One screen's content, inside a frame that is already there. */
export function PageSkeleton({ label }: { label: string }) {
  return <div className="skel-page" role="status"><span className="sr-status">{label}</span><div aria-hidden="true"><PageBlocks /></div></div>;
}

export function CardsSkeleton({ count, label }: { count: number; label: string }) {
  return (
    <div className="skel-cards" role="status">
      <span className="sr-status">{label}</span>
      {Array.from({ length: count }, (_, i) => <span key={i} className="skel skel--card" aria-hidden="true" />)}
    </div>
  );
}
