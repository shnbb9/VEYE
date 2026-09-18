import type { Metadata } from "next";
import { PublicSourcePage } from "@/components/public-source";

export const metadata: Metadata = {
  title: "Why Veye — Nutrition Reimagined",
  description: "See Veye's food-as-medicine approach, experience and long-term health focus.",
};

export default function WhyVeyePage() { return <PublicSourcePage page="why" />; }
