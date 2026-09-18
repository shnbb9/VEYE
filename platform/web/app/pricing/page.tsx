import type { Metadata } from "next";
import { PublicSourcePage } from "@/components/public-source";

export const metadata: Metadata = {
  title: "Pricing — Veye",
  description: "Explore the current Veye beta and membership duration options.",
};

export default function PricingPage() { return <PublicSourcePage page="pricing" />; }
