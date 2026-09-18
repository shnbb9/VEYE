/* Client-supplied Blood Test Markers copy, transcribed from build/dashboard.html
   (info buttons per the red edits, Dashboard edits 20 Aug 2026; interpretation
   guide; approved goal labels). Wording is verbatim — including the
   Triglycerides "insulin sensitivity" line, which is flagged for clinical
   review in the unresolved-decisions list rather than second-guessed here. */

export const BLOOD_INFO: Record<string, { title: string; body: string }> = {
  tg:      { title: "Triglycerides", body: "Triglyceride levels reflect dietary fat and carb processing. Higher values indicate insulin sensitivity. Reduced by a balanced diet low in refined carbs." },
  hdl:     { title: "HDL Cholesterol", body: "\"Good\" cholesterol that carries fat away from arteries. Higher HDL indicates cardiovascular health and a healthier TG/HDL ratio." },
  tg_hdl:  { title: "TG/HDL Ratio", body: "The TG/HDL ratio is a surrogate marker of insulin resistance. This marker can be significantly reduced by following a balanced diet." },
  insulin: { title: "Fasting Insulin", body: "Insulin produced when fasting. Elevated values indicate the pancreas is overworking — a key early sign of insulin resistance." },
  glucose: { title: "Fasting Glucose", body: "Blood sugar after an overnight fast. Persistently high values reflect impaired AMPK activity and risk for type-2 diabetes." },
  homa:    { title: "HOMA-IR", body: "HOMA-IR is the best predictor of insulin resistance, a predictor of future chronic disease, and is a surrogate marker for AMPK." },
  aa:      { title: "Arachidonic Acid (AA)", body: "A pro-inflammatory omega-6 fatty acid. When too high relative to EPA, inflammation goes unresolved. Reduced by limiting omega-6 oils and taking DHA and EPA supplements." },
  epa:     { title: "Eicosapentaenoic Acid (EPA)", body: "An anti-inflammatory omega-3 fatty acid. EPA balances the AA/EPA ratio. Primarily raised by high-dose fish oil supplementation." },
  aa_epa:  { title: "AA/EPA Ratio", body: "This is a marker of the balance of unresolved inflammation. This marker is primarily reduced by high-dose omega-3 fatty acids." },
  hba1c:   { title: "HbA1c", body: "Long-term blood glucose control (~3 months). Elevated values inhibit AMPK activity. Reduced primarily by high-dose polyphenols and a low-glycemic diet." },
};

export const BLOOD_INTERP: Array<{ key: string; title: string; body: string }> = [
  { key: "tg",      title: "Triglycerides",   body: "Triglyceride levels reflect dietary fat and carbohydrate processing. Significantly reduced by a balanced, low-glycemic diet." },
  { key: "hdl",     title: "HDL Cholesterol", body: "\"Good\" cholesterol. Higher HDL improves the TG/HDL ratio and supports cardiovascular health." },
  { key: "insulin", title: "Fasting Insulin", body: "Persistently high fasting insulin signals insulin resistance. The first marker to improve on a Veye plan." },
  { key: "glucose", title: "Fasting Glucose", body: "Elevated fasting glucose inhibits AMPK activity. Trending down indicates better metabolic flexibility." },
  { key: "tg_hdl",  title: "TG/HDL Ratio",    body: "A surrogate marker of insulin resistance. Goal: <1. Significantly reduced by following a balanced diet." },
  { key: "aa_epa",  title: "AA/EPA Ratio",    body: "Balance of unresolved inflammation. Goal: 1.5–3. Primarily reduced by high-dose omega-3 fatty acids." },
  { key: "hba1c",   title: "HbA1c",           body: "Long-term blood glucose control. Goal: 4.9–5.1%. Primarily reduced by high-dose polyphenols." },
  { key: "homa",    title: "HOMA-IR",         body: "Estimates insulin resistance. HOMA-IR = (fasting insulin × fasting glucose) / 22.5. Goal: <1. A surrogate marker for AMPK activity." },
];

/* Latest-entry summary lines (client, 20 Aug 2026: "make the lines shorter and
   the word right after"). Marker placement is a fixed linear mapping of the
   saved value onto each line's display span — deterministic presentation, not
   analysis. */
export const RANGE_LINES: Array<{ section: string; rows: Array<{ key: "tg_hdl" | "hba1c" | "homa_ir" | "aa_epa"; label: string; goal: string; span: [number, number]; zone: [number, number] }> }> = [
  { section: "Lipids", rows: [
    { key: "tg_hdl", label: "TG/HDL ratio", goal: "goal < 1", span: [0, 2], zone: [0, 1] },
  ] },
  { section: "Glycemic control", rows: [
    { key: "hba1c", label: "HbA1c", goal: "goal 4.9–5.1%", span: [4, 6.5], zone: [4.9, 5.1] },
    { key: "homa_ir", label: "HOMA-IR", goal: "goal < 1", span: [0, 2], zone: [0, 1] },
  ] },
  { section: "Inflammation", rows: [
    { key: "aa_epa", label: "AA/EPA ratio", goal: "goal 1.5–3", span: [0, 6], zone: [1.5, 3] },
  ] },
];
