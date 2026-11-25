import { PageSkeleton } from "@/components/skeleton";

/** Shown at once when a console screen takes a moment to arrive. */
export default function Loading() { return <div className="page"><PageSkeleton label="Loading…" /></div>; }
