"use client";

import { Icon, PageHead, Subnav } from "@/components/admin/admin-chrome";
import { MEMBER_VIEWS } from "@/components/admin/member-views";
import { MemberTable, useMembers } from "@/components/admin/member-table";
import type { MemberTrend } from "@/lib/admin-console-api";

/* Member progress and trends (Cara, 25 Nov 2026): the change between each
   member's two latest Health Numbers. The cards count the members the other
   filters leave, and pressing one filters the list to it. */

const CARDS: { key: MemberTrend["state"]; label: string; icon: string; note: string }[] = [
  { key: "improved", label: "Improved", icon: "check-circle", note: "The latest number is lower" },
  { key: "unchanged", label: "No change", icon: "activity", note: "The latest two are the same" },
  { key: "worsened", label: "Increased (worse)", icon: "alert-circle", note: "The latest number is higher" },
];

export default function MemberTrendsPage() {
  const members = useMembers({ q: "", status: "any", onboarding: "any", active: "any", sharing: "any", trend: "any", archived: "exclude",
    sort: "trend", direction: "desc", page: 1, page_size: 25 });
  const { page, error, query, set } = members;
  const t = page?.trends;
  const unknown = t ? (t.first ?? 0) + (t.not_comparable ?? 0) + (t.none ?? 0) : null;

  return (
    <div className="page">
      <PageHead title="Member progress and trends" desc="How each member's Health Number changed between their two latest dated results."
                crumbs={[{ label: "Home", href: "/admin" }, { label: "Members", href: "/admin/members" }, { label: "Progress & trends" }]} />
      <Subnav items={MEMBER_VIEWS} active="trends" />
      {error && <p className="errorbar">{error}</p>}
      <div className="notice notice--quiet"><Icon name="info" size={18} /><div>On the Health Number <b>lower is better</b>. A trend describes that number only — it is not a medical conclusion. It shows only for members who share their health records, and only when both results were scored by the same version of the calculation.</div></div>

      <div className="kpis kpis--quad" data-testid="trend-cards" style={{ marginBlock: "var(--s-5)" }}>
        {CARDS.map((card) => (
          <button key={card.key} className="kpi kpi--button" type="button" aria-pressed={query.trend === card.key}
                  onClick={() => set({ trend: query.trend === card.key ? "any" : card.key })} data-testid={`trend-${card.key}`}>
            <span className="kpi__label"><Icon name={card.icon} size={16} /> {card.label}</span>
            <span className="kpi__value">{t ? t[card.key] ?? 0 : "—"}</span>
            <span className="kpi__note">{card.note}</span>
          </button>
        ))}
        <div className="kpi" data-testid="trend-unknown">
          <span className="kpi__label"><Icon name="users" size={16} /> No comparison</span>
          <span className="kpi__value">{unknown ?? "—"}</span>
          <span className="kpi__note">{t ? `${t.first ?? 0} with one result · ${t.none ?? 0} with none · ${t.not_shared ?? 0} more not shared` : ""}</span>
        </div>
      </div>

      <MemberTable {...members} trendsView />
    </div>
  );
}
