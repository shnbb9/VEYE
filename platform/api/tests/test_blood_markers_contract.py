"""Direct JS-to-Python contract vectors for the approved Blood Test Markers
behaviour: the engine's ratio formulas and goal flags, and the prototype
dashboard's bands and EPA/DHA suggestion, run from the unmodified sources."""

import json
import subprocess
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.progress.blood_markers.schemas import BloodMarkersInput
from app.progress.blood_markers.service import calculate_blood_markers


CONTRACT_HELPER = Path(__file__).parent / "contracts" / "blood_markers_vectors.js"


def run_js(vectors):
    completed = subprocess.run(
        ["node", str(CONTRACT_HELPER)],
        input=json.dumps({"vectors": vectors}),
        text=True,
        encoding="utf-8",
        capture_output=True,
        check=True,
    )
    return {item["id"]: item for item in json.loads(completed.stdout)["results"]}


def python_result(payload):
    result = calculate_blood_markers(BloodMarkersInput(**payload))
    return {
        "tg_hdl": result.tg_hdl,
        "homa_ir": result.homa_ir,
        "aa_epa": result.aa_epa,
        "aa_epa_source": result.aa_epa_source,
        "in_range": result.in_range,
        "classification": result.classification,
        "recommendation": {
            "state": result.recommendation.state,
            "epa_dha_dose": result.recommendation.epa_dha_dose,
            "lead": result.recommendation.lead,
        },
    }


def hba1c_hdl_tg(tg_hdl_ratio):
    """A TG/HDL pair that produces the wanted ratio exactly (HDL = 100)."""
    return {"tg": tg_hdl_ratio * 100, "hdl": 100}


def homa_pair(homa):
    """An insulin/glucose pair that produces the wanted HOMA-IR exactly (glucose = 405)."""
    return {"insulin": homa, "glucose": 405}


VECTORS = [
    # ---- ratio formulas ------------------------------------------------------
    {"id": "tg-hdl-basic", "input": {"tg": 150, "hdl": 50}},
    {"id": "tg-hdl-rounds-to-two-decimals", "input": {"tg": 100, "hdl": 30}},
    {"id": "homa-basic", "input": {"insulin": 10, "glucose": 90}},
    {"id": "homa-rounds", "input": {"insulin": 7.3, "glucose": 93}},
    {"id": "aa-epa-calculated", "input": {"aa": 9, "epa": 4}},
    {"id": "aa-epa-entered", "input": {"aa_epa": 2.2}},
    {"id": "aa-epa-entered-unrounded", "input": {"aa_epa": 1.095}},
    {"id": "aa-only-no-ratio-falls-back-to-entered", "input": {"aa": 9, "aa_epa": 2.4}},
    {"id": "only-hba1c", "input": {"hba1c": 5.0}},
    # ---- goal-flag and band boundaries ----------------------------------------
    *[{"id": f"tg-hdl-{r}", "input": hba1c_hdl_tg(r)} for r in (0.99, 1, 1.01, 2, 3, 3.01, 6)],
    *[{"id": f"aa-epa-{r}", "input": {"aa_epa": r}} for r in (0.5, 1.09, 1.1, 1.49, 1.5, 2, 3, 3.01, 6, 6.01, 12)],
    *[{"id": f"hba1c-{r}", "input": {"hba1c": r}} for r in (4.5, 4.89, 4.9, 5.0, 5.1, 5.11, 5.2, 5.29, 5.3, 6.5, 8, 8.01, 11)],
    *[{"id": f"homa-{r}", "input": homa_pair(r)} for r in (0.5, 0.99, 1, 1.5, 2.9, 2.95, 3, 4.2)],
    # ---- EPA/DHA suggestion combinations --------------------------------------
    {"id": "all-optimal-four-markers", "input": {**hba1c_hdl_tg(0.8), **homa_pair(0.7), "aa": 4, "epa": 2, "hba1c": 5.0}},
    {"id": "single-moderate", "input": hba1c_hdl_tg(2)},
    {"id": "single-high", "input": {"hba1c": 9}},
    {"id": "all-moderate-two-markers", "input": {**hba1c_hdl_tg(2), "hba1c": 6}},
    {"id": "moderate-plus-optimal", "input": {**hba1c_hdl_tg(2), **homa_pair(0.5)}},
    {"id": "all-high-two-markers", "input": {**hba1c_hdl_tg(4), **homa_pair(3.5)}},
    {"id": "high-plus-optimal", "input": {**hba1c_hdl_tg(4), "hba1c": 5.0}},
    {"id": "mixed-moderate-high-review", "input": {**hba1c_hdl_tg(2), **homa_pair(3.5)}},
    {"id": "undefined-hba1c-gap-review", "input": {**hba1c_hdl_tg(0.8), "hba1c": 5.2}},
    {"id": "undefined-low-aa-epa-review", "input": {"aa": 1, "epa": 1}},
    {"id": "undefined-homa-crack-review", "input": homa_pair(2.95)},
    {"id": "raw-values-without-any-calculation", "input": {"tg": 120, "insulin": 8, "aa": 7}},
]


def test_blood_marker_vectors_match_the_approved_consumer_behaviour():
    js_results = run_js(VECTORS)
    for vector in VECTORS:
        python = python_result(vector["input"])
        js = js_results[vector["id"]]
        assert python == {key: js[key] for key in python}, vector["id"]


def test_expected_boundary_semantics_are_the_documented_ones():
    """Spot checks that name the rules, so a drift in either source is readable."""
    assert python_result(hba1c_hdl_tg(1))["classification"]["tg_hdl"] == "moderate"        # goal is "< 1"
    assert python_result({"aa_epa": 1.09})["recommendation"]["state"] == "review"          # below 1.1 undefined
    assert python_result({"hba1c": 5.2})["recommendation"]["state"] == "review"            # the 5.1-5.3 gap
    assert python_result(homa_pair(2.95))["recommendation"]["state"] == "review"           # the 2.9-3.0 crack
    assert python_result({"tg": 120, "insulin": 8})["recommendation"]["state"] == "none"   # nothing calculable
    single = python_result(hba1c_hdl_tg(2))["recommendation"]
    assert single["epa_dha_dose"] == "3.5g" and single["lead"].startswith("The Blood Marker you entered is out")
    multi = python_result({**hba1c_hdl_tg(4), **homa_pair(3.5)})["recommendation"]
    assert multi["epa_dha_dose"] == "5g" and multi["lead"].startswith("At least one of the Blood Markers")
    assert python_result({"aa": 9, "epa": 4})["aa_epa_source"] == "calculated"
    assert python_result({"aa_epa": 2.4})["aa_epa_source"] == "entered"


def test_input_rules():
    with pytest.raises(ValidationError, match="at least one marker"):
        BloodMarkersInput()
    with pytest.raises(ValidationError, match="not both"):
        BloodMarkersInput(aa=9, epa=4, aa_epa=2.25)
    with pytest.raises(ValidationError):
        BloodMarkersInput(tg=-1)
    with pytest.raises(ValidationError):
        BloodMarkersInput(tg=100, tg_hdl=2)         # ratios are never accepted from the client
