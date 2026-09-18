import type { Metadata } from "next";
import { PublicSourcePage } from "@/components/public-source";

export const metadata: Metadata = {
  title: "Help — Veye",
  description: "Browse Veye's current help topics and nutrition terminology.",
};

export default function HelpPage() { return <PublicSourcePage page="help" />; }
