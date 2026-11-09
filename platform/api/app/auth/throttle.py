"""Brute-force protection for sign-in.

Guessing a password is the one attack every deployment gets for free, and the
development provider holds the passwords itself, so the limit belongs here
rather than in a proxy nobody has configured yet.

Two counters over the same rolling window:

  * per **identity** — the address that was typed, whether or not an account
    exists for it, so probing a real account is no cheaper than probing a
    made-up one. A successful sign-in clears it: the person who knows the
    password is never locked out by their own typos.
  * per **client address** — a higher limit that catches one source spraying
    many accounts. Success never clears this one, or spraying would reset it
    by hitting any correct password.

The refusal is deliberately identical for a locked identity and a wrong
password beyond saying to wait: it must not become a way to discover which
addresses exist.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import Boolean, DateTime, String
from sqlalchemy.orm import Mapped, Session, mapped_column

from app.core.config import Settings
from app.db.base import Base


class SignInAttempt(Base):
    __tablename__ = "auth_sign_in_attempts"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(320), nullable=False, index=True)
    client_ip: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    portal: Mapped[str] = mapped_column(String(16), nullable=False)
    succeeded: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False,
                                                 default=lambda: datetime.now(timezone.utc))


@dataclass(frozen=True)
class Lockout:
    """Why a sign-in was refused before the password was even checked."""

    scope: str          # identity | address
    retry_after: int    # whole seconds


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)


class SignInThrottle:
    def __init__(self, db: Session, settings: Settings) -> None:
        self.db = db
        self.settings = settings

    @property
    def _window(self) -> timedelta:
        return timedelta(minutes=self.settings.sign_in_window_minutes)

    def locked(self, email: str, client_ip: str) -> Lockout | None:
        """The lockout in force for this attempt, if any. Called before the
        password is looked at, so a locked identity costs the attacker a
        request and tells them nothing."""
        if self.settings.sign_in_max_failures <= 0:
            return None
        since = datetime.now(timezone.utc) - self._window
        identity = self._failures(since, email=email)
        if len(identity) >= self.settings.sign_in_max_failures:
            return Lockout(scope="identity", retry_after=self._retry_after(identity))
        if client_ip:
            address = self._failures(since, client_ip=client_ip)
            if len(address) >= self.settings.sign_in_max_failures_per_address:
                return Lockout(scope="address", retry_after=self._retry_after(address))
        return None

    def record(self, *, email: str, client_ip: str, portal: str, succeeded: bool) -> None:
        self.db.add(SignInAttempt(email=email.strip().lower(), client_ip=client_ip or "",
                                  portal=portal, succeeded=succeeded))
        if succeeded:
            # The person proved they know the password: their own failures stop
            # counting. The address counter is left alone on purpose.
            self._clear_identity(email)
        self.db.flush()

    # ---- internals ------------------------------------------------------------------
    def _failures(self, since: datetime, *, email: str | None = None, client_ip: str | None = None) -> list[SignInAttempt]:
        query = (self.db.query(SignInAttempt)
                 .filter(SignInAttempt.succeeded.is_(False), SignInAttempt.created_at >= since))
        if email is not None:
            query = query.filter(SignInAttempt.email == email.strip().lower())
        if client_ip is not None:
            query = query.filter(SignInAttempt.client_ip == client_ip)
        return query.order_by(SignInAttempt.created_at).all()

    def _retry_after(self, failures: list[SignInAttempt]) -> int:
        """When the oldest failure leaves the window, the attempt that follows
        it is allowed again."""
        oldest = _aware(failures[0].created_at)
        seconds = (oldest + self._window - datetime.now(timezone.utc)).total_seconds()
        return max(1, int(seconds) + 1)

    def _clear_identity(self, email: str) -> None:
        (self.db.query(SignInAttempt)
         .filter(SignInAttempt.email == email.strip().lower(), SignInAttempt.succeeded.is_(False))
         .delete(synchronize_session=False))


def client_address(request) -> str:
    """The caller's address as this deployment can see it.

    Behind the reference Nginx the real address arrives in `X-Forwarded-For`;
    locally there is no proxy and `request.client` is the truth. Only the
    first hop is used, and it is never echoed back to anyone.
    """
    forwarded = (request.headers.get("x-forwarded-for") or "").split(",")[0].strip()
    if forwarded:
        return forwarded[:64]
    client = getattr(request, "client", None)
    return (client.host if client else "")[:64]
