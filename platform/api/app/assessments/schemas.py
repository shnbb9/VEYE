from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

Goal = Literal["Manage Current Chronic Diseases", "Prevent Future Disease", "Live a Healthier Lifestyle", "Better Mental Focus", "Lose Body Fat", "Other"]
Plan = Literal["Weight Watchers", "Noom", "Jenny Craig", "The Mediterranean Diet", "DASH", "ATKINS", "Keto", "Intermittent Fasting", "Fasting", "Other", "No other plans"]
Activity = Literal["None", "Light (I work, I walk some)", "Moderate (I exercise 1-3 times a week)", "Heavy (I exercise 3x+ times per week)"]
YesNo = Literal["yes", "no"]
# The approved onboarding offers a written-in "Other" for dietary preference
# and referral source (Q11/Q12 score 0 whatever is chosen); the text is
# metadata only.
Diet = Literal["Vegetarian", "Vegan", "Raw food", "Fish and no meat", "Fish/chicken/turkey and no red meat", "Gluten free", "Dairy free", "No preference", "Other"]
Source = Literal["Instagram", "Facebook", "On-line search", "Friends or Family", "Recommended by a doctor", "Other"]


class HealthNumberAnswers(BaseModel):
    model_config = ConfigDict(extra="forbid")
    goals: list[Goal] = Field(min_length=1)
    plans: list[Plan] = Field(min_length=1)
    activity: Activity
    meditate: YesNo
    tired: YesNo
    gainWeight: YesNo
    abdomenWeight: YesNo
    sleepEnough: YesNo
    sleepWell: YesNo
    sleepHours: float = Field(ge=0, le=24)
    diet: Diet
    source: Source
    # Write-ins document what the member selected. They do not alter points.
    other_goal: str | None = Field(default=None, max_length=240)
    other_plan: str | None = Field(default=None, max_length=240)
    other_diet: str | None = Field(default=None, max_length=240)
    other_source: str | None = Field(default=None, max_length=240)

    @model_validator(mode="after")
    def validate_plans(self):
        if "No other plans" in self.plans and len(self.plans) > 1:
            raise ValueError("No other plans cannot be combined with another plan")
        if len(set(self.plans)) != len(self.plans):
            raise ValueError("Plans must not contain duplicates")
        # The approved screens require the write-in when Other is the single
        # answer for diet or source (goals/plans keep it optional).
        if self.diet == "Other" and not (self.other_diet or "").strip():
            raise ValueError("Enter your dietary preference when choosing Other")
        if self.source == "Other" and not (self.other_source or "").strip():
            raise ValueError("Enter how you found out about Veye when choosing Other")
        return self


class HealthNumberRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    answers: HealthNumberAnswers


class HealthNumberPreview(BaseModel):
    """Calculated, not stored. Backs the public onboarding result before sign-up."""
    raw_score: float
    displayed_score: float
    status: str
    bucket: str
    category: str
    category_rule: str
    interpretation: str
    calculation_version: str
    points: dict[str, float]


class HealthNumberResponse(BaseModel):
    attempt_id: UUID
    member_id: UUID
    raw_score: float
    displayed_score: float
    status: str
    bucket: str
    category: str
    category_rule: str
    interpretation: str
    calculation_version: str
    points: dict[str, float]
    completed_at: datetime


class HealthNumberHistoryItem(BaseModel):
    attempt_id: UUID
    displayed_score: float
    status: str
    bucket: str
    category: str
    interpretation: str
    calculation_version: str
    completed_at: datetime


class HealthNumberHistoryResponse(BaseModel):
    member_id: UUID
    latest: HealthNumberHistoryItem | None
    history: list[HealthNumberHistoryItem]
