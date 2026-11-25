"""Food Diary photos: one picture per meal, kept in object storage.

Three ways in, one way of keeping (owner request, 15 Nov 2026): a file chosen
on the device, a snapshot from the camera (the browser sends it as a file),
or a link the member pasted — fetched once by `RemoteImageFetcher` and then
treated exactly like an upload, so the photo survives the link dying. Every
picture is decoded and rebuilt (`normalise_photo`): EXIF — GPS, the camera,
the time — never survives, and only still JPEG, PNG and WebP are kept.

Who sees a meal photo: the member, and the Veye team in the console, like the
diary it belongs to (Cara, 25 Nov 2026 — the sharing terms say so); Sprout
never — its summaries carry counts, not entries.
"""

from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy.orm import Session

from app.food.models import FoodDiaryEntry
from app.storage.images import ImageRejected, normalise_photo, thumb_key
from app.storage.media_changes import MediaChanges, sweep_prefix
from app.storage.object_storage import ObjectNotFound, ObjectStorage
from app.storage.remote_image import LinkRefused, RemoteImageFetcher

FULL_SIDE = 1600   # plenty for a phone screen or the console's lightbox
THUMB_SIDE = 400   # the diary row and the console list
TYPES = {"image/jpeg", "image/png", "image/webp"}


class MealPhotoError(Exception):
    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


def member_prefix(member_id: UUID) -> str:
    return f"meal-photos/{member_id}/"


def meal_photo_version(row: FoodDiaryEntry) -> str | None:
    """Changes whenever the photo does: a cache key for its URL, not a secret."""
    if not row.photo_object_key or not row.photo_updated_at:
        return None
    return hashlib.sha1(f"{row.photo_object_key}:{row.photo_updated_at.isoformat()}".encode(),
                        usedforsecurity=False).hexdigest()[:12]


class MealPhotoService:
    def __init__(self, db: Session, media: ObjectStorage, *, max_bytes: int, fetcher: RemoteImageFetcher | None = None) -> None:
        self.db = db
        self.media = media
        self.changes = MediaChanges(media)  # settled by the route, after its commit
        self.max_bytes = max_bytes
        self.fetcher = fetcher

    def attach(self, row: FoodDiaryEntry, data: bytes, declared_type: str | None) -> FoodDiaryEntry:
        if declared_type and declared_type.split(";")[0].strip() not in TYPES:
            raise MealPhotoError(415, "Please choose a JPG, PNG or WebP image.")
        try:
            photo = normalise_photo(data, max_bytes=self.max_bytes, full_side=FULL_SIDE, thumb_side=THUMB_SIDE)
        except ImageRejected as exc:
            raise MealPhotoError(exc.status_code, exc.detail) from exc
        now = datetime.now(timezone.utc)
        key = f"{member_prefix(row.member_id)}{row.id}/{now.strftime('%Y%m%dT%H%M%S%f')}.{photo.extension}"
        old = row.photo_object_key
        # Bytes first, the pointer last: a failure part-way leaves the old
        # photo in place rather than a pointer to bytes never written.
        self.changes.put(thumb_key(key), photo.thumb, photo.content_type)
        self.changes.put(key, photo.full, photo.content_type)
        row.photo_object_key = key
        row.photo_content_type = photo.content_type
        row.photo_updated_at = now
        self.db.flush()
        if old and old != key:
            self.changes.retire(old, thumb_key(old))
        return row

    def fetch(self, url: str) -> bytes:
        """The link's bytes. Called with no transaction open: another website
        decides how long this takes."""
        if self.fetcher is None:
            raise MealPhotoError(503, "Adding a photo from a link is not available right now.")
        try:
            return self.fetcher.fetch(url)
        except LinkRefused as exc:
            raise MealPhotoError(exc.status_code, exc.detail) from exc

    def attach_fetched(self, row: FoodDiaryEntry, data: bytes) -> FoodDiaryEntry:
        try:
            return self.attach(row, data, None)
        except MealPhotoError as exc:
            if exc.status_code == 415:
                raise MealPhotoError(415, "That link did not lead to a JPG, PNG or WebP picture.") from exc
            raise

    def remove(self, row: FoodDiaryEntry) -> FoodDiaryEntry:
        if row.photo_object_key:
            self.changes.retire(row.photo_object_key, thumb_key(row.photo_object_key))
        row.photo_object_key = None
        row.photo_content_type = None
        row.photo_updated_at = datetime.now(timezone.utc)
        self.db.flush()
        return row

    def read(self, row: FoodDiaryEntry, size: str = "full") -> tuple[bytes, str]:
        if not row.photo_object_key or not row.photo_content_type:
            raise MealPhotoError(404, "This meal has no photo.")
        key = thumb_key(row.photo_object_key) if size == "thumb" else row.photo_object_key
        try:
            return self.media.get(key), row.photo_content_type
        except ObjectNotFound as exc:
            raise MealPhotoError(404, "This meal has no photo.") from exc

    def forget(self, row: FoodDiaryEntry) -> None:
        """The entry itself is being deleted: its photo goes with it."""
        if row.photo_object_key:
            self.changes.retire(row.photo_object_key, thumb_key(row.photo_object_key))

    def purge_member(self, member_id: UUID) -> int:
        """Every meal photo a member ever kept (erasure). Idempotent: an
        object already gone is success, so a retried purge finishes."""
        return sweep_prefix(self.media, member_prefix(member_id))
