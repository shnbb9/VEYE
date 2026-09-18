import type { Metadata } from "next";
import { PublicSourcePage } from "@/components/public-source";

export const metadata: Metadata = { title: "Terms of Use — Veye" };

export default function TermsPage() { return <PublicSourcePage page="terms" />; }
