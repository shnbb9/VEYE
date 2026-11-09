"""Making a retried POST harmless.

A browser retries. A member double-clicks. A proxy replays a request whose
response never arrived. None of that should send a second email to a member,
write a second reply onto a request, or pay for a second model call.

**The record goes in before the work, not after.** That ordering is the whole
mechanism. Writing it afterwards would leave a window in which two concurrent
requests both find nothing, both do the work, and only then discover they
collided — by which point two emails have gone out and the constraint is
telling us about damage rather than preventing it.

So:

    1. claim the key   — INSERT, unique on (scope, key). A duplicate here is a
                         replay, and the answer comes from the first attempt.
    2. do the work     — the email, the model call, the row.
    3. record the id   — UPDATE the claim with what was created.

A claim that exists with no id yet is an attempt still in flight. That answers
409: the caller should wait rather than be told "done" about work that may yet
fail, or be allowed to start a second one.

**Only the id is kept, never the response.** Re-rendering from the entity keeps
the answer current and avoids a second copy of a member's words sitting in a
table nobody reads.
"""

from __future__ import annotations

import re
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy import DateTime, String, UniqueConstraint
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Mapped, Session, mapped_column

from app.db.base import Base

# A key is a client-chosen opaque string. Constrained so it cannot be used to
# smuggle anything, and long enough for a UUID.
KEY_PATTERN = re.compile(r"^[A-Za-z0-9._:-]{8,128}$")


class IdempotencyRecord(Base):
    __tablename__ = "idempotency_records"
    __table_args__ = (UniqueConstraint("scope", "idempotency_key", name="uq_idempotency_scope_key"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    # The endpoint. Keys are only unique within one, so a key reused on a
    # different endpoint is a different operation rather than a collision.
    scope: Mapped[str] = mapped_column(String(48), nullable=False)
    idempotency_key: Mapped[str] = mapped_column(String(128), nullable=False)
    # Who claimed it. A key is private to its claimant: one member replaying
    # another's key must not be handed their result.
    subject: Mapped[str] = mapped_column(String(128), nullable=False)
    # What the first attempt produced. NULL means still in flight.
    entity_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False,
                                                 default=lambda: datetime.now(timezone.utc))


class Replay(Exception):
    """The first attempt already finished. `entity_id` is what it produced."""

    def __init__(self, entity_id: str) -> None:
        super().__init__(entity_id)
        self.entity_id = entity_id


class Idempotency:
    def __init__(self, db: Session) -> None:
        self.db = db

    def claim(self, scope: str, key: str | None, *, subject: str) -> None:
        """Take the key, or raise.

        Raises `Replay` when the work is already done, and HTTP 409 when an
        earlier attempt is still running. A caller that passes no key gets the
        old behaviour — no protection, but no new failure mode either.
        """
        if not key:
            return
        if not KEY_PATTERN.match(key):
            raise HTTPException(status_code=422,
                                detail="An idempotency key must be 8-128 characters of letters, digits, . _ : or -")

        existing = self._find(scope, key)
        if existing is not None:
            self._resolve(existing)

        record = IdempotencyRecord(scope=scope, idempotency_key=key, subject=subject)
        self.db.add(record)
        try:
            # Flush, so the unique constraint decides the race here rather than
            # at commit time after the email has gone.
            self.db.flush()
        except IntegrityError:
            self.db.rollback()
            existing = self._find(scope, key)
            if existing is None:  # pragma: no cover - the row must exist for the constraint to have fired
                raise
            self._resolve(existing)

    def complete(self, scope: str, key: str | None, entity_id: str) -> None:
        if not key:
            return
        record = self._find(scope, key)
        if record is not None and record.entity_id is None:
            record.entity_id = str(entity_id)[:64]
            self.db.flush()

    # ---- internals -----------------------------------------------------------
    def _find(self, scope: str, key: str) -> IdempotencyRecord | None:
        return (self.db.query(IdempotencyRecord)
                .filter(IdempotencyRecord.scope == scope, IdempotencyRecord.idempotency_key == key)
                .one_or_none())

    @staticmethod
    def _resolve(record: IdempotencyRecord) -> None:
        if record.entity_id:
            raise Replay(record.entity_id)
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="That request is already being processed. Wait for it to finish before trying again.",
            headers={"Retry-After": "2"},
        )


def prune_idempotency_records(db: Session, *, older_than_hours: int = 48) -> int:
    """A replay window of a couple of days is generous for a browser retry, and
    these rows are not evidence of anything once it closes."""
    cutoff = datetime.now(timezone.utc) - timedelta(hours=older_than_hours)
    removed = (db.query(IdempotencyRecord)
               .filter(IdempotencyRecord.created_at < cutoff).delete(synchronize_session=False))
    db.flush()
    return int(removed or 0)
