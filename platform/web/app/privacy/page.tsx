import type { Metadata } from "next";
import { PublicSourcePage } from "@/components/public-source";

export const metadata: Metadata = { title: "Privacy Policy — Veye" };

export default function PrivacyPage() { return <PublicSourcePage page="privacy" />; }
