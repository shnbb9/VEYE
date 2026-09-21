from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, field_validator

from app.progress.simple_quiz.service import QUESTION_KEYS

YesNo = Literal["yes", "no"]


class SimpleQuizInput(BaseModel):
    """All eight questions answered yes or no."""

    model_config = ConfigDict(extra="forbid")
    answers: dict[str, YesNo]

    @field_validator("answers")
    @classmethod
    def all_questions_answered(cls, value: dict[str, str]) -> dict[str, str]:
        missing = [key for key in QUESTION_KEYS if key not in value]
        unknown = [key for key in value if key not in QUESTION_KEYS]
        if missing:
            raise ValueError("Please answer every question. Missing: " + ", ".join(missing))
        if unknown:
            raise ValueError("Unknown question: " + ", ".join(unknown))
        return {key: value[key] for key in QUESTION_KEYS}


class SimpleQuizRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    input: SimpleQuizInput


class SimpleQuizDefinition(BaseModel):
    questions: list[dict]  # [{key, label}] in the approved order
    total_questions: int
    progress_note: str
    calculation_version: str


class SimpleQuizHistoryItem(BaseModel):
    attempt_id: UUID
    answers: dict[str, str]
    yes_count: int
    no_count: int
    summary: str
    progress_note: str
    calculation_version: str
    completed_at: datetime


class SimpleQuizResult(SimpleQuizHistoryItem):
    member_id: UUID


class SimpleQuizHistoryResponse(BaseModel):
    member_id: UUID
    latest: SimpleQuizHistoryItem | None
    history: list[SimpleQuizHistoryItem]
