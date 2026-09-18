"use client";

import type { ReactNode } from "react";
import { COMPANION_NAV, PageHead, Subnav } from "@/components/admin/admin-chrome";

/* Companion page frame: title, description, the four-section subnav. */
export function CompanionPage({ active, desc, actions, children, count }: {
  active: (typeof COMPANION_NAV)[number]["key"]; desc?: ReactNode; actions?: ReactNode; children: ReactNode; count?: number;
}) {
  return (
    <div className="page">
      <PageHead title="Companion" desc={desc ?? "Sprout is the companion members talk to inside Veye. It answers from approved Veye knowledge and short summaries of the member's own results."}
                crumbs={[{ label: "Home", href: "/admin" }, { label: "Companion" }]} actions={actions} />
      <Subnav items={COMPANION_NAV.map((item) => (item.key === "conversations" ? { ...item, count } : item))} active={active} />
      {children}
    </div>
  );
}
