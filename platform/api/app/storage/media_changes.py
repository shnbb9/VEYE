"""Object-store writes that follow the database, in the right order.

The store has no transactions, so the order is the safety: new bytes first,
the row that points at them next, and the old bytes only once that row is
COMMITTED. A delete made before the commit leaves, when the commit fails, a
row pointing at bytes that are gone; a write whose commit fails leaves bytes
nobody can find. `MediaChanges` keeps both lists and settles them after."""

from __future__ import annotations

import logging
from contextlib import contextmanager
from typing import Iterator

from sqlalchemy.orm import Session

from app.storage.object_storage import ObjectNotFound, ObjectStorage

log = logging.getLogger("veye.media")


class MediaChanges:
    def __init__(self, media: ObjectStorage) -> None:
        self.media = media
        self._fresh: list[str] = []
        self._stale: list[str] = []

    def put(self, key: str, data: bytes, content_type: str) -> None:
        self._fresh.append(key)
        self.media.put(key, data, content_type)

    def retire(self, *keys: str | None) -> None:
        self._stale.extend(key for key in keys if key)

    def settle(self) -> None:
        stale, self._stale, self._fresh = self._stale, [], []
        self._delete(stale)

    def abandon(self) -> None:
        fresh, self._stale, self._fresh = self._fresh, [], []
        self._delete(fresh)

    def _delete(self, keys: list[str]) -> None:
        for key in keys:
            try:
                self.media.delete(key)
            except ObjectNotFound:
                pass
            except Exception as exc:  # the row is already right; say so, do not fail
                log.warning("could not remove a media object: %s: %s", type(exc).__name__, str(exc)[:200])


@contextmanager
def committed_with(db: Session, changes: MediaChanges) -> Iterator[None]:
    """Commit the block; only then remove what it replaced. If anything in it
    (the commit included) fails, remove what it wrote instead."""
    try:
        yield
        db.commit()
    except BaseException:
        db.rollback()
        changes.abandon()
        raise
    changes.settle()


def sweep_prefix(media: ObjectStorage, prefix: str) -> int:
    """Every object under an owner's prefix. Idempotent."""
    removed = 0
    for key in media.list_keys(prefix):
        try:
            media.delete(key)
            removed += 1
        except ObjectNotFound:
            pass
    return removed
