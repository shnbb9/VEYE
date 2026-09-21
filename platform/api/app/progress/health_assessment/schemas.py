from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.progress.health_assessment.service import QUESTION_KEYS, TIER_VALUES

Tier = Literal[1, 2, 3]


class HealthAssessmentInput(BaseModel):
    """Every one of the 11 questions answered with 1 (first, healthiest
    choice), 2 (middle) or 3 (third)."""

    model_config = ConfigDict(extra="forbid")
    answers: dict[str, Tier]

    @field_validator("answers")
    @classmethod
    def all_questions_answered(cls, value: dict[str, int]) -> dict[str, int]:
        missing = [key for key in QUESTION_KEYS if key not in value]
        unknown = [key for key in value if key not in QUESTION_KEYS]
        if missing:
            raise ValueError("Please answer every question. Missing: " + ", ".join(missing))
        if unknown:
            raise ValueError("Unknown question: " + ", ".join(unknown))
        if any(v not in TIER_VALUES for v in value.values()):
            raise ValueError("Each answer is 1, 2 or 3.")
        return {key: value[key] for key in QUESTION_KEYS}


class HealthAssessmentRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    input: HealthAssessmentInput


class QuestionOut(BaseModel):
    key: str
    label: str
    options: list[dict]  # [{value: 1, label: "…"}, …] — first is the healthiest
    info: str


class HealthAssessmentDefinition(BaseModel):
    """The questionnaire as the approved screen prints it, served from the
    one place the calculation lives so the browser never carries its own copy."""

    questions: list[QuestionOut]
    scale_min: int
    scale_max: int
    polyphenol_lines: list[dict]
    neurological_row: dict
    calculation_version: str


class HealthAssessmentHistoryItem(BaseModel):
    attempt_id: UUID
    answers: dict[str, int]
    total: int
    bucket: str
    status: str
    interpretation: str
    tone: str
    epa_dha_dose: str
    polyphenol_lines: list[dict]
    calculation_version: str
    completed_at: datetime


class HealthAssessmentResult(HealthAssessmentHistoryItem):
    member_id: UUID


class HealthAssessmentHistoryResponse(BaseModel):
    member_id: UUID
    latest: HealthAssessmentHistoryItem | None
    history: list[HealthAssessmentHistoryItem]
