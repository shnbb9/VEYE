import { PageSkeleton } from "@/components/skeleton";

/** Shown at once when a member screen takes a moment to arrive. */
export default function Loading() { return <PageSkeleton label="Loading…" />; }
