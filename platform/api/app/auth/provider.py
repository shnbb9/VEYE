"""Development authentication provider.

Clearly isolated: argon2id-hashed passwords held by VEYE itself and opaque
server-side sessions carried in an HttpOnly cookie. It exists so the product
can be built and demonstrated before the production identity provider is
chosen. It is not the production provider and must never be configured as
one."""

from __future__ import annotations

import hashlib
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import Request
from sqlalchemy.orm import Session

from app.auth.models import AuthSession, UserAccount
from app.auth.principal import CurrentPrincipal


def hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def new_token() -> str:
    return secrets.token_urlsafe(32)


@dataclass(frozen=True)
class IssuedSession:
    session: AuthSession
    cookie_value: str
    max_age_seconds: int


class DevelopmentSessionAuthProvider:
    name = "development"

    def __init__(self, *, cookie_name: str, session_hours: int, remember_days: int) -> None:
        self.cookie_name = cookie_name
        self.session_hours = session_hours
        self.remember_days = remember_days

    # ---- AuthProvider ------------------------------------------------------------
    def authenticate(self, request: Request, db: Session) -> CurrentPrincipal | None:
        raw = request.cookies.get(self.cookie_name)
        if not raw:
            return None
        session = self.resolve(db, raw)
        if session is None:
            return None
        return principal_for(session.user, session.id)

    # ---- sessions ---------------------------------------------------------------------
    def issue(self, db: Session, user: UserAccount, *, remember: bool) -> IssuedSession:
        raw = new_token()
        lifetime = timedelta(days=self.remember_days) if remember else timedelta(hours=self.session_hours)
        session = AuthSession(
            user_id=user.id, token_hash=hash_token(raw), remember=remember,
            expires_at=datetime.now(timezone.utc) + lifetime,
        )
        db.add(session)
        db.flush()
        return IssuedSession(session=session, cookie_value=raw, max_age_seconds=int(lifetime.total_seconds()))

    def resolve(self, db: Session, raw: str) -> AuthSession | None:
        session = db.query(AuthSession).filter(AuthSession.token_hash == hash_token(raw)).one_or_none()
        if session is None or session.revoked_at is not None:
            return None
        now = datetime.now(timezone.utc)
        if _aware(session.expires_at) <= now:
            return None
        user = session.user
        if user is None or not user.is_active:
            return None
        session.last_seen_at = now
        return session

    def revoke(self, db: Session, session_id: UUID) -> None:
        session = db.get(AuthSession, session_id)
        if session is not None and session.revoked_at is None:
            session.revoked_at = datetime.now(timezone.utc)
            db.flush()

    def revoke_all(self, db: Session, user_id: UUID) -> int:
        now = datetime.now(timezone.utc)
        rows = db.query(AuthSession).filter(AuthSession.user_id == user_id, AuthSession.revoked_at.is_(None)).all()
        for row in rows:
            row.revoked_at = now
        db.flush()
        return len(rows)


def principal_for(user: UserAccount, session_id: UUID | None) -> CurrentPrincipal:
    return CurrentPrincipal(
        user_id=user.id, role=user.role, email=user.email, first_name=user.first_name, last_name=user.last_name,
        member_id=user.member_id, email_verified=user.email_verified_at is not None,
        session_id=session_id, is_synthetic=user.is_synthetic,
    )


def _aware(value: datetime) -> datetime:
    # SQLite returns naive datetimes; treat them as UTC.
    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)
