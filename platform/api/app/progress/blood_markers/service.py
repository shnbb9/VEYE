"""Exact deterministic counterpart to the approved consumer Blood Test Markers
behaviour.

Sources, ported rule for rule and not extended:

* build/js/veye-calculations.js (`VeyeCalculations.blood`, Dated Blood Markers
  tracking.pdf): the three ratio formulas and the four goal (in-range) tests.
* build/dashboard.html (`classifyMarker`, `bloodDoseTier`; Supplement Rec'd
  Under Blood Markers.docx, 25 Aug 2026): the optimal / moderate / high bands
  per calculated marker and the EPA/DHA suggestion — 2.5g when everything
  entered is optimal, 3.5g when every out-of-range marker is moderate, 5g when
  every out-of-range marker is high. Mixed moderate + high, and any value the
  document leaves undefined (AA/EPA below 1.1, HbA1c below 4.9 or between 5.1
  and 5.3, HOMA-IR between 2.9 and 3), return the review state instead of an
  invented amount. The NUMBER of entered markers never changes the amount.

No AI, no general medical knowledge, no thresholds beyond those sources.
"""

from dataclasses import dataclass
from math import floor

from app.progress.blood_markers.schemas import BloodMarkersInput, CALCULATION_KEYS, MARKER_KEYS


BLOOD_MARKERS_CALCULATION_VERSION = "1.0.0"

# Key markers & ideal ranges as published on the approved screen.
IDEAL_RANGES = {
    "tg_hdl": "< 1",
    "aa_epa": "1.5 – 3",
    "hba1c": "4.9 – 5.1 %",
    "homa_ir": "< 1",
}

LEAD_OPTIMAL = "The Blood Marker(s) you entered are in optimal range. Based on your recent blood marker values, Veye suggests"
LEAD_SINGLE_OUT = "The Blood Marker you entered is out of optimal range. Based on your recent blood marker values, Veye suggests"
LEAD_MULTI_OUT = "At least one of the Blood Markers you entered is out of optimal range. Based on your recent blood marker values, Veye suggests"


@dataclass(frozen=True)
class Recommendation:
    state: str                    # "none" | "ok" | "review"
    epa_dha_dose: str | None
    lead: str | None


@dataclass(frozen=True)
class BloodMarkersCalculation:
    markers: dict[str, float | None]
    tg_hdl: float | None
    homa_ir: float | None
    aa_epa: float | None
    aa_epa_source: str | None
    in_range: dict[str, bool | None]
    classification: dict[str, str | None]
    recommendation: Recommendation


def round_two(value: float) -> float:
    """JavaScript `Math.round(value * 100) / 100` for the positive values used here."""
    return floor(value * 100 + 0.5) / 100


# ---- ratio formulas (veye-calculations.js) ---------------------------------

def tg_hdl(tg: float | None, hdl: float | None) -> float | None:
    if tg is None or hdl is None or not (tg > 0 and hdl > 0):
        return None
    return round_two(tg / hdl)


def aa_epa(aa: float | None, epa: float | None) -> float | None:
    if aa is None or epa is None or not (aa > 0 and epa > 0):
        return None
    return round_two(aa / epa)


def homa_ir(insulin: float | None, glucose: float | None) -> float | None:
    """The source states insulin (µU/mL) × glucose / 22.5 with glucose in mmol/L.
    Glucose is collected in mg/dL, and mg/dL = mmol/L × 18.0182, so dividing by
    22.5 × 18.0182 = 405 is the exact unit-equivalent of the source formula."""
    if insulin is None or glucose is None or not (insulin > 0 and glucose > 0):
        return None
    return round_two(insulin * glucose / 405)


# ---- goal flags (veye-calculations.js BLOOD_GOALS) --------------------------

def in_range(key: str, value: float) -> bool:
    if key == "tg_hdl":
        return value < 1
    if key == "aa_epa":
        return 1.5 <= value <= 3
    if key == "hba1c":
        return 4.9 <= value <= 5.1
    if key == "homa_ir":
        return value < 1
    raise KeyError(key)


# ---- bands (dashboard.html classifyMarker) ---------------------------------

def classify(key: str, value: float) -> str:
    if key == "tg_hdl":
        return "optimal" if value < 1 else "moderate" if value <= 3 else "high"
    if key == "aa_epa":
        if value < 1.1:
            return "undefined"
        if 1.5 <= value <= 3:
            return "optimal"
        return "moderate" if value <= 6 else "high"
    if key == "hba1c":
        if 4.9 <= value <= 5.1:
            return "optimal"
        if 5.3 <= value <= 8:
            return "moderate"
        if value > 8:
            return "high"
        return "undefined"          # below 4.9, or the 5.1-5.3 gap
    if key == "homa_ir":
        if value < 1:
            return "optimal"
        if value <= 2.9:
            return "moderate"
        if value >= 3:
            return "high"
        return "undefined"          # the 2.9-3.0 crack
    raise KeyError(key)


# ---- EPA/DHA suggestion (dashboard.html bloodDoseTier) ---------------------

def recommend(classification: dict[str, str | None]) -> Recommendation:
    entered = [status for status in classification.values() if status is not None]
    if not entered:
        return Recommendation("none", None, None)
    if any(status == "undefined" for status in entered):
        return Recommendation("review", None, None)
    out = [status for status in entered if status != "optimal"]
    if not out:
        return Recommendation("ok", "2.5g", LEAD_OPTIMAL)
    lead = LEAD_SINGLE_OUT if len(entered) == 1 else LEAD_MULTI_OUT
    if all(status == "moderate" for status in out):
        return Recommendation("ok", "3.5g", lead)
    if all(status == "high" for status in out):
        return Recommendation("ok", "5g", lead)
    return Recommendation("review", None, None)      # mixed moderate + high — undefined


def calculate_blood_markers(input: BloodMarkersInput) -> BloodMarkersCalculation:
    markers = {key: getattr(input, key) for key in MARKER_KEYS}

    ratio_tg_hdl = tg_hdl(input.tg, input.hdl)
    ratio_homa = homa_ir(input.insulin, input.glucose)
    calculated_aa_epa = aa_epa(input.aa, input.epa)
    if calculated_aa_epa is not None:
        ratio_aa_epa, aa_epa_source = calculated_aa_epa, "calculated"
    elif input.aa_epa is not None:
        # Kept exactly as reported: the prototype classifies the typed ratio unrounded.
        ratio_aa_epa, aa_epa_source = input.aa_epa, "entered"
    else:
        ratio_aa_epa, aa_epa_source = None, None

    values = {
        "tg_hdl": ratio_tg_hdl,
        "homa_ir": ratio_homa,
        "aa_epa": ratio_aa_epa,
        "hba1c": input.hba1c,
    }
    flags = {key: (in_range(key, value) if value is not None else None) for key, value in values.items()}
    bands = {key: (classify(key, value) if value is not None else None) for key, value in values.items()}
    assert tuple(values) == CALCULATION_KEYS

    return BloodMarkersCalculation(
        markers=markers,
        tg_hdl=ratio_tg_hdl,
        homa_ir=ratio_homa,
        aa_epa=ratio_aa_epa,
        aa_epa_source=aa_epa_source,
        in_range=flags,
        classification=bands,
        recommendation=recommend(bands),
    )
