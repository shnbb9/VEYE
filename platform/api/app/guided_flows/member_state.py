"""MemberStateService: the approved application facts a guided flow may branch
on. It answers only the questions in `engine.MEMBER_STATES`, through the
domain repositories — never an arbitrary table, never from a model."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.orm import Session

from app.assessments.repository import health_number_history
from app.guided_flows.engine import MEMBER_STATES
from app.progress.blood_markers.repository import blood_markers_history
from app.progress.body_composition.repository import body_composition_history

# Trackers connected in the Veye application today. The Health Assessment
# (Cara's "Health Status Report" / "HSR" / "Health Questionnaire" — canonical
# id health_assessment), the Simple Quiz and Food Choices are member sections
# without a production slice yet, so a flow must not pretend they can be completed.
TRACKER_AVAILABILITY = {
    "blood_markers": True,
    "body_composition": True,
    "health_assessment": False,
    "simple_quiz": False,
    "food_choices": False,
}


class MemberStateService:
    def __init__(self, db: Session) -> None:
        self.db = db

    def snapshot(self, member_id: UUID) -> dict[str, bool]:
        state = {
            "has_blood_markers": bool(blood_markers_history(self.db, member_id)),
            "has_body_composition": bool(body_composition_history(self.db, member_id)),
            "has_health_number": bool(health_number_history(self.db, member_id)),
            "has_health_assessment": False,  # not connected yet
            "has_simple_quiz": False,        # not connected yet
            "has_food_choices": False,       # not connected yet
            "blood_markers_available": TRACKER_AVAILABILITY["blood_markers"],
            "body_composition_available": TRACKER_AVAILABILITY["body_composition"],
            "health_assessment_available": TRACKER_AVAILABILITY["health_assessment"],
            "simple_quiz_available": TRACKER_AVAILABILITY["simple_quiz"],
            "food_choices_available": TRACKER_AVAILABILITY["food_choices"],
        }
        assert set(state) == set(MEMBER_STATES), "member-state snapshot must answer exactly the engine's questions"
        return state
