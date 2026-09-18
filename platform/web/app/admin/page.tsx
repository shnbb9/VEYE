"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Chip, Icon, PageHead } from "@/components/admin/admin-chrome";
import { useSession } from "@/components/session";
import { getOverview, type Overview } from "@/lib/admin-api";

export default function AdminHome() {
  const account = useSession().account;
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    getOverview().then(setOverview).catch((reason) => setError(reason instanceof Error ? reason.message : "The overview could not be loaded."));
  }, []);

  return (
    <div className="page">
      <PageHead title={`Good day, ${account?.first_name ?? ""}`} desc="Companion is the first production area of the console. Members, care, assessments, requests, content and insights remain in the client prototype until their own releases." />
      {error && <p className="errorbar">{error}</p>}
      <div className="grid grid--2">
        <div className="card">
          <div className="card__head"><div><h2 className="card__title"><Icon name="sprout" /> Companion</h2><p className="t-support">What Sprout has been saying, and what it may say.</p></div></div>
          <div className="card__body">
            {overview ? (
              <dl className="kv">
                <dt>Conversations</dt><dd>{overview.conversations_total} · <b>{overview.conversations_needing_review}</b> waiting for review</dd>
                <dt>Member feedback</dt><dd>{overview.feedback_total} · <b>{overview.feedback_unreviewed}</b> unreviewed</dd>
                <dt>Knowledge sources</dt><dd>{overview.knowledge_sources_active} retrievable of {overview.knowledge_sources_total}</dd>
                <dt>Last 7 days</dt><dd>{overview.traces_last_7_days} Sprout turns · {overview.escalations_last_7_days} handed to a person</dd>
                <dt>Language model</dt><dd>{overview.llm_provider}{overview.llm_model ? ` · ${overview.llm_model}` : ""}</dd>
                <dt>Langfuse</dt><dd><Chip label={overview.langfuse_status} tone={overview.langfuse_status === "enabled" ? "live" : "archived"} /></dd>
              </dl>
            ) : !error && <p className="loading-row">Loading…</p>}
          </div>
          <div className="card__foot">
            <Link className="btn btn--primary btn--sm" href="/admin/companion/conversations">Open Conversations</Link>
            <Link className="btn btn--ghost btn--sm" href="/admin/companion/settings/advanced/ai-monitoring">Advanced monitoring <Icon name="chevron-right" size={16} /></Link>
          </div>
        </div>
        <div className="card">
          <div className="card__head"><div><h2 className="card__title"><Icon name="info" /> This environment</h2></div></div>
          <div className="card__body stack gap-3">
            <p className="t-support">Every member and conversation here is synthetic local demonstration data. No real member information is stored, and nothing leaves this machine except by explicit development configuration.</p>
            <p className="t-support">Production decisions that remain with Veye — identity provider, email sender, object storage, language-model and embedding providers, retention and escalation ownership — are listed in <span className="mono">platform/docs/COMPANION_CLIENT_DECISIONS.md</span>.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
