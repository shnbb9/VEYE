from uuid import UUID

import pytest
from sqlalchemy import select

from app.assessments.models import HealthNumberAttempt
from app.assessments.schemas import HealthNumberAnswers
from app.assessments.service import CALCULATION_VERSION, calculate_health_number
from app.db.session import SessionLocal


def answers(**overrides):
    base = {
        "goals": ["Live a Healthier Lifestyle"],
        "plans": ["No other plans"],
        "activity": "Moderate (I exercise 1-3 times a week)",
        "meditate": "yes", "tired": "no", "gainWeight": "no", "abdomenWeight": "no",
        "sleepEnough": "yes", "sleepWell": "yes", "sleepHours": 7,
        "diet": "No preference", "source": "Friends or Family",
    }
    base.update(overrides)
    return base


def test_healthy_profile_has_raw_minus_one_point_five_and_floor_one():
    result = calculate_health_number(HealthNumberAnswers(**answers()))
    assert result.raw_score == -1.5
    assert result.displayed_score == 1
    assert result.status == "Good Health"


def test_worst_profile_scores_ten():
    result = calculate_health_number(HealthNumberAnswers(**answers(
        plans=["Weight Watchers", "Keto", "Fasting"], activity="None", meditate="no",
        tired="yes", gainWeight="yes", abdomenWeight="yes", sleepEnough="no",
        sleepWell="no", sleepHours=4,
    )))
    assert result.raw_score == 10
    assert result.displayed_score == 10
    assert result.bucket == "high"


@pytest.mark.parametrize("raw_hours,expected", [(5, 1), (9, 1), (4.5, 1), (9.5, 1)])
def test_sleep_boundaries(raw_hours, expected):
    result = calculate_health_number(HealthNumberAnswers(**answers(sleepHours=raw_hours)))
    assert result.displayed_score == expected


def test_api_rejects_unknown_and_malformed_values(member_client):
    bad = answers(activity="Extreme")
    response = member_client.post("/api/v1/health-number/calculate", json={"answers": bad, "surprise": True})
    assert response.status_code == 422


def test_api_response_schema_version_and_persistence(member_client):
    response = member_client.post("/api/v1/health-number/calculate", json={"answers": answers()})
    assert response.status_code == 201
    body = response.json()
    assert body["displayed_score"] == 1
    assert body["calculation_version"] == CALCULATION_VERSION == "1.5.0"
    UUID(body["attempt_id"])
    UUID(body["member_id"])
    with SessionLocal() as db:
        saved = db.scalar(select(HealthNumberAttempt))
        assert saved is not None
        assert float(saved.displayed_score) == body["displayed_score"]


def test_health_endpoint(client):
    assert client.get("/health").json() == {"status": "ok", "service": "veye-api"}
