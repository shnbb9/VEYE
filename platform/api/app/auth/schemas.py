from datetime import datetime
from uuid import UUID

import re
from typing import Annotated

from pydantic import AfterValidator, BaseModel, ConfigDict, Field

from app.assessments.schemas import HealthNumberAnswers

# The approved prototype's own address rule. Synthetic reserved domains
# (.test, .local) must remain valid for the local demo accounts.
_EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$")


def _email(value: str) -> str:
    value = value.strip().lower()
    if len(value) > 320 or not _EMAIL_RE.match(value):
        raise ValueError("Please enter a valid email address.")
    return value


EmailAddress = Annotated[str, AfterValidator(_email)]


class AccountOut(BaseModel):
    id: UUID
    email: str
    role: str
    first_name: str
    last_name: str
    member_id: UUID | None
    email_verified: bool
    is_synthetic: bool
    created_at: datetime


class DeliveryOut(BaseModel):
    kind: str
    status: str
    detail: str | None = None


class SignUpRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    first_name: str = Field(min_length=1, max_length=120)
    last_name: str = Field(min_length=1, max_length=120)
    email: EmailAddress
    password: str = Field(min_length=1, max_length=256)
    confirm_password: str | None = Field(default=None, max_length=256)
    phone: str | None = Field(default=None, max_length=40)
    postal_code: str | None = Field(default=None, max_length=20)
    remember: bool = True
    # The approved onboarding runs the assessment before sign-up; the answers
    # are attached here so the saved Health Number is still calculated and
    # stored by the API.
    health_number_answers: HealthNumberAnswers | None = None


class SignUpResponse(BaseModel):
    account: AccountOut
    deliveries: list[DeliveryOut]
    health_number_attempt_id: UUID | None = None


class SignInRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    email: EmailAddress
    password: str = Field(min_length=1, max_length=256)
    remember: bool = True


class SessionResponse(BaseModel):
    account: AccountOut


class OptionalSessionResponse(BaseModel):
    account: AccountOut | None


class TokenRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    token: str = Field(min_length=10, max_length=256)


class ForgotPasswordRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    email: EmailAddress


class ForgotPasswordResponse(BaseModel):
    accepted: bool
    message: str
    # Present outside production only, so the local demo can show whether the
    # message actually reached the development mailbox.
    delivery: DeliveryOut | None = None


class ResetPasswordRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    token: str = Field(min_length=10, max_length=256)
    password: str = Field(min_length=1, max_length=256)


class OkResponse(BaseModel):
    ok: bool = True
    message: str | None = None


class NotificationPreferencesOut(BaseModel):
    preferences: dict[str, bool]


class NotificationPreferenceUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: str
    email_enabled: bool
