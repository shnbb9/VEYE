import type { Metadata } from "next";
import { PublicSourcePage } from "@/components/public-source";

export const metadata: Metadata = {
  title: "Help — Veye",
  description: "Browse Veye's current help topics and nutrition terminology.",
};

// Rendered per request: the FAQ comes from published console content.
export const dynamic = "force-dynamic";

export default function HelpPage() { return <PublicSourcePage page="help" />; }
