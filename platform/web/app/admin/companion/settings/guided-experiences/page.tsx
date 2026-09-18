"use client";

import { useEffect, useState } from "react";
import { Icon, PageHead, fmtDate } from "@/components/admin/admin-chrome";
import {
  activateGuidedFlow, deactivateGuidedFlow, getGuidedFlow, listGuidedFlows,
  type GuidedFlowDefinition, type GuidedFlowDetail, type GuidedFlowGroup, type GuidedFlowVersion,
} from "@/lib/admin-api";

/* Companion → Settings → Guided Experiences: the guided flows Sprout runs
   (Cara's decision trees), each version's status and source, member session
   counts, safe activate / deactivate, and a read-only step-by-step preview.
   There is no raw JSON editing here on purpose: a revision is published from
   the client document as a new version and reviewed on this page. */

const ACTION_LABEL: Record<string, string> = {
  OPEN_DASHBOARD: "Opens the Dashboard", OPEN_PROGRESS: "Opens My Progress", OPEN_FOOD_CHOICES: "Opens Food Choices",
  OPEN_MEAL_PLANNING: "Opens Meal Planning", OPEN_COMPANION: "Opens Sprout", OPEN_TRACKER: "Opens the tracker", START_FLOW: "Starts the guided experience",
};
const TRACKER_LABEL: Record<string, string> = { blood_markers: "Blood Test Markers", body_composition: "BMI Analysis", health_assessment: "Health Assessment", simple_quiz: "Simple Quiz" };
const STATE_LABEL: Record<string, string> = {
  has_blood_markers: "the member has saved Blood Test Markers", has_body_composition: "the member has a saved BMI analysis",
  has_health_number: "the member has a Health Number", has_health_assessment: "the member has completed the Health Assessment",
  has_simple_quiz: "the member has taken the Simple Quiz", has_food_choices: "the member has filled in Food Choices",
  blood_markers_available: "Blood Test Markers is connected", body_composition_available: "BMI Analysis is connected",
  health_assessment_available: "the Health Assessment is connected", simple_quiz_available: "the Simple Quiz is connected", food_choices_available: "Food Choices is connected",
};

export default function GuidedExperiencesPage() {
  const [groups, setGroups] = useState<GuidedFlowGroup[] | null>(null);
  const [detail, setDetail] = useState<GuidedFlowDetail | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [showDetails, setShowDetails] = useState(false);

  const load = () => listGuidedFlows().then(setGroups).catch((reason) => setError(reason instanceof Error ? reason.message : "Guided experiences could not be loaded."));
  useEffect(() => { void load(); }, []);

  async function transition(version: GuidedFlowVersion, action: "activate" | "deactivate") {
    setBusy(version.id); setError("");
    try {
      await (action === "activate" ? activateGuidedFlow(version.id) : deactivateGuidedFlow(version.id));
      await load();
      if (detail?.flow.id === version.id) setDetail(await getGuidedFlow(version.id));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The change could not be saved."); }
    finally { setBusy(""); }
  }

  async function preview(version: GuidedFlowVersion) {
    setBusy(version.id); setError("");
    try { setDetail(await getGuidedFlow(version.id)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "The preview could not be loaded."); }
    finally { setBusy(""); }
  }

  return (
    <div className="page">
      <PageHead title="Guided Experiences"
                desc="The step-by-step experiences Sprout can walk a member through. Each one is Cara's decision tree, published as a numbered version; members who started a version keep it until they finish."
                crumbs={[{ label: "Home", href: "/admin" }, { label: "Companion", href: "/admin/companion/conversations" }, { label: "Settings", href: "/admin/companion/settings" }, { label: "Guided Experiences" }]} />
      {error && <p className="errorbar">{error}</p>}
      {!groups && !error && <p className="loading-row">Loading…</p>}
      {groups && groups.length === 0 && <p className="loading-row">No guided experiences have been published yet.</p>}

      <div className="stack gap-5">
        {groups?.map((group) => (
          <div key={group.key} className="card">
            <div className="card__head">
              <div>
                <h2 className="card__title">{group.title}</h2>
                <p className="t-support">{group.active_version ? `Version ${group.active_version} is what members get today.` : "No active version — members cannot start this experience."}</p>
              </div>
              <span className={`tag${group.active_version ? " tag--ok" : ""}`}>{group.active_version ? "Active" : "Inactive"}</span>
            </div>
            <div className="card__body card__body--flush">
              <div className="table-wrap">
                <table className="table table--compact">
                  <caption className="sr-only">Versions of {group.title}</caption>
                  <thead><tr><th>Version</th><th>Status</th><th>Source</th><th>Review</th><th>Steps</th><th>Members</th><th>Last updated</th><th>Published</th><th className="t-right">Actions</th></tr></thead>
                  <tbody>
                    {group.versions.map((version) => (
                      <tr key={version.id}>
                        <td className="t-num">v{version.version}</td>
                        <td><span className={`tag${version.status === "Active" ? " tag--ok" : version.status === "Archived" ? " tag--muted" : ""}`}>{version.status}</span></td>
                        <td>{String(version.content_meta.source ?? version.source ?? "—")}{version.content_meta.source_version ? <span className="t-support"> · {String(version.content_meta.source_version)}</span> : null}</td>
                        <td>{version.content_meta.client_supplied ? `Client-supplied · clinical review ${String(version.content_meta.clinical_review_status ?? "pending")}` : "—"}</td>
                        <td className="t-num">{version.node_count}</td>
                        <td className="t-num">{version.sessions_total}{version.sessions_total ? <span className="t-support"> ({version.sessions_in_progress} in progress · {version.sessions_completed} completed)</span> : null}</td>
                        <td className="t-nowrap">{fmtDate(version.updated_at)}</td>
                        <td className="t-nowrap">{version.published_at ? `${fmtDate(version.published_at)}${version.published_by ? ` · ${version.published_by}` : ""}` : "—"}</td>
                        <td className="t-right">
                          <div className="row gap-2" style={{ justifyContent: "flex-end" }}>
                            <button className="btn btn--secondary btn--sm" type="button" disabled={busy === version.id} onClick={() => void preview(version)}><Icon name="eye" size={16} /> Preview</button>
                            {version.status === "Draft" && <button className="btn btn--primary btn--sm" type="button" disabled={busy === version.id} onClick={() => void transition(version, "activate")}>Activate</button>}
                            {version.status === "Active" && <button className="btn btn--ghost btn--sm" type="button" disabled={busy === version.id} onClick={() => void transition(version, "deactivate")}>Deactivate</button>}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ))}

        {detail && (
          <div className="card" id="flowPreview">
            <div className="card__head">
              <div>
                <h2 className="card__title">Preview — {detail.flow.title} v{detail.flow.version}</h2>
                <p className="t-support">{detail.definition.description}</p>
                <p className="t-support">Definition check: <b>{detail.validation === "valid" ? "valid — every option leads to a defined step and every path can finish" : detail.validation}</b>. {String(detail.definition.content_meta?.note ?? "")}</p>
              </div>
              <div className="row gap-2">
                <label className="check"><input type="checkbox" checked={showDetails} onChange={(e) => setShowDetails(e.target.checked)} /><span className="check__text">Show technical details</span></label>
                <button className="btn btn--ghost btn--sm" type="button" onClick={() => setDetail(null)}>Close preview</button>
              </div>
            </div>
            <div className="card__body">
              <FlowPreview definition={detail.definition} showDetails={showDetails} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function describeTarget(definition: GuidedFlowDefinition, nodeId: string): string {
  const node = definition.nodes[nodeId];
  if (!node) return nodeId;
  const text = node.type === "CHECK_MEMBER_STATE" ? `check whether ${STATE_LABEL[node.check?.state ?? ""] ?? node.check?.state}` : node.text;
  return `${text.length > 90 ? text.slice(0, 87) + "…" : text}`;
}

function FlowPreview({ definition, showDetails }: { definition: GuidedFlowDefinition; showDetails: boolean }) {
  const sections = definition.sections ?? [];
  const order = Object.keys(definition.nodes);
  return (
    <div className="stack gap-5">
      {sections.map((section) => {
        const ids = order.filter((id) => definition.nodes[id].section === section.key);
        return (
          <section key={section.key} className="flow-section">
            <h3 className="card__title" style={{ fontSize: 16, marginBottom: 6 }}>{section.title}{section.kind === "ai" ? <span className="tag" style={{ marginLeft: 8 }}>AI — not yet specified</span> : null}</h3>
            <ol className="flow-steps" style={{ margin: 0, paddingLeft: 20 }}>
              {ids.map((id) => {
                const node = definition.nodes[id];
                return (
                  <li key={id} style={{ marginBottom: 10 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                      <span className={`tag${node.type === "NAVIGATION" ? " tag--ok" : ""}`}>{labelForType(node.type)}</span>
                      {node.copy_origin && node.copy_origin !== "client" && <span className="tag tag--muted">{node.copy_origin === "derived" ? "Veye wording — to confirm" : "Cara's wording, paraphrased"}</span>}
                      {showDetails && <span className="t-support mono">{id}{node.source_ref ? ` · ${node.source_ref}` : ""}</span>}
                    </div>
                    {node.type === "CHECK_MEMBER_STATE" ? (
                      <p style={{ margin: "4px 0" }}>If {STATE_LABEL[node.check?.state ?? ""] ?? node.check?.state}: <b>→ {describeTarget(definition, node.check?.if_true ?? "")}</b>; otherwise <b>→ {describeTarget(definition, node.check?.if_false ?? "")}</b>{node.note ? <span className="t-support"> — {node.note}</span> : null}</p>
                    ) : (
                      <p style={{ margin: "4px 0" }}>{node.text}</p>
                    )}
                    {node.action && (
                      <p className="t-support" style={{ margin: "2px 0" }}>
                        <Icon name="chevron-right" size={14} /> {ACTION_LABEL[node.action.type] ?? node.action.type}{node.action.target ? `: ${TRACKER_LABEL[node.action.target] ?? node.action.target}` : ""}
                      </p>
                    )}
                    {node.choices && node.choices.length > 0 && (
                      <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                        {node.choices.map((choice) => (
                          <li key={choice.key} className="t-support"><b>{choice.label}</b> → {describeTarget(definition, choice.next)}{showDetails ? <span className="mono"> ({choice.next})</span> : null}</li>
                        ))}
                      </ul>
                    )}
                    {node.type === "QUESTION" && <p className="t-support" style={{ margin: "2px 0" }}>Any reply continues → {describeTarget(definition, node.next ?? "")}</p>}
                    {(node.type === "MESSAGE" || node.type === "NAVIGATION") && node.next && <p className="t-support" style={{ margin: "2px 0" }}>{node.pause ? "Then the guide pauses; it resumes at" : "Then"} → {describeTarget(definition, node.next)}</p>}
                  </li>
                );
              })}
            </ol>
          </section>
        );
      })}
    </div>
  );
}

function labelForType(type: string): string {
  switch (type) {
    case "CHOICE": return "Question";
    case "QUESTION": return "Tip — any reply continues";
    case "MESSAGE": return "Sprout says";
    case "NAVIGATION": return "Takes the member to";
    case "CHECK_MEMBER_STATE": return "Checks";
    case "AI_TASK": return "AI (not built yet)";
    case "COMPLETE": return "Finish";
    case "KNOWLEDGE": return "Approved knowledge";
    default: return type;
  }
}
