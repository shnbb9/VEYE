"""Pruning the rows authentication leaves behind.

Sessions, single-use tokens and sign-in attempts all accumulate: a seeded
administrator here had hundreds of dead session rows, which is how the
"sign out everywhere else" count came to disagree with the list above it.
Nothing is scheduled in this deployment, so the tidying happens where it is
cheap and naturally rate-limited — after a successful sign-in, for that one
account, plus the attempt log that the throttle no longer needs.

Only rows that can never be used again are removed: a revoked or expired
session, a consumed or expired token. A live session is never touched, so
this can never sign anybody out.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.auth.models import AuthSession, AuthToken
from app.auth.throttle import SignInAttempt
from app.core.config import Settings


def prune_account(db: Session, user_id: UUID, settings: Settings) -> dict[str, int]:
    """Dead sessions and spent tokens for one account."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=settings.auth_retention_days)
    sessions = (db.query(AuthSession)
                .filter(AuthSession.user_id == user_id,
                        or_(AuthSession.revoked_at < cutoff, AuthSession.expires_at < cutoff))
                .delete(synchronize_session=False))
    tokens = (db.query(AuthToken)
              .filter(AuthToken.user_id == user_id,
                      or_(AuthToken.used_at < cutoff, AuthToken.expires_at < cutoff))
              .delete(synchronize_session=False))
    return {"sessions": sessions or 0, "tokens": tokens or 0}


def prune_sign_in_attempts(db: Session, settings: Settings) -> int:
    """Attempts older than the throttle's own window are no longer counted by
    anything, so they are only taking up space."""
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=max(settings.sign_in_window_minutes * 4, 60))
    return (db.query(SignInAttempt)
            .filter(SignInAttempt.created_at < cutoff)
            .delete(synchronize_session=False)) or 0


def after_successful_sign_in(db: Session, user_id: UUID, settings: Settings) -> None:
    """Called on the one event that proves the account is in use. Best effort:
    housekeeping must never be the reason a sign-in fails."""
    try:
        prune_account(db, user_id, settings)
        prune_sign_in_attempts(db, settings)
    except Exception:  # pragma: no cover - tidying is never worth an outage
        db.rollback()
