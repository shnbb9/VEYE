"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Icon, PageHead, Subnav } from "@/components/admin/admin-chrome";

/* Finance — the Phase 2 placeholder Cara approved on 25 Nov 2026: one sidebar
   item, two tabs, her layout. Nothing is connected, so nothing has a figure:
   a dash means "not measured", never zero. The illustrative figures live in
   the published demo only, under its permanent label. */

const TABS = [
  { key: "revenue", label: "Revenue", href: "/admin/finance" },
  { key: "plans", label: "Plans & Members", href: "/admin/finance?tab=plans" },
] as const;
const PERIODS = ["Day", "Week", "Month", "Quarter", "Year"] as const;
const PLANS = ["Digital", "Digital+", "Premium"] as const;

export default function FinancePage() {
  return <Suspense fallback={<div className="page"><p className="loading-row">Loading…</p></div>}><Finance /></Suspense>;
}

function Finance() {
  const tab = useSearchParams().get("tab") === "plans" ? "plans" : "revenue";
  return (
    <div className="page">
      <PageHead title="Finance" desc="A future home for subscriptions, revenue and plan movement." crumbs={[{ label: "Home", href: "/admin" }, { label: "Finance" }]}
                actions={<span className="chip chip--attention" data-testid="finance-phase">Planned for Phase 2</span>} />
      <Subnav items={TABS} active={tab} />
      <div className="notice" data-testid="finance-notice"><Icon name="info" size={18} /><div><b>Coming later.</b> Members join Veye without paying today. No prices, plans or payments are connected, so every figure here is empty — a dash means it is not measured yet, not zero.</div></div>
      {tab === "revenue" ? <Revenue /> : <Plans />}
    </div>
  );
}

function Empty({ label, note, icon }: { label: string; note: string; icon: string }) {
  return (
    <div className="kpi">
      <span className="kpi__label"><Icon name={icon} size={16} /> {label}</span>
      <span className="kpi__value" aria-label="Not measured yet">—</span>
      <span className="kpi__note">{note}</span>
    </div>
  );
}

function Pending({ title, desc, children }: { title: string; desc: string; children?: React.ReactNode }) {
  return (
    <div className="card">
      <div className="card__head"><div><h2 className="card__title">{title}</h2><p className="t-support">{desc}</p></div></div>
      <div className="card__body">{children ?? <p className="finance-empty">Appears when billing is connected.</p>}</div>
    </div>
  );
}

function Revenue() {
  const [period, setPeriod] = useState<(typeof PERIODS)[number]>("Month");
  return (
    <div data-testid="finance-revenue">
      <div className="kpis kpis--quad" style={{ marginTop: "var(--s-5)" }}>
        <Empty label="Total revenue" note="Billing not connected" icon="bar-chart" />
        <Empty label="Change on the period before" note="Compared with the previous equal period" icon="activity" />
        <Empty label="Paying members" note="Plans not active" icon="users" />
        <Empty label="Refunds and adjustments" note="Not yet tracked" icon="list" />
      </div>
      <div className="grid grid--main-side" style={{ marginTop: "var(--s-5)" }}>
        <div className="card">
          <div className="card__head"><div><h2 className="card__title">Revenue over time</h2><p className="t-support">Each {period.toLowerCase()} compared with the {period.toLowerCase()} before.</p></div>
            <div className="modeswitch" role="tablist" aria-label="Period">
              {PERIODS.map((item) => <button key={item} className="modeswitch__btn" type="button" role="tab" aria-selected={period === item} onClick={() => setPeriod(item)}>{item}</button>)}
            </div></div>
          <div className="card__body"><div className="finance-chart" role="img" aria-label="No billing data connected"><span><b>No billing data connected</b><br />Revenue by {period.toLowerCase()} will appear here.</span></div></div>
        </div>
        <Pending title="When Finance goes live" desc="What this page will answer.">
          <dl className="kv">
            {["Period-over-period change", "New paying members", "Upgrades and downgrades", "Average time on a plan", "Cancellations"].map((item) => <span key={item} style={{ display: "contents" }}><dt>{item}</dt><dd className="t-muted">Not available</dd></span>)}
          </dl>
        </Pending>
      </div>
      <div className="grid grid--2" style={{ marginTop: "var(--s-5)" }}>
        <Pending title="Revenue by plan" desc="The share each plan brings in." />
        <Pending title="Billing exceptions" desc="Failed payments, refunds and overdue invoices." />
        <Pending title="Recent billing activity" desc="The latest payments and changes." />
        <Pending title="Monthly revenue by plan" desc="How the mix changes over time." />
      </div>
    </div>
  );
}

function Plans() {
  return (
    <div data-testid="finance-plans">
      <div className="kpis kpis--quad" style={{ marginTop: "var(--s-5)" }}>
        <Empty label="Active paid members" note="Plans not active" icon="users" />
        {PLANS.map((plan) => <Empty key={plan} label={plan} note="Price and features to be confirmed" icon="heart" />)}
      </div>
      <div className="grid grid--2" style={{ marginTop: "var(--s-5)" }}>
        <Pending title="Plan distribution" desc="Active paid members by plan." />
        <Pending title="Plan movement" desc="Members who moved up or down between plans." />
        <Pending title="Typical time in a plan" desc="How long members stay in each plan." />
        <Pending title="Members by plan" desc="Each paid member and their current plan." />
      </div>
    </div>
  );
}
