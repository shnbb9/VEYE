import type { Metadata } from "next";
import { PublicSourcePage } from "@/components/public-source";

export const metadata: Metadata = {
  title: "About Veye — Nutrition Reimagined",
  description: "Meet the people and purpose behind Veye.",
};

export default function AboutPage() { return <PublicSourcePage page="about" />; }
