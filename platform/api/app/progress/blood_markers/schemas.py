from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator


MarkerStatus = Literal["optimal", "moderate", "high", "undefined"]
AaEpaSource = Literal["calculated", "entered"]
RecommendationState = Literal["none", "ok", "review"]

MARKER_KEYS = ("tg", "hdl", "insulin", "glucose", "aa", "epa", "hba1c")
CALCULATION_KEYS = ("tg_hdl", "homa_ir", "aa_epa", "hba1c")


class BloodMarkersInput(BaseModel):
    """Laboratory values as reported. Every field is optional: the approved
    screen accepts "the blood test results you have, whether all of them or
    only one or two". Units are the approved screen's: mg/dL for lipids and
    glucose, µU/mL for fasting insulin, percent for HbA1c."""

    model_config = ConfigDict(extra="forbid")

    tg: float | None = Field(default=None, gt=0, description="Triglycerides, mg/dL")
    hdl: float | None = Field(default=None, gt=0, description="HDL cholesterol, mg/dL")
    insulin: float | None = Field(default=None, gt=0, description="Fasting insulin, µU/mL")
    glucose: float | None = Field(default=None, gt=0, description="Fasting glucose, mg/dL")
    aa: float | None = Field(default=None, gt=0, description="Arachidonic acid")
    epa: float | None = Field(default=None, gt=0, description="Eicosapentaenoic acid")
    hba1c: float | None = Field(default=None, gt=0, description="HbA1c, percent")
    # Some laboratories report only the AA/EPA ratio, so it may be entered
    # directly (client: "calculated or fill in"). It is a lab-reported value,
    # not a client-side calculation, and only stands when AA and EPA are not
    # both supplied — otherwise the API calculates the ratio itself.
    aa_epa: float | None = Field(default=None, gt=0, description="AA/EPA ratio as reported by the laboratory")

    @model_validator(mode="after")
    def validate_entry(self):
        if all(getattr(self, key) is None for key in MARKER_KEYS) and self.aa_epa is None:
            raise ValueError("Please enter at least one marker value.")
        if self.aa is not None and self.epa is not None and self.aa_epa is not None:
            raise ValueError("Enter either AA and EPA (the ratio is calculated) or the reported AA/EPA ratio, not both.")
        return self


class BloodMarkersRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    input: BloodMarkersInput


class BloodMarkersRecommendation(BaseModel):
    state: RecommendationState
    epa_dha_dose: str | None
    lead: str | None


class BloodMarkersHistoryItem(BaseModel):
    attempt_id: UUID
    markers: dict[str, float | None]
    tg_hdl: float | None
    homa_ir: float | None
    aa_epa: float | None
    aa_epa_source: AaEpaSource | None
    in_range: dict[str, bool | None]
    classification: dict[str, MarkerStatus | None]
    recommendation: BloodMarkersRecommendation
    calculation_version: str
    completed_at: datetime


class BloodMarkersResult(BloodMarkersHistoryItem):
    member_id: UUID


class BloodMarkersHistoryResponse(BaseModel):
    member_id: UUID
    latest: BloodMarkersHistoryItem | None
    history: list[BloodMarkersHistoryItem]
