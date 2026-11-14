"""How long an unsigned-up visitor's saved result is kept.

Five choices, exactly as the product asked for them: Never, 15, 30, 45 days,
Forever. They are not interchangeable with each other in either direction:

  * **Never** means nothing is saved at all — the result is a preview, and no
    screen may call it saved. It is also the built-in default until an owner
    publishes a policy, because collecting health answers under wording nobody
    has approved is the one irreversible choice here.
  * **15 / 30 / 45 days** stamp `expires_at` on the record when it is captured,
    from the capture time, together with the policy version it was captured
    under. That stamp is the person's agreement and only ever moves earlier.
  * **Forever** means no automatic expiry. It is never selected silently and
    never converted to a number of days; erasure requests still apply.

A new policy applies to new captures. Existing records keep the expiry they
were captured with unless an administrator explicitly applies a *shorter*
policy to them — lengthening an agreement after the fact is not something the
console can do.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Literal

from pydantic import BaseModel, ConfigDict, model_validator
from sqlalchemy.orm import Session

from app.policies.service import PolicyStore, aware

RETENTION_KEY = "prospect_retention"

MODE_NEVER = "never"
MODE_DAYS = "days"
MODE_FOREVER = "forever"
ALLOWED_DAYS = (15, 30, 45)


class RetentionValue(BaseModel):
    """The stored shape of one published retention policy."""

    model_config = ConfigDict(extra="forbid")

    mode: Literal["never", "days", "forever"]
    days: int | None = None

    @model_validator(mode="after")
    def _days_match_mode(self) -> "RetentionValue":
        if self.mode == MODE_DAYS:
            if self.days not in ALLOWED_DAYS:
                raise ValueError(f"Choose {', '.join(str(d) for d in ALLOWED_DAYS)} days.")
        elif self.days is not None:
            raise ValueError("Only a number of days carries a day count.")
        return self


@dataclass(frozen=True)
class RetentionPolicy:
    mode: str
    days: int | None
    # 0 = the built-in default: nothing has ever been published.
    version: int
    published_at: datetime | None = None
    published_by: str = ""

    @property
    def saving_enabled(self) -> bool:
        return self.mode != MODE_NEVER

    @property
    def label(self) -> str:
        if self.mode == MODE_NEVER:
            return "Never (preview only, nothing saved)"
        if self.mode == MODE_FOREVER:
            return "Forever (until deleted)"
        return f"{self.days} days"

    @property
    def visitor_phrase(self) -> str:
        """How long, in the words a visitor reads before agreeing."""
        if self.mode == MODE_FOREVER:
            return "until you or Veye delete them"
        if self.mode == MODE_DAYS:
            return f"for {self.days} days"
        return ""

    @property
    def length(self) -> float:
        """Comparable size: Never < 15 < 30 < 45 < Forever."""
        if self.mode == MODE_NEVER:
            return 0.0
        if self.mode == MODE_FOREVER:
            return math.inf
        return float(self.days or 0)

    def expires_at(self, captured_at: datetime) -> datetime | None:
        if self.mode == MODE_DAYS and self.days:
            return aware(captured_at) + timedelta(days=self.days)
        if self.mode == MODE_NEVER:
            # Never captures nothing; this is only reached when an explicit
            # "apply shorter" moves existing records to Never — they expire now.
            return aware(captured_at)
        return None

    def value(self) -> dict:
        return {"mode": self.mode, "days": self.days}


DEFAULT_RETENTION = RetentionPolicy(mode=MODE_NEVER, days=None, version=0)


def current_retention(db: Session) -> RetentionPolicy:
    row = PolicyStore(db).current(RETENTION_KEY)
    if row is None:
        return DEFAULT_RETENTION
    value = RetentionValue.model_validate(row.value)
    return RetentionPolicy(mode=value.mode, days=value.days, version=int(row.version or 0),
                           published_at=aware(row.published_at), published_by=row.published_by_name or "")


def policy_from(value: RetentionValue, version: int = 0) -> RetentionPolicy:
    return RetentionPolicy(mode=value.mode, days=value.days, version=version)
