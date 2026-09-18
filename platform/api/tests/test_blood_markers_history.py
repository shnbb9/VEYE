"""Persisted Blood Test Markers: write, stored history, retake, and boundaries."""

from uuid import UUID

from app.progress.blood_markers.models import BloodMarkerAttempt
from app.progress.blood_markers.service import BLOOD_MARKERS_CALCULATION_VERSION
from app.db.session import SessionLocal


HISTORY = "/api/v1/members/me/blood-markers"


def test_calculate_persists_a_fully_auditable_entry(member_client):
    response = member_client.post("/api/v1/blood-markers/calculate", json={"input": {
        "tg": 150, "hdl": 50, "insulin": 10, "glucose": 90, "aa": 9, "epa": 4, "hba1c": 5.0,
    }})
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["member_id"] == member_client.account["member_id"]
    assert body["markers"] == {"tg": 150, "hdl": 50, "insulin": 10, "glucose": 90, "aa": 9, "epa": 4, "hba1c": 5.0}
    assert body["tg_hdl"] == 3 and body["homa_ir"] == 2.22 and body["aa_epa"] == 2.25
    assert body["aa_epa_source"] == "calculated"
    assert body["in_range"] == {"tg_hdl": False, "homa_ir": False, "aa_epa": True, "hba1c": True}
    assert body["classification"] == {"tg_hdl": "moderate", "homa_ir": "moderate", "aa_epa": "optimal", "hba1c": "optimal"}
    assert body["recommendation"]["state"] == "ok" and body["recommendation"]["epa_dha_dose"] == "3.5g"
    assert body["calculation_version"] == BLOOD_MARKERS_CALCULATION_VERSION
    assert body["completed_at"]


def test_history_lists_stored_entries_newest_first_without_recalculating(member_client):
    first = member_client.post("/api/v1/blood-markers/calculate", json={"input": {"hba1c": 5.0}}).json()
    second = member_client.post("/api/v1/blood-markers/calculate", json={"input": {"tg": 200, "hdl": 50}}).json()

    # Simulate an older calculation version on the stored row: the read must
    # return what was stored, not a fresh calculation.
    with SessionLocal() as db:
        row = db.get(BloodMarkerAttempt, UUID(first["attempt_id"]))
        row.calculation_version = "0.9.0-test"
        row.results = {**row.results, "recommendation": {"state": "review", "epa_dha_dose": None, "lead": None}}
        db.commit()

    response = member_client.get(HISTORY)
    assert response.status_code == 200
    body = response.json()
    assert [item["attempt_id"] for item in body["history"]] == [second["attempt_id"], first["attempt_id"]]
    assert body["latest"]["attempt_id"] == second["attempt_id"]
    stored_first = body["history"][1]
    assert stored_first["calculation_version"] == "0.9.0-test"
    assert stored_first["recommendation"]["state"] == "review"
    assert stored_first["markers"]["hba1c"] == 5.0


def test_empty_history_is_honest(member_client):
    body = member_client.get(HISTORY).json()
    assert body == {"member_id": member_client.account["member_id"], "latest": None, "history": []}


def test_entered_ratio_is_kept_as_reported(member_client):
    body = member_client.post("/api/v1/blood-markers/calculate", json={"input": {"aa_epa": 1.095}}).json()
    assert body["aa_epa"] == 1.095 and body["aa_epa_source"] == "entered"
    assert body["classification"]["aa_epa"] == "undefined" and body["recommendation"]["state"] == "review"


def test_validation_boundaries(member_client):
    assert member_client.post("/api/v1/blood-markers/calculate", json={"input": {}}).status_code == 422
    assert member_client.post("/api/v1/blood-markers/calculate", json={"input": {"tg": 0, "hdl": 50}}).status_code == 422
    assert member_client.post("/api/v1/blood-markers/calculate", json={"input": {"aa": 9, "epa": 4, "aa_epa": 2.25}}).status_code == 422
    # client-computed ratios are refused
    assert member_client.post("/api/v1/blood-markers/calculate", json={"input": {"tg": 100, "hdl": 50, "tg_hdl": 2}}).status_code == 422
    assert member_client.post("/api/v1/blood-markers/calculate", json={"input": {"insulin": 10, "glucose": 90, "homa_ir": 2.2}}).status_code == 422
    # no client-selected member IDs
    assert member_client.post("/api/v1/blood-markers/calculate", json={"input": {"hba1c": 5.0}, "member_id": "x"}).status_code == 422
    assert member_client.get("/api/v1/members/11111111-1111-1111-1111-111111111111/blood-markers").status_code == 404


def test_preview_calculates_without_storing(member_client):
    response = member_client.post("/api/v1/blood-markers/preview", json={"input": {"tg": 90, "hdl": 100, "insulin": 4, "glucose": 81}})
    assert response.status_code == 200
    assert response.json() == {
        "tg_hdl": 0.9, "homa_ir": 0.8, "aa_epa": None, "aa_epa_source": None,
        "in_range": {"tg_hdl": True, "homa_ir": True, "aa_epa": None, "hba1c": None},
        "calculation_version": BLOOD_MARKERS_CALCULATION_VERSION,
    }
    assert member_client.get(HISTORY).json()["history"] == []
    assert member_client.post("/api/v1/blood-markers/preview", json={"input": {}}).status_code == 422
