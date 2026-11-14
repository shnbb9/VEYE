"""Reading, drafting and publishing versioned policies.

Nothing here edits a published row. `publish` always inserts the next version;
the previous one stays exactly as it was, because somebody may have agreed to
it.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.policies.models import STATUS_DRAFT, STATUS_PUBLISHED, PlatformPolicyVersion


class PolicyConflict(Exception):
    """Somebody else published this key in the same moment."""


@dataclass(frozen=True)
class Actor:
    user_id: UUID | None
    name: str


def canonical_json(value: dict) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def content_hash(value: dict) -> str:
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def aware(value: datetime | None) -> datetime | None:
    """SQLite hands back naive datetimes; everything here is UTC."""
    if value is None:
        return None
    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)


class PolicyStore:
    def __init__(self, db: Session) -> None:
        self.db = db

    # ---- reading -------------------------------------------------------------
    def current(self, key: str) -> PlatformPolicyVersion | None:
        """The newest published version, or None when nothing was ever
        published (callers then fall back to their own built-in default)."""
        return (self.db.query(PlatformPolicyVersion)
                .filter(PlatformPolicyVersion.key == key, PlatformPolicyVersion.status == STATUS_PUBLISHED)
                .order_by(PlatformPolicyVersion.version.desc())
                .first())

    def version(self, key: str, version: int) -> PlatformPolicyVersion | None:
        return (self.db.query(PlatformPolicyVersion)
                .filter(PlatformPolicyVersion.key == key, PlatformPolicyVersion.version == version,
                        PlatformPolicyVersion.status == STATUS_PUBLISHED)
                .one_or_none())

    def draft(self, key: str) -> PlatformPolicyVersion | None:
        return (self.db.query(PlatformPolicyVersion)
                .filter(PlatformPolicyVersion.key == key, PlatformPolicyVersion.status == STATUS_DRAFT)
                .order_by(PlatformPolicyVersion.updated_at.desc(), PlatformPolicyVersion.id.desc())
                .first())

    def history(self, key: str, limit: int = 20) -> list[PlatformPolicyVersion]:
        return (self.db.query(PlatformPolicyVersion)
                .filter(PlatformPolicyVersion.key == key, PlatformPolicyVersion.status == STATUS_PUBLISHED)
                .order_by(PlatformPolicyVersion.version.desc())
                .limit(max(1, min(limit, 200)))
                .all())

    # ---- writing -------------------------------------------------------------
    def save_draft(self, key: str, value: dict, *, by: Actor, note: str | None = None) -> PlatformPolicyVersion:
        row = self.draft(key)
        if row is None:
            row = PlatformPolicyVersion(key=key, status=STATUS_DRAFT, created_by_user_id=by.user_id,
                                        created_by_name=by.name)
            self.db.add(row)
        row.value = value
        row.content_hash = content_hash(value)
        row.note = note
        self.db.flush()
        return row

    def discard_draft(self, key: str) -> bool:
        row = self.draft(key)
        if row is None:
            return False
        self.db.delete(row)
        self.db.flush()
        return True

    def publish(self, key: str, value: dict, *, by: Actor, note: str | None = None) -> PlatformPolicyVersion:
        """Insert the next immutable version and drop any draft for the key.

        The unique (key, version) constraint decides a race: the loser gets
        `PolicyConflict` instead of a second, different "version N". The
        session is rolled back on that path (the codebase's convention — see
        `core/idempotency.py`), so publish must be the request's first write."""
        latest = (self.db.query(func.max(PlatformPolicyVersion.version))
                  .filter(PlatformPolicyVersion.key == key).scalar())
        now = datetime.now(timezone.utc)
        row = PlatformPolicyVersion(
            key=key, version=int(latest or 0) + 1, status=STATUS_PUBLISHED, value=value,
            content_hash=content_hash(value), note=note,
            created_by_user_id=by.user_id, created_by_name=by.name,
            published_by_user_id=by.user_id, published_by_name=by.name, published_at=now,
        )
        self.db.add(row)
        try:
            self.db.flush()
        except IntegrityError as exc:
            self.db.rollback()
            raise PolicyConflict(key) from exc
        draft = self.draft(key)
        if draft is not None:
            self.db.delete(draft)
            self.db.flush()
        return row
