import type { Insights } from "@/lib/admin-console-api";

/* Overall member retention and how long members stay (Cara, 25 Nov 2026).
   Every figure carries its definition, and one that cannot be measured yet
   says so instead of showing a percentage. Program retention, correlations
   and the chart builder are Phase 2. */

const day = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
const share = (part: number, whole: number) => `${Math.round((part / whole) * 100)}%`;

export function RetentionSection({ data }: { data: Insights }) {
  const r = data.retention;
  const g = data.getting_started;
  const tallest = Math.max(1, ...r.engagement.map((b) => b.members));
  const steps = [["Joined", g.joined], ["Verified their email", g.verified], ["Took the Health Number quiz", g.onboarding_complete], ["Chose foods", g.food_choices_started]] as const;

  return (
    <section data-testid="retention" aria-labelledby="retentionTitle" style={{ marginTop: "var(--s-6)" }}>
      <h2 className="card__title" id="retentionTitle">Retention</h2>
      <p className="t-support">
        {r.recorded_since
          ? `Visits have been recorded since ${day(r.recorded_since)}. Nothing before that date is known, and nothing is inferred${r.not_measured ? ` — ${r.not_measured} member${r.not_measured === 1 ? "" : "s"} who joined earlier ${r.not_measured === 1 ? "is" : "are"} left out of the return and length figures` : ""}.`
          : "No visit has been recorded yet, so nothing can be measured."}
      </p>
      <div className="kpis kpis--quad" style={{ marginTop: "var(--s-4)" }}>
        <div className="kpi"><span className="kpi__label">Joined</span><span className="kpi__value">{r.joined_last_30_days}</span><span className="kpi__note">in the last 30 days, of {r.members} members</span></div>
        <div className="kpi"><span className="kpi__label">Active</span><span className="kpi__value" data-testid="retention-active">{r.recorded_since ? r.active_last_30_days : "—"}</span><span className="kpi__note">opened Veye in the last 30 days{r.recorded_since ? ` · ${r.active_last_7_days} in the last 7` : ""}</span></div>
        {r.returned.map((rate) => (
          <div className="kpi" key={rate.days} data-testid={`retention-return-${rate.days}`}>
            <span className="kpi__label">Came back within {rate.days} days</span>
            <span className="kpi__value">{rate.eligible ? share(rate.returned, rate.eligible) : "—"}</span>
            <span className="kpi__note">{rate.eligible ? `${rate.returned} of ${rate.eligible} who joined at least ${rate.days} days ago opened it again on a later day` : `Not enough time yet: nobody measured joined ${rate.days} days ago`}</span>
          </div>
        ))}
      </div>

      <div className="grid grid--2" style={{ marginTop: "var(--s-5)" }}>
        <div className="card">
          <div className="card__head"><div><h3 className="card__title">How long members stay</h3>
            <p className="t-support">Days from joining to the last day a member opened Veye, for members who joined at least {r.engagement_judged_after_days} days ago.</p></div></div>
          <div className="card__body">
            {r.engagement_members === 0 ? <p className="finance-empty" data-testid="engagement-empty">Not enough data yet. This fills in {r.engagement_judged_after_days} days after the first measured member joined.</p> : (
              <>
                <ul className="histogram" aria-label={`How long ${r.engagement_members} members stayed`} data-testid="engagement">
                  {r.engagement.map((b) => (
                    <li key={b.label}>
                      <span className="histogram__n">{b.members}</span>
                      <span className="histogram__bar" style={{ height: `${Math.max(b.members ? 6 : 0, Math.round((b.members / tallest) * 100))}%` }} aria-hidden="true" />
                      <span className="histogram__label">{b.label}</span>
                    </li>
                  ))}
                </ul>
                <p className="t-support" style={{ marginTop: "var(--s-3)" }}>{r.engagement_members} member{r.engagement_members === 1 ? "" : "s"} · half stayed {r.engagement_median_days} day{r.engagement_median_days === 1 ? "" : "s"} or longer.</p>
              </>
            )}
            <p className="t-support" style={{ marginTop: "var(--s-3)" }}>Inactive: {r.inactive === null ? "not measurable until 30 days have been recorded" : `${r.inactive} member${r.inactive === 1 ? " has" : "s have"} not opened Veye in the last 30 days`}.</p>
          </div>
        </div>
        <div className="card" data-testid="getting-started">
          <div className="card__head"><div><h3 className="card__title">Getting started</h3><p className="t-support">How far members have got after joining, and where they stopped.</p></div></div>
          <div className="card__body">
            <div className="bars bars--wide">
              {steps.map(([label, count]) => (
                <div className="bar" key={label}>
                  <span className="bar__label">{label}</span>
                  <span className="bar__track"><span className="bar__fill bar__fill--deep" style={{ width: g.joined ? share(count, g.joined) : "0%" }} /></span>
                  <span className="bar__n">{count}<span className="t-muted"> · {Math.max(0, g.joined - count)} not yet</span></span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
