"""Rate limits for the endpoints that cost something or can be abused.

Sign-in has its own counter (`app/auth/throttle.py`) because it is a different
problem: two counters, one cleared by success, and a refusal that must not
reveal whether an account exists. Everything else shares this one.

**Why the database and not memory.** Cloud Run runs several instances of this
service, and a limiter that lives in a process limits one instance. Ten
instances would mean ten times the limit, which is not a limit. The row count
in a rolling window is slower and correct; at VEYE's scale correct is the only
consideration that matters.

**What is actually being protected.** Three different things, which is why the
buckets have different shapes:

  * money — a Companion message and a Personal Tip each call a paid model;
  * other people's mailboxes — sign-up, password reset and verification all
    send email to an address the caller typed, so an unlimited endpoint makes
    VEYE into a way to post mail to strangers;
  * the database — public Contact Us takes writes from anyone at all.

A refused request never reaches the thing it would have cost.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, Request, status
from sqlalchemy import DateTime, Index, String
from sqlalchemy.orm import Mapped, Session, mapped_column

from app.db.base import Base


class RateLimitEvent(Base):
    """One attempt at one bucket by one subject. Pruned by housekeeping."""

    __tablename__ = "rate_limit_events"
    __table_args__ = (Index("ix_rate_limit_events_lookup", "bucket", "subject", "created_at"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    bucket: Mapped[str] = mapped_column(String(48), nullable=False)
    # A member id, an account id, or a client address — whichever the bucket
    # counts. Never an email address a caller typed: that would make the table
    # a list of addresses somebody probed.
    subject: Mapped[str] = mapped_column(String(128), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False,
                                                 default=lambda: datetime.now(timezone.utc))


@dataclass(frozen=True)
class Limit:
    """A bucket's rule. `per_address` is the wider net for the same endpoint:
    one member is limited tightly, one network a little less so."""

    bucket: str
    per_subject: int
    window_minutes: int
    per_address: int | None = None

    @property
    def window(self) -> timedelta:
        return timedelta(minutes=self.window_minutes)


# The limits themselves. Generous enough that no honest person meets them, low
# enough that a script is stopped before it costs anything worth having.
LIMITS = {
    # Each of these calls a paid model.
    "companion_message": Limit("companion_message", per_subject=30, window_minutes=10, per_address=120),
    "personal_tip": Limit("personal_tip", per_subject=20, window_minutes=60, per_address=100),
    # Somebody who may not be safe, and is over the limit above. Answered from
    # fixed words, so this is about rows and not about a model; past it they
    # are still given the words, in the refusal.
    "companion_safety": Limit("companion_safety", per_subject=60, window_minutes=10),
    # Each of these sends email to an address the caller typed. Keyed on the
    # caller's address, and set high enough that an office or a household
    # behind one NAT is not mistaken for an attack.
    "signup": Limit("signup", per_subject=20, window_minutes=60),
    "forgot_password": Limit("forgot_password", per_subject=10, window_minutes=60),
    "resend_verification": Limit("resend_verification", per_subject=5, window_minutes=60),
    # Writes from anyone at all.
    "public_request": Limit("public_request", per_subject=10, window_minutes=60),
    # A member's requests: each one emails the team's support address.
    "member_request": Limit("member_request", per_subject=20, window_minutes=60),
    # Each member invitation emails an address an administrator typed.
    "member_invitation": Limit("member_invitation", per_subject=60, window_minutes=60),
    # Presenting an invitation token: 32 random bytes, so this is about load.
    "member_invitation_token": Limit("member_invitation_token", per_subject=60, window_minutes=60),
    # Uploads cost storage and CPU.
    "photo_upload": Limit("photo_upload", per_subject=20, window_minutes=60),
    # Food Diary photos: one per meal is ordinary, a few a day; a link makes
    # the API fetch from another website, so it is tighter and per address
    # too — the fetcher must never become a scanner aimed at someone else.
    "meal_photo": Limit("meal_photo", per_subject=60, window_minutes=60),
    "meal_photo_link": Limit("meal_photo_link", per_subject=20, window_minutes=60, per_address=60),
    # A visitor saving a quiz result: each one stores health answers and sends
    # an email to the address typed.
    "prospect_capture": Limit("prospect_capture", per_subject=20, window_minutes=60),
    # Presenting a saved-result token (status, confirm, delete). A token is 32
    # random bytes, so this is about load, not guessing.
    "prospect_token": Limit("prospect_token", per_subject=60, window_minutes=60),
    # "Email me a new link": per caller, and per address (hashed), so one
    # mailbox cannot be flooded from many callers either.
    "prospect_recover": Limit("prospect_recover", per_subject=10, window_minutes=60),
    "prospect_recover_address": Limit("prospect_recover_address", per_subject=3, window_minutes=60),
    # Proving the current password again before a sensitive change (creating
    # one's own member profile, deleting one's member data).
    "reauthenticate": Limit("reauthenticate", per_subject=10, window_minutes=60, per_address=50),
    # A test of the sharing-request email goes to the administrator's own
    # address; a handful an hour is plenty.
    "template_test": Limit("template_test", per_subject=10, window_minutes=60),
}


def client_address(request: Request) -> str:
    """The caller's address, as far as it can be believed.

    Every proxy APPENDS the address it received the request from, so only the
    last entries of X-Forwarded-For — one per proxy we run — were written by
    something we trust. Everything before them is whatever the caller sent:
    reading the first entry let anyone reset their own limit by inventing one.
    With no proxy configured the header is not read at all."""
    from app.core.config import settings

    hops = settings.trusted_proxy_hops
    if hops > 0:
        entries = [entry.strip() for entry in request.headers.get("x-forwarded-for", "").split(",") if entry.strip()]
        if len(entries) >= hops:
            return entries[-hops][:64]
    return (request.client.host if request.client else "")[:64]


@dataclass(frozen=True)
class Refusal:
    retry_after: int
    scope: str


class RateLimiter:
    def __init__(self, db: Session, settings=None) -> None:
        self.db = db
        if settings is None:
            from app.core.config import settings as configured

            settings = configured
        # Never below 1: the scale raises a limit for an environment that
        # legitimately produces more traffic, it does not lower one.
        self.scale = max(1.0, float(getattr(settings, "rate_limit_scale", 1.0) or 1.0))

    def _allowance(self, value: int) -> int:
        return max(1, int(value * self.scale))

    def check(self, bucket: str, *, subject: str, address: str = "") -> Refusal | None:
        """Whether this attempt is over the limit. Called *before* the work."""
        limit = LIMITS.get(bucket)
        if limit is None or limit.per_subject <= 0:
            return None
        since = datetime.now(timezone.utc) - limit.window

        if subject:
            hits = self._events(limit.bucket, subject, since)
            if len(hits) >= self._allowance(limit.per_subject):
                return Refusal(self._retry_after(hits[0], limit), "subject")
        if limit.per_address and address:
            hits = self._events(limit.bucket, f"ip:{address}", since)
            if len(hits) >= self._allowance(limit.per_address):
                return Refusal(self._retry_after(hits[0], limit), "address")
        return None

    def record(self, bucket: str, *, subject: str, address: str = "") -> None:
        if bucket not in LIMITS:
            return
        if subject:
            self.db.add(RateLimitEvent(bucket=bucket, subject=subject))
        if LIMITS[bucket].per_address and address:
            self.db.add(RateLimitEvent(bucket=bucket, subject=f"ip:{address}"))
        self.db.flush()

    def enforce(self, bucket: str, *, subject: str, address: str = "") -> None:
        """Refuse or record. The caller does the expensive thing afterwards, so
        nothing is paid for by a request that was over the limit."""
        refusal = self.check(bucket, subject=subject, address=address)
        if refusal is not None:
            minutes = max(1, round(refusal.retry_after / 60))
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"That is more than we can take just now. Try again in about {minutes} "
                       f"minute{'' if minutes == 1 else 's'}.",
                headers={"Retry-After": str(refusal.retry_after)},
            )
        self.record(bucket, subject=subject, address=address)

    # ---- internals -----------------------------------------------------------
    def _events(self, bucket: str, subject: str, since: datetime) -> list[RateLimitEvent]:
        return (self.db.query(RateLimitEvent)
                .filter(RateLimitEvent.bucket == bucket, RateLimitEvent.subject == subject,
                        RateLimitEvent.created_at >= since)
                .order_by(RateLimitEvent.created_at).all())

    @staticmethod
    def _retry_after(oldest: RateLimitEvent, limit: Limit) -> int:
        """When the oldest attempt leaves the window, one more is allowed."""
        at = oldest.created_at
        if at.tzinfo is None:
            at = at.replace(tzinfo=timezone.utc)
        seconds = (at + limit.window - datetime.now(timezone.utc)).total_seconds()
        return max(1, int(seconds) + 1)


def prune_rate_limit_events(db: Session, *, older_than_hours: int = 48) -> int:
    """Housekeeping: nothing here is evidence, so it does not accumulate."""
    cutoff = datetime.now(timezone.utc) - timedelta(hours=older_than_hours)
    removed = db.query(RateLimitEvent).filter(RateLimitEvent.created_at < cutoff).delete(synchronize_session=False)
    db.flush()
    return int(removed or 0)
