from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class HealthPermissionEventOut(BaseModel):
    """One transition, as evidence. Carries no health value of its own — only
    that a decision was made, by whom, from where, and against which wording."""

    id: UUID
    from_state: str
    to_state: str
    actor: str
    actor_name: str
    source: str
    policy_version: str
    created_at: datetime


class HealthPermissionOut(BaseModel):
    state: str
    state_label: str
    shares_health_data: bool
    # What the member last decided against, and what the words say today. When
    # they differ, the member decided against older wording.
    policy_version: str
    current_policy_version: str
    explanation: str
    requested_at: datetime | None
    requested_by_name: str
    decided_at: datetime | None
    revoked_at: datetime | None
    events: list[HealthPermissionEventOut] = []
