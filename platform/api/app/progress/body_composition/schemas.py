from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator


Sex = Literal["Woman", "Man"]


class BodyCompositionInput(BaseModel):
    """Measurements use the inches/pounds units of the approved VEYE tables."""

    model_config = ConfigDict(extra="forbid")

    sex: Sex
    weight: float = Field(gt=0)
    height: float = Field(gt=0)
    abdomen: float | None = Field(default=None, gt=0)
    hips: float | None = Field(default=None, gt=0)
    waist: float | None = Field(default=None, gt=0)
    wrist: float | None = Field(default=None, gt=0)

    @model_validator(mode="after")
    def validate_measurements_for_sex(self):
        if self.sex == "Woman":
            if self.abdomen is None or self.hips is None:
                raise ValueError("Women need abdomen and hips measurements.")
            if self.waist is not None or self.wrist is not None:
                raise ValueError("Waist and wrist measurements apply only to men.")
        else:
            if self.waist is None or self.wrist is None:
                raise ValueError("Men need waist and wrist measurements.")
            if self.abdomen is not None or self.hips is not None:
                raise ValueError("Abdomen and hips measurements apply only to women.")
        return self


class BodyCompositionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    input: BodyCompositionInput


class BodyCompositionResult(BaseModel):
    attempt_id: UUID
    member_id: UUID
    sex: Sex
    bmi: float | None
    body_fat_percent: int | None
    fat_mass_lb: float | None
    lean_mass_lb: float | None
    body_fat_available: bool
    unavailable_reason: str | None
    calculation_version: str
    completed_at: datetime


class BodyCompositionHistoryItem(BaseModel):
    attempt_id: UUID
    sex: Sex
    # The member's own submitted measurements, so a retake starts from them
    # (the approved prototype restores the last saved values into the form).
    measurements: dict[str, float | str]
    bmi: float | None
    body_fat_percent: int | None
    fat_mass_lb: float | None
    lean_mass_lb: float | None
    body_fat_available: bool
    unavailable_reason: str | None
    calculation_version: str
    completed_at: datetime


class BodyCompositionHistoryResponse(BaseModel):
    member_id: UUID
    latest: BodyCompositionHistoryItem | None
    history: list[BodyCompositionHistoryItem]
