"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  calculateBloodMarkers,
  getBloodMarkersHistory,
  previewBloodMarkers,
  type BloodMarkerKey,
  type BloodMarkersHistory,
  type BloodMarkersHistoryItem,
  type BloodMarkersInput,
  type BloodMarkersPreview,
} from "@/lib/api";
import { BLOOD_INFO, BLOOD_INTERP, RANGE_LINES } from "@/lib/blood-markers-copy";
import { formatUpd } from "@/lib/member-format";
import { BackChevron } from "@/components/member/nav-icons";

/* Blood Test Markers (build/dashboard.html, #view-blood): the module card with
   its History / New entry tabs, three lab groups with the client's info
   buttons, the calculated read-only ratios with goal flags, and the History
   pane — latest-entry range lines, the dated table, the interpretation guide
   and the marker-based supplement suggestion with its honest review state.
   Every number comes from the API (preview while typing, calculate on save);
   the browser holds no formula. */

type Tab = "history" | "new";
type FieldKey = BloodMarkerKey | "aa_epa";
type Form = Record<FieldKey, string>;

const EMPTY: Form = { tg: "", hdl: "", insulin: "", glucose: "", aa: "", epa: "", hba1c: "", aa_epa: "" };

function toInput(form: Form): BloodMarkersInput {
  const input: BloodMarkersInput = {};
  (Object.keys(form) as FieldKey[]).forEach((key) => {
    const value = form[key].trim();
    if (value !== "" && Number.isFinite(Number(value))) input[key] = Number(value);
  });
  // Entering AA and EPA overrides a typed ratio with the calculated one (the
  // prototype locks the field); the typed value is not sent alongside them.
  if (input.aa !== undefined && input.epa !== undefined) delete input.aa_epa;
  return input;
}

function fmt(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : String(value);
}

/** Calculated ratios read with two decimals, as the prototype prints them
 *  ("3.00", "2.22"); a laboratory-reported AA/EPA ratio reads as entered. */
function ratio(value: number | null | undefined, entered = false): string {
  if (value === null || value === undefined) return "—";
  return entered ? String(value) : value.toFixed(2);
}

export default function BloodMarkersPage() {
  const [history, setHistory] = useState<BloodMarkersHistory | null>(null);
  const [tab, setTab] = useState<Tab>("new");
  const [form, setForm] = useState<Form>(EMPTY);
  const [preview, setPreview] = useState<BloodMarkersPreview | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [info, setInfo] = useState<{ key: string; x: number; y: number } | null>(null);
  const infoTrigger = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    getBloodMarkersHistory().then((data) => {
      setHistory(data);
      // tab default: history if there's data, otherwise new
      setTab(data.history.length ? "history" : "new");
    }).catch((reason: Error) => setError(reason.message));
  }, []);

  // Live "Calculated" fields: the server previews the same deterministic
  // calculation while the member types (debounced), nothing is stored.
  useEffect(() => {
    const input = toInput(form);
    if (!Object.keys(input).length) { setPreview(null); return; }
    const timer = setTimeout(() => {
      previewBloodMarkers(input).then(setPreview).catch(() => setPreview(null));
    }, 250);
    return () => clearTimeout(timer);
  }, [form]);

  useEffect(() => {
    if (!info) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { setInfo(null); infoTrigger.current?.focus(); } };
    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest(".info-popover") && !target.closest(".info-i")) setInfo(null);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("click", onClick);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("click", onClick); };
  }, [info]);

  const set = (key: FieldKey) => (event: React.ChangeEvent<HTMLInputElement>) => {
    setForm((current) => ({ ...current, [key]: event.target.value }));
    setError("");
  };

  function showInfo(key: string, button: HTMLButtonElement) {
    infoTrigger.current = button;
    const rect = button.getBoundingClientRect();
    setInfo({ key, x: Math.min(rect.left, window.innerWidth - 340), y: rect.bottom + 8 });
  }

  async function save() {
    setError("");
    const input = toInput(form);
    if (!Object.keys(input).length) { setError("Please enter at least one marker value."); return; }
    setSaving(true);
    try {
      const saved = await calculateBloodMarkers(input);
      setHistory((current) => ({ member_id: saved.member_id, latest: saved, history: [saved, ...(current?.history ?? [])] }));
      setForm(EMPTY);
      setPreview(null);
      setTab("history");
      window.scrollTo(0, 0);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "We could not save these markers.");
    } finally {
      setSaving(false);
    }
  }

  const aaEpaCalculated = preview?.aa_epa_source === "calculated";
  const aaEpaBadge = aaEpaCalculated ? "Calculated from AA and EPA" : form.aa_epa ? "Entered from lab report" : "Calculated or fill in";
  const entries = history?.history ?? [];

  return (
    <div className="view-blood">
      <header className="quiz-topbar fade-in">
        <Link className="quiz-back" href="/app/progress"><BackChevron /> Back to My Progress</Link>
      </header>

      <div className="module-card fade-in d1">
        <div className="module-card-head">
          <div>
            <h2>Blood Test Markers</h2>
            <p className="module-card-lede">View your history or add a new entry. The date is recorded automatically.</p>
          </div>
          {/* "Learn More" opens the Veye Companion in the prototype; it returns with the Companion slice. */}
        </div>

        <div className="tab-strip" role="tablist">
          <button className={`tab-btn${tab === "history" ? " active" : ""}`} type="button" role="tab" aria-selected={tab === "history"} onClick={() => setTab("history")}>History</button>
          <button className={`tab-btn${tab === "new" ? " active" : ""}`} type="button" role="tab" aria-selected={tab === "new"} onClick={() => setTab("new")}>New entry</button>
        </div>

        {/* ---------------- New entry pane ---------------- */}
        <div className={`tab-pane${tab === "new" ? " active" : ""}`} role="tabpanel" hidden={tab !== "new"}>
          <div className="lab-form">
            <div className="lab-group">
              <div className="lab-group__head"><span className="lab-group__title">Lipids</span><span className="lab-group__note">Insulin resistance</span></div>
              <LabField id="lab_tg" label="Triglycerides" info="tg" unit="mg/dL" step="0.1" value={form.tg} onChange={set("tg")} onInfo={showInfo} ariaLabel="Triglycerides, milligrams per deciliter" />
              <LabField id="lab_hdl" label="HDL Cholesterol" info="hdl" unit="mg/dL" step="0.1" value={form.hdl} onChange={set("hdl")} onInfo={showInfo} ariaLabel="HDL Cholesterol, milligrams per deciliter" />
              <CalcField id="lab_tg_hdl" label="TG/HDL Ratio" info="tg_hdl" goal="goal < 1" value={preview?.tg_hdl ?? null} inRange={preview?.in_range.tg_hdl ?? null} onInfo={showInfo} ariaLabel="TG over HDL ratio, calculated, read-only" />
            </div>

            <div className="lab-group">
              <div className="lab-group__head"><span className="lab-group__title">Glycemic control</span><span className="lab-group__note">AMPK activity</span></div>
              {/* Order per client (20 Aug 2026): HbA1c, Fasting Insulin, Fasting Glucose, HOMA-IR */}
              <div className="lab-field">
                <label htmlFor="lab_hba1c">HbA1c <InfoButton info="hba1c" label="About HbA1c" onInfo={showInfo} /><span className="lab-goal">goal 4.9&ndash;5.1%</span><Flag inRange={preview?.in_range.hba1c ?? null} /></label>
                <div className="lab-input"><input type="number" step="0.01" id="lab_hba1c" aria-label="HbA1c, percent" inputMode="decimal" value={form.hba1c} onChange={set("hba1c")} /><span className="lab-unit">%</span></div>
              </div>
              <LabField id="lab_insulin" label="Fasting Insulin" info="insulin" unit="µU/mL" step="0.1" value={form.insulin} onChange={set("insulin")} onInfo={showInfo} ariaLabel="Fasting Insulin, micro-units per milliliter" />
              <LabField id="lab_glucose" label="Fasting Glucose" info="glucose" unit="mg/dL" step="0.1" value={form.glucose} onChange={set("glucose")} onInfo={showInfo} ariaLabel="Fasting Glucose, milligrams per deciliter" />
              <CalcField id="lab_homa" label="HOMA-IR" info="homa" goal="goal < 1" value={preview?.homa_ir ?? null} inRange={preview?.in_range.homa_ir ?? null} onInfo={showInfo} ariaLabel="HOMA-IR, calculated, read-only" />
            </div>

            <div className="lab-group">
              <div className="lab-group__head"><span className="lab-group__title">Inflammation</span><span className="lab-group__note">Omega balance</span></div>
              <LabField id="lab_aa" label="Arachidonic Acid (AA)" info="aa" step="0.1" value={form.aa} onChange={set("aa")} onInfo={showInfo} ariaLabel="Arachidonic Acid, AA" />
              <LabField id="lab_epa" label="Eicosapentaenoic Acid (EPA)" info="epa" step="0.1" value={form.epa} onChange={set("epa")} onInfo={showInfo} ariaLabel="Eicosapentaenoic Acid, EPA" />
              {/* Some laboratories report only the AA/EPA ratio, so this field takes a
                  typed value too (client: "calculated or fill in"). Entering AA and EPA
                  overrides it with the calculated ratio; the badge says which. */}
              <div className="lab-field">
                <label htmlFor="lab_aa_epa">AA/EPA Ratio <InfoButton info="aa_epa" label="About the AA/EPA Ratio" onInfo={showInfo} /><span className="lab-calc-badge">{aaEpaBadge}</span><span className="lab-goal">goal 1.5&ndash;3</span><Flag inRange={preview?.in_range.aa_epa ?? null} /></label>
                <div className="lab-input">
                  <input type="number" step="0.01" id="lab_aa_epa" aria-label="AA over EPA ratio, calculated from AA and EPA or entered directly" inputMode="decimal"
                    readOnly={aaEpaCalculated} value={aaEpaCalculated ? ratio(preview?.aa_epa) : form.aa_epa} onChange={set("aa_epa")} />
                </div>
              </div>
            </div>
          </div>

          {error && <p className="fdx-err" role="alert">{error}</p>}
          <div className="lab-foot">
            <button className="btn-primary" type="button" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save markers"}</button>
          </div>
        </div>

        {/* ---------------- History pane ---------------- */}
        <div className={`tab-pane${tab === "history" ? " active" : ""}`} role="tabpanel" hidden={tab !== "history"}>
          {!history && !error && <div className="history-empty"><p>Loading your history…</p></div>}
          {history && entries.length === 0 && <div className="history-empty"><p>No history yet — add your first entry to start tracking your markers.</p></div>}
          {entries.length > 0 && <HistoryPane entries={entries} />}
        </div>
      </div>

      {info && BLOOD_INFO[info.key] && (
        <div className="info-popover" role="dialog" aria-labelledby="infoTitle" style={{ left: info.x, top: info.y }}>
          <button className="info-close" type="button" aria-label="Close" onClick={() => { setInfo(null); infoTrigger.current?.focus(); }}>&times;</button>
          <h4 id="infoTitle">{BLOOD_INFO[info.key].title}</h4>
          <p>{BLOOD_INFO[info.key].body}</p>
        </div>
      )}
    </div>
  );
}

function InfoButton({ info, label, onInfo }: { info: string; label: string; onInfo: (key: string, button: HTMLButtonElement) => void }) {
  return <button type="button" className="info-i" aria-label={label} onClick={(event) => { event.preventDefault(); onInfo(info, event.currentTarget); }}>i</button>;
}

function Flag({ inRange }: { inRange: boolean | null }) {
  if (inRange === null) return <span className="lab-flag" hidden />;
  return <span className={`lab-flag ${inRange ? "lab-flag--in" : "lab-flag--out"}`}>{inRange ? "In range" : "Out of range"}</span>;
}

function LabField({ id, label, info, unit, step, value, onChange, onInfo, ariaLabel }: {
  id: string; label: string; info: string; unit?: string; step: string; value: string;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void; onInfo: (key: string, button: HTMLButtonElement) => void; ariaLabel: string;
}) {
  return (
    <div className="lab-field">
      <label htmlFor={id}>{label} <InfoButton info={info} label={`About ${label}`} onInfo={onInfo} /></label>
      <div className="lab-input"><input type="number" step={step} id={id} aria-label={ariaLabel} inputMode="decimal" value={value} onChange={onChange} />{unit && <span className="lab-unit">{unit}</span>}</div>
    </div>
  );
}

function CalcField({ id, label, info, goal, value, inRange, onInfo, ariaLabel }: {
  id: string; label: string; info: string; goal: string; value: number | null; inRange: boolean | null;
  onInfo: (key: string, button: HTMLButtonElement) => void; ariaLabel: string;
}) {
  return (
    <div className="lab-field">
      <label htmlFor={id}>{label} <InfoButton info={info} label={`About ${label}`} onInfo={onInfo} /><span className="lab-calc-badge">Calculated</span><span className="lab-goal">{goal}</span><Flag inRange={inRange} /></label>
      <div className="lab-input lab-input-calc"><input type="text" id={id} aria-label={ariaLabel} readOnly value={value === null ? "" : value.toFixed(2)} /></div>
    </div>
  );
}

function HistoryPane({ entries }: { entries: BloodMarkersHistoryItem[] }) {
  const latest = entries[0];
  const prev = entries[1];
  const [open, setOpen] = useState<Record<string, boolean>>({ tg: true });
  const rec = latest.recommendation;

  const valueOf = (item: BloodMarkersHistoryItem, key: "tg_hdl" | "hba1c" | "homa_ir" | "aa_epa") =>
    key === "hba1c" ? item.markers.hba1c : item[key];

  return (
    <>
      <div className="history-summary">
        <h3>Latest entry summary</h3>
        <div className="history-summary-grid">
          {RANGE_LINES.map((group) => (
            <div className="range-group" key={group.section}>
              <div className="range-group-title">{group.section}</div>
              {group.rows.map((row) => {
                const raw = valueOf(latest, row.key);
                const hasValue = raw !== null && raw !== undefined && Number.isFinite(raw);
                const v = hasValue ? (raw as number) : 0;
                const pos = hasValue ? Math.min(98, Math.max(2, (v - row.span[0]) / (row.span[1] - row.span[0]) * 100)) : 2;
                const z0 = (row.zone[0] - row.span[0]) / (row.span[1] - row.span[0]) * 100;
                const z1 = (row.zone[1] - row.span[0]) / (row.span[1] - row.span[0]) * 100;
                const p = prev ? valueOf(prev, row.key) : null;
                let trend = "", dir = "flat";
                if (hasValue && p !== null && p !== undefined && Number.isFinite(p) && v !== p) {
                  const improved = v < (p as number);          // lower is better on all four lines
                  dir = improved ? "down" : "up"; trend = improved ? "↓" : "↑";
                }
                const src = row.key === "aa_epa" && latest.aa_epa_source
                  ? <span className="range-src">{latest.aa_epa_source === "calculated" ? "calculated from AA and EPA" : "entered from lab report"}</span> : null;
                return (
                  <div className={`range-line-row${hasValue ? "" : " at-rest"}`} key={row.key}>
                    <span className="range-line" aria-hidden="true">
                      <i className="zone" style={{ left: `${z0}%`, width: `${z1 - z0}%` }} />
                      <i className="dot" style={{ left: `${pos}%` }} />
                    </span>
                    <span className="range-line-label"><b>{row.label}</b>
                      <span className="range-val">{hasValue ? (row.key === "hba1c" ? fmt(raw) : ratio(raw, row.key === "aa_epa" && latest.aa_epa_source === "entered")) : "not filled in"} <span className={`trend-${dir}`}>{trend}</span></span>
                      <span className="range-goal">{row.goal}</span>{src}</span>
                  </div>
                );
              })}
            </div>
          ))}
          <div className="range-group"><div className="range-group-title">Raw values</div>
            <div className="range-plain"><span>Triglycerides</span><b>{fmt(latest.markers.tg)}</b></div>
            <div className="range-plain"><span>HDL</span><b>{fmt(latest.markers.hdl)}</b></div>
            <div className="range-plain"><span>Fasting Insulin</span><b>{fmt(latest.markers.insulin)}</b></div>
            <div className="range-plain"><span>Fasting Glucose</span><b>{fmt(latest.markers.glucose)}</b></div>
          </div>
        </div>
      </div>

      <div className="history-table-wrap">
        <table className="history-table">
          <thead><tr><th>Date</th><th>TG</th><th>HDL</th><th>TG/HDL</th><th>HbA1c</th><th>HOMA-IR</th><th>AA/EPA</th></tr></thead>
          <tbody>
            {entries.map((item) => (
              <tr key={item.attempt_id}>
                <td>{formatUpd(item.completed_at)}</td>
                <td>{fmt(item.markers.tg)}</td><td>{fmt(item.markers.hdl)}</td><td>{ratio(item.tg_hdl)}</td>
                <td>{fmt(item.markers.hba1c)}</td><td>{ratio(item.homa_ir)}</td><td>{ratio(item.aa_epa, item.aa_epa_source === "entered")}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="bmi-trend-note" style={{ marginTop: 10 }}>Latest entry saved {formatUpd(latest.completed_at)} · calculation version {latest.calculation_version}</p>
      </div>

      <div className="interp-guide">
        <h3>Interpretation Guide</h3>
        <div className="accordion">
          {BLOOD_INTERP.map((item) => (
            <div className={`accordion-item${open[item.key] ? " open" : ""}`} key={item.key}>
              <button className="accordion-head" type="button" aria-expanded={!!open[item.key]} onClick={() => setOpen((current) => ({ ...current, [item.key]: !current[item.key] }))}>
                <span className="chev">▶</span>{item.title}
              </button>
              <div className="accordion-body"><p>{item.body}</p></div>
            </div>
          ))}
        </div>
      </div>

      <div className="supplement-rec">
        <h3>Supplement Recommendation</h3>
        {/* Marker-based suggestion per "Supplement Rec'd Under Blood Markers.docx"
            (25 Aug 2026), calculated and stored by the API with the entry.
            Combinations the document does not define show the review state
            instead of an invented amount. */}
        {rec.state === "ok" && <>
          <p className="supp-sub">{rec.lead}</p>
          <div>
            <div className="rec-row"><span className="rec-label">EPA/DHA suggested dosage</span><span className="rec-value">{rec.epa_dha_dose}</span></div>
            <div className="rec-subhead">Polyphenol suggested dosage &mdash; the same for all results</div>
            <div className="rec-row rec-row--poly"><span className="rec-label">500mg</span><span className="rec-note-inline">helps reduce oxidative stress</span></div>
            <div className="rec-row rec-row--poly"><span className="rec-label">1000mg</span><span className="rec-note-inline">helps reduce inflammation</span></div>
            <div className="rec-row rec-row--poly"><span className="rec-label">1500mg</span><span className="rec-note-inline">helps reduce the rate of aging and increases mitochondrial synthesis</span></div>
          </div>
        </>}
        {rec.state === "review" && (
          <div className="rec-review">
            <b>Recommendation requires review</b>
            <p>This combination of marker values is not covered by the current Veye guidance table, so no amount is suggested. Your entries and history are saved.</p>
          </div>
        )}
        {rec.state === "none" && <p className="supp-sub">Enter at least one calculated marker to see a suggestion.</p>}

        <h4 className="ranges-title">Key Markers &amp; Ideal Ranges</h4>
        <div className="ranges-grid">
          <div className="range-row"><span>TG/HDL ratio</span><span>&lt; 1</span></div>
          <div className="range-row"><span>AA/EPA ratio</span><span>1.5 – 3</span></div>
          <div className="range-row"><span>HbA1c</span><span>4.9 – 5.1 %</span></div>
          <div className="range-row"><span>HOMA-IR</span><span>&lt; 1</span></div>
        </div>
      </div>
    </>
  );
}
