"use client";

import { useEffect, useState } from "react";
import { AdvancedPage, Counts, TraceTable } from "@/components/admin/advanced-page";
import { Chip } from "@/components/admin/admin-chrome";
import { getAiMonitoring, type AiMonitoring } from "@/lib/admin-api";

export default function AiMonitoringPage() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<AiMonitoring | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    getAiMonitoring(days).then(setData).catch((reason) => setError(reason instanceof Error ? reason.message : "Monitoring could not be loaded."));
  }, [days]);

  return (
    <AdvancedPage active="ai-monitoring" title="AI Monitoring" desc="Every Sprout turn, as the masked telemetry record: pseudonymous member reference, provider and model, latency, tokens, policy decision, safety result, sources and feedback. Names, contact details and raw member text are never part of it.">
      {error && <p className="errorbar">{error}</p>}
      {data && (
        <div className="stackgap">
          <div className="card">
            <div className="card__head">
              <div><h2 className="card__title">Last {data.window_days} days</h2><p className="t-support">Environment {data.telemetry.environment} · exporters: {data.telemetry.exporters.join(", ")} · content capture {data.telemetry.capture_content ? "on (development)" : "off"} · Langfuse <Chip label={data.langfuse_status} tone={data.langfuse_status === "enabled" ? "live" : "archived"} /></p></div>
              <div className="modeswitch">
                {[7, 30, 90].map((n) => <button key={n} className="modeswitch__btn" type="button" aria-selected={days === n} onClick={() => setDays(n)}>{n} days</button>)}
              </div>
            </div>
            <div className="card__body">
              <div className="metric-row metric-row--wrap">
                <div className="metric"><div className="metric__body"><span className="metric__label">Sprout turns</span><span className="metric__value">{data.traces}</span></div></div>
                <div className="metric"><div className="metric__body"><span className="metric__label">Model answers</span><span className="metric__value">{data.answered}</span></div></div>
                <div className="metric"><div className="metric__body"><span className="metric__label">Average latency</span><span className="metric__value">{data.average_latency_ms != null ? `${data.average_latency_ms} ms` : "—"}</span></div></div>
                <div className="metric"><div className="metric__body"><span className="metric__label">p95 latency</span><span className="metric__value">{data.p95_latency_ms != null ? `${data.p95_latency_ms} ms` : "—"}</span></div></div>
                <div className="metric"><div className="metric__body"><span className="metric__label">Tokens in / out</span><span className="metric__value">{data.input_tokens} / {data.output_tokens}</span></div></div>
              </div>
              <dl className="kv" style={{ marginTop: "var(--s-5)" }}>
                <dt>By provider</dt><dd><Counts counts={data.by_provider} /></dd>
                <dt>By policy outcome</dt><dd><Counts counts={data.by_outcome} /></dd>
                <dt>Errors</dt><dd><Counts counts={data.by_error} empty="No errors" /></dd>
                <dt>Feedback</dt><dd><Counts counts={data.feedback} empty="No feedback yet" /></dd>
              </dl>
            </div>
          </div>
          <div className="card">
            <div className="card__head"><div><h2 className="card__title">Recent turns</h2><p className="t-support">Member ref is an HMAC pseudonym; it links turns by the same member without identifying them.</p></div></div>
            <div className="card__body card__body--flush"><TraceTable rows={data.recent} caption="Recent Sprout turns" /></div>
          </div>
        </div>
      )}
    </AdvancedPage>
  );
}
