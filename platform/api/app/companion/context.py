"""MemberContextService: the only Companion-facing route to member data.

It returns short structured summaries for the scopes the policy decision
allows — never a whole record, never a direct identifier. The summary models
use `extra="forbid"`, so a field that is not declared here cannot exist in the
context at all (the structural allowlist)."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from app.assessments.repository import health_number_history
from app.auth.principal import CurrentPrincipal
from app.companion.personalization import MEMBER_FIRST_NAME_TOKEN
from app.companion.policy import MEMBER_DATA_SCOPES, PolicyDecision
from app.progress.blood_markers.repository import blood_markers_history
from app.progress.body_composition.repository import body_composition_history


class _Summary(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class HealthNumberSummary(_Summary):
    displayed_score: float
    status: str
    category: str
    completed_month: str
    attempts: int
    trend: Literal["improved", "higher", "unchanged", "first"]


class BodyCompositionSummary(_Summary):
    bmi: float | None
    body_fat_percent: int | None
    body_fat_available: bool
    completed_month: str
    attempts: int


class BloodMarkerSummary(_Summary):
    in_range: dict[str, bool | None]
    classification: dict[str, str | None]
    recommendation_state: str
    completed_month: str
    attempts: int


class UnavailableSummary(_Summary):
    available: Literal[False] = False
    reason: str


class MemberContext(_Summary):
    """Everything the prompt may know about the member. Note what is absent:
    no name, email, phone, birth date, address, account or member id."""

    scopes: tuple[str, ...]
    personalization_token: str = MEMBER_FIRST_NAME_TOKEN
    health_number: HealthNumberSummary | UnavailableSummary | None = None
    body_composition: BodyCompositionSummary | UnavailableSummary | None = None
    blood_markers: BloodMarkerSummary | UnavailableSummary | None = None
    mood: UnavailableSummary | None = None
    food_pattern: UnavailableSummary | None = None

    def lines(self) -> list[str]:
        """Prompt rendering: one line per scope, no identifiers."""
        out: list[str] = []
        if self.health_number is not None:
            hn = self.health_number
            if isinstance(hn, HealthNumberSummary):
                trend = {"improved": "improved since the previous result", "higher": "higher than the previous result",
                         "unchanged": "unchanged from the previous result", "first": "first result"}[hn.trend]
                out.append(f"- health_number: {hn.displayed_score:.1f} ({hn.status}; {hn.category} pattern; {trend}; "
                           f"{hn.attempts} result(s); latest {hn.completed_month}). Lower is better on the 1-10 scale.")
            else:
                out.append(f"- health_number: not available ({hn.reason})")
        if self.body_composition is not None:
            bc = self.body_composition
            if isinstance(bc, BodyCompositionSummary):
                fat = f"body fat {bc.body_fat_percent}%" if bc.body_fat_available else "body fat not available for those measurements"
                bmi = f"BMI {bc.bmi}" if bc.bmi is not None else "BMI not available"
                out.append(f"- body_composition: {bmi}; {fat}; {bc.attempts} result(s); latest {bc.completed_month}.")
            else:
                out.append(f"- body_composition: not available ({bc.reason})")
        if self.blood_markers is not None:
            bm = self.blood_markers
            if isinstance(bm, BloodMarkerSummary):
                flags = ", ".join(f"{k} {'in range' if v else 'out of range' if v is False else 'not entered'}" for k, v in bm.in_range.items())
                out.append(f"- blood_markers: {flags}; suggestion state {bm.recommendation_state}; {bm.attempts} result(s); latest {bm.completed_month}.")
            else:
                out.append(f"- blood_markers: not available ({bm.reason})")
        if self.mood is not None:
            out.append(f"- mood: not available ({self.mood.reason})")
        if self.food_pattern is not None:
            out.append(f"- food_pattern: not available ({self.food_pattern.reason})")
        return out


def _month(value: datetime) -> str:
    return value.strftime("%Y-%m")


class MemberContextService:
    def __init__(self, db: Session) -> None:
        self.db = db

    def build(self, principal: CurrentPrincipal, requested_scopes: list[str] | tuple[str, ...], decision: PolicyDecision) -> MemberContext:
        if not principal.is_member or principal.member_id is None:
            return MemberContext(scopes=())
        allowed = [s for s in requested_scopes if s in decision.member_data_scopes and s in MEMBER_DATA_SCOPES]
        context: dict = {"scopes": tuple(allowed)}
        member_id = principal.member_id
        if "health_number_summary" in allowed:
            history = health_number_history(self.db, member_id)
            if history:
                latest = history[0]
                previous = history[1] if len(history) > 1 else None
                if previous is None:
                    trend = "first"
                elif float(latest.displayed_score) < float(previous.displayed_score):
                    trend = "improved"
                elif float(latest.displayed_score) > float(previous.displayed_score):
                    trend = "higher"
                else:
                    trend = "unchanged"
                context["health_number"] = HealthNumberSummary(
                    displayed_score=float(latest.displayed_score), status=latest.status, category=latest.category,
                    completed_month=_month(latest.completed_at), attempts=len(history), trend=trend,
                )
            else:
                context["health_number"] = UnavailableSummary(reason="no Health Number saved yet")
        if "body_composition_summary" in allowed:
            history = body_composition_history(self.db, member_id)
            if history:
                latest = history[0]
                context["body_composition"] = BodyCompositionSummary(
                    bmi=float(latest.bmi) if latest.bmi is not None else None, body_fat_percent=latest.body_fat_percent,
                    body_fat_available=latest.body_fat_percent is not None, completed_month=_month(latest.completed_at),
                    attempts=len(history),
                )
            else:
                context["body_composition"] = UnavailableSummary(reason="no Body Composition saved yet")
        if "blood_marker_summary" in allowed:
            history = blood_markers_history(self.db, member_id)
            if history:
                latest = history[0]
                context["blood_markers"] = BloodMarkerSummary(
                    in_range=dict(latest.results.get("in_range", {})), classification=dict(latest.results.get("classification", {})),
                    recommendation_state=str(latest.results.get("recommendation", {}).get("state", "none")),
                    completed_month=_month(latest.completed_at), attempts=len(history),
                )
            else:
                context["blood_markers"] = UnavailableSummary(reason="no Blood Test Markers saved yet")
        if "mood_summary" in allowed:
            context["mood"] = UnavailableSummary(reason="the Mood Tracker is not connected in the Veye application yet")
        if "food_pattern_summary" in allowed:
            context["food_pattern"] = UnavailableSummary(reason="the Food Diary is not connected in the Veye application yet")
        return MemberContext(**context)
