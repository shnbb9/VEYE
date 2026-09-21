"""Health Assessment and Simple Quiz production slices: contract parity with the
approved consumer engine and screen, the member API, history/retake, the
guided-flow member state, and the product rule that the Simple Quiz never
touches the Health Number."""

import json
import subprocess
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.progress.health_assessment.schemas import HealthAssessmentInput
from app.progress.health_assessment.service import (
    HEALTH_ASSESSMENT_CALCULATION_VERSION,
    NEUROLOGICAL_ROW,
    QUESTION_KEYS as HA_KEYS,
    QUESTIONS as HA_QUESTIONS,
    calculate_health_assessment,
)
from app.progress.simple_quiz.schemas import SimpleQuizInput
from app.progress.simple_quiz.service import (
    QUESTION_KEYS as SQ_KEYS,
    QUESTIONS as SQ_QUESTIONS,
    SIMPLE_QUIZ_CALCULATION_VERSION,
    calculate_simple_quiz,
)
from tests.conftest import sign_up

CONTRACT_HELPER = Path(__file__).parent / "contracts" / "health_assessment_simple_quiz_vectors.js"


def run_js(request: dict) -> dict:
    completed = subprocess.run(["node", str(CONTRACT_HELPER)], input=json.dumps(request), text=True, encoding="utf-8",
                               capture_output=True, check=True)
    return json.loads(completed.stdout)


def ha_answers(value=1, **overrides) -> dict[str, int]:
    answers = {key: value for key in HA_KEYS}
    answers.update(overrides)
    return answers


def sq_answers(yes=()) -> dict[str, str]:
    return {key: ("yes" if key in yes else "no") for key in SQ_KEYS}


def hn_answers():
    return {
        "goals": ["Live a Healthier Lifestyle"], "plans": ["No other plans"],
        "activity": "Moderate (I exercise 1-3 times a week)", "meditate": "yes", "tired": "no", "gainWeight": "no",
        "abdomenWeight": "no", "sleepEnough": "yes", "sleepWell": "yes", "sleepHours": 7,
        "diet": "No preference", "source": "Friends or Family",
    }


# ---------------------------------------------------------------- contracts
class TestConsumerContract:
    def test_questions_and_choices_match_the_approved_screen(self):
        js = run_js({})
        assert [q.label for q in HA_QUESTIONS] == [q["q"] for q in js["assessment_questions"]]
        assert [(q.best, q.middle, q.worst) for q in HA_QUESTIONS] == [(q["best"], q["middle"], q["worst"]) for q in js["assessment_questions"]]
        assert [label for _, label in SQ_QUESTIONS] == js["simple_quiz_questions"]
        assert NEUROLOGICAL_ROW["epa_dha_dose"] == js["neurological"]["epa"]

    def test_every_total_matches_the_consumer_engine(self):
        totals = list(range(11, 34))
        js = run_js({"assessment_totals": totals})
        for expected in js["assessment"]:
            # Build answers that sum to the total (1s then fill with 2s/3s).
            total = expected["total"]
            values = [1] * 11
            remaining = total - 11
            for index in range(11):
                bump = min(2, remaining)
                values[index] += bump
                remaining -= bump
            result = calculate_health_assessment(dict(zip(HA_KEYS, values)))
            assert result.total == total
            assert result.bucket == expected["bucket"]
            assert result.status == expected["status"]
            assert result.interpretation == expected["interpretation"]
            assert result.tone == expected["tone"]
            assert result.epa_dha_dose == expected["epa_dha_dose"]
            assert [list(line) for line in result.polyphenol_lines] == [[l["amount"], l["note"]] for l in expected["polyphenol_lines"]]

    @pytest.mark.parametrize("yes", [(), ("sleepy_after_meals",), tuple(SQ_KEYS[:5]), tuple(SQ_KEYS)])
    def test_simple_quiz_count_matches_the_consumer_engine(self, yes):
        answers = sq_answers(yes)
        js = run_js({"simple_quiz_answers": [[answers[key] for key in SQ_KEYS]]})["simple_quiz"][0]
        result = calculate_simple_quiz(answers)
        assert (result.yes_count, result.no_count, result.summary, result.progress_note) == (
            js["yes_count"], js["no_count"], js["summary"], js["progress_note"])

    def test_band_boundaries_and_dosage_thresholds(self):
        assert calculate_health_assessment(ha_answers()).bucket == "verylow"
        assert calculate_health_assessment(ha_answers(daily_performance=2)).bucket == "low"           # 12
        assert calculate_health_assessment(ha_answers(2, daily_performance=1, fatigue=1, headaches=1, skin_quality=1, sleep_quality=1)).total == 17
        assert calculate_health_assessment(ha_answers(2, daily_performance=1, fatigue=1, headaches=1, skin_quality=1, sleep_quality=1)).epa_dha_dose == "2.5g"
        assert calculate_health_assessment(ha_answers(2, daily_performance=1, fatigue=1, headaches=1, skin_quality=1)).total == 18
        assert calculate_health_assessment(ha_answers(2, daily_performance=1, fatigue=1, headaches=1, skin_quality=1)).epa_dha_dose == "5g"
        assert calculate_health_assessment(ha_answers(2)).total == 22
        assert calculate_health_assessment(ha_answers(2)).bucket == "moderate"
        assert calculate_health_assessment(ha_answers(2)).epa_dha_dose == "7.5g"
        assert calculate_health_assessment(ha_answers(3)).bucket == "poor"
        assert calculate_health_assessment(ha_answers(3, daily_performance=2)).bucket == "significant"  # 32

    def test_schemas_refuse_incomplete_or_foreign_answers(self):
        with pytest.raises(ValidationError, match="Missing"):
            HealthAssessmentInput(answers={k: 1 for k in HA_KEYS[:-1]})
        with pytest.raises(ValidationError, match="Unknown"):
            HealthAssessmentInput(answers={**ha_answers(), "mood": 1})
        with pytest.raises(ValidationError):
            HealthAssessmentInput(answers=ha_answers(4))
        with pytest.raises(ValidationError, match="Missing"):
            SimpleQuizInput(answers={k: "no" for k in SQ_KEYS[:-1]})
        with pytest.raises(ValidationError):
            SimpleQuizInput(answers={**sq_answers(), "sleepy_after_meals": "maybe"})


# ---------------------------------------------------------------- member API
class TestMemberApi:
    def test_health_assessment_definition_calculate_history_and_retake(self, member_client):
        definition = member_client.get("/api/v1/health-assessment/definition").json()
        assert [q["key"] for q in definition["questions"]] == list(HA_KEYS)
        assert definition["questions"][0]["options"][0] == {"value": 1, "label": "Very good"}
        assert definition["calculation_version"] == HEALTH_ASSESSMENT_CALCULATION_VERSION

        assert member_client.get("/api/v1/members/me/health-assessment").json()["history"] == []
        first = member_client.post("/api/v1/health-assessment/calculate", json={"input": {"answers": ha_answers(2)}})
        assert first.status_code == 201, first.text
        body = first.json()
        assert body["total"] == 22 and body["status"] == "Moderate Inflammation" and body["epa_dha_dose"] == "7.5g"
        assert body["interpretation"].startswith("On a scale of 11 to 33")
        assert body["calculation_version"] == HEALTH_ASSESSMENT_CALCULATION_VERSION

        # Retake: a second attempt is a new dated row; the first is unchanged.
        second = member_client.post("/api/v1/health-assessment/calculate", json={"input": {"answers": ha_answers(1)}})
        assert second.status_code == 201
        history = member_client.get("/api/v1/members/me/health-assessment").json()
        assert [h["total"] for h in history["history"]] == [11, 22]
        assert history["latest"]["attempt_id"] == second.json()["attempt_id"]
        assert history["history"][1]["answers"] == ha_answers(2)

        bad = member_client.post("/api/v1/health-assessment/calculate", json={"input": {"answers": ha_answers(2, fatigue=9)}})
        assert bad.status_code == 422

    def test_simple_quiz_calculate_history_and_retake(self, member_client):
        definition = member_client.get("/api/v1/simple-quiz/definition").json()
        assert [q["key"] for q in definition["questions"]] == list(SQ_KEYS)
        assert definition["questions"][0]["label"] == "Are you sleepy after meals?"

        first = member_client.post("/api/v1/simple-quiz/calculate", json={"input": {"answers": sq_answers(("need_coffee", "crave_sweets"))}})
        assert first.status_code == 201, first.text
        assert first.json()["summary"] == "6 No / 2 Yes"
        assert first.json()["yes_count"] == 2 and first.json()["no_count"] == 6
        assert first.json()["calculation_version"] == SIMPLE_QUIZ_CALCULATION_VERSION
        # The quiz is a count: no tier, no dose, nothing else.
        assert set(first.json()) == {"member_id", "attempt_id", "answers", "yes_count", "no_count", "summary",
                                     "progress_note", "calculation_version", "completed_at"}

        second = member_client.post("/api/v1/simple-quiz/calculate", json={"input": {"answers": sq_answers()}})
        assert second.status_code == 201
        history = member_client.get("/api/v1/members/me/simple-quiz").json()
        assert [h["yes_count"] for h in history["history"]] == [0, 2]
        assert history["history"][1]["answers"]["need_coffee"] == "yes"

    def test_simple_quiz_never_changes_the_health_number(self, member_client):
        """PRODUCT RULE: the Simple Quiz is a separate tracker."""
        saved = member_client.post("/api/v1/health-number/calculate", json={"answers": hn_answers()})
        assert saved.status_code == 201, saved.text
        before = member_client.get("/api/v1/members/me/health-number").json()

        for yes in ((), tuple(SQ_KEYS), ("chronic_disease",)):
            assert member_client.post("/api/v1/simple-quiz/calculate", json={"input": {"answers": sq_answers(yes)}}).status_code == 201
        assert member_client.post("/api/v1/health-assessment/calculate", json={"input": {"answers": ha_answers(3)}}).status_code == 201

        after = member_client.get("/api/v1/members/me/health-number").json()
        assert after == before
        assert len(after["history"]) == 1
        assert after["latest"]["displayed_score"] == before["latest"]["displayed_score"]

    def test_anonymous_and_other_members_are_refused(self, client):
        assert client.get("/api/v1/health-assessment/definition").status_code == 401
        assert client.post("/api/v1/simple-quiz/calculate", json={"input": {"answers": sq_answers()}}).status_code == 401
        sign_up(client)
        assert client.get("/api/v1/members/someone-else/health-assessment").status_code == 404
        assert client.get("/api/v1/members/someone-else/simple-quiz").status_code == 404


# ---------------------------------------------------------------- guided flows
class TestGuidedFlowConnection:
    def test_member_state_reflects_real_trackers(self, member_client):
        from uuid import UUID

        from app.db.session import SessionLocal
        from app.guided_flows.member_state import MemberStateService

        member_id = UUID(member_client.account["member_id"])
        with SessionLocal() as db:
            state = MemberStateService(db).snapshot(member_id)
        assert state["health_assessment_available"] is True and state["simple_quiz_available"] is True
        assert state["has_health_assessment"] is False and state["has_simple_quiz"] is False

        member_client.post("/api/v1/health-assessment/calculate", json={"input": {"answers": ha_answers()}})
        member_client.post("/api/v1/simple-quiz/calculate", json={"input": {"answers": sq_answers()}})
        with SessionLocal() as db:
            state = MemberStateService(db).snapshot(member_id)
        assert state["has_health_assessment"] is True and state["has_simple_quiz"] is True
