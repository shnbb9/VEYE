"""Member account service: profile edits, the profile photo (through the
ObjectStorage boundary), the member's own data export, and complete deletion
of a member account with everything it owns.

Every method takes the authenticated account and touches only that account's
rows — the authorization is the caller's principal, never an id from the
client."""

from __future__ import annotations

import logging

import hashlib
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from app.assessments.models import HealthNumberAttempt
from app.auth.models import AuthSession, AuthToken, UserAccount
from app.companion.models import CompanionConversation, CompanionFeedback, CompanionMessage, CompanionMessageSource
from app.food.models import FoodDiaryDay, FoodDiaryEntry
from app.guided_flows.models import MemberGuidedFlowSession
from app.meal_plans.models import MealPlanDay
from app.members.models import Member
from app.mood.models import MoodEntry
from app.notifications.models import Notification, NotificationPreference
from app.progress.blood_markers.models import BloodMarkerAttempt
from app.progress.body_composition.models import BodyCompositionAttempt
from app.progress.health_assessment.models import HealthAssessmentAttempt
from app.progress.simple_quiz.models import SimpleQuizAttempt
from app.requests.models import MemberRequest
from app.storage.images import Crop, ImageRejected, original_key, prepare_picture, recut_picture, thumb_key
from app.storage.object_storage import ObjectNotFound, ObjectStorage

log = logging.getLogger("veye.members")

# Accepted photo types, checked by magic bytes — the browser's declared type is
# never trusted on its own.
PHOTO_TYPES = {"image/jpeg": (b"\xff\xd8\xff",), "image/png": (b"\x89PNG\r\n\x1a\n",), "image/webp": (b"RIFF",)}


class ProfileError(Exception):
    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


def sniff_photo_type(data: bytes) -> str | None:
    for content_type, magics in PHOTO_TYPES.items():
        if any(data.startswith(m) for m in magics):
            if content_type == "image/webp" and data[8:12] != b"WEBP":
                continue
            return content_type
    return None


def photo_version(user: UserAccount) -> str | None:
    if not user.photo_object_key or not user.photo_updated_at:
        return None
    # A cache-busting suffix for the photo URL, not a security token: it only
    # has to change when the photo does. Declared non-security so the intent is
    # explicit and so this keeps working where SHA-1 is disabled for security
    # use (FIPS mode), which it otherwise would not.
    return hashlib.sha1(
        f"{user.photo_object_key}:{user.photo_updated_at.isoformat()}".encode(),
        usedforsecurity=False,
    ).hexdigest()[:12]


def photo_crop(user: UserAccount) -> dict[str, int] | None:
    """What the crop editor needs to reopen where the person left it: the
    upright original's size and the chosen square. None when the picture
    cannot be re-cropped (no picture, or one saved before cropping)."""
    if not user.photo_object_key or not user.photo_original_key or None in (
            user.photo_original_width, user.photo_original_height, user.photo_crop_x, user.photo_crop_y, user.photo_crop_size):
        return None
    return {"width": user.photo_original_width, "height": user.photo_original_height,
            "x": user.photo_crop_x, "y": user.photo_crop_y, "size": user.photo_crop_size}


def clear_photo_crop(user: UserAccount) -> None:
    user.photo_original_key = None
    user.photo_original_width = user.photo_original_height = None
    user.photo_crop_x = user.photo_crop_y = user.photo_crop_size = None


class MemberProfileService:
    def __init__(self, db: Session, media: ObjectStorage, *, photo_max_bytes: int = 10_000_000) -> None:
        self.db = db
        self.media = media
        self.photo_max_bytes = photo_max_bytes

    # ---- profile -----------------------------------------------------------------
    def update_profile(self, user: UserAccount, *, first_name: str, last_name: str, phone: str | None,
                       postal_code: str | None) -> UserAccount:
        first = first_name.strip()
        if not first:
            raise ProfileError(422, "Please enter your first name.")
        user.first_name = first
        user.last_name = (last_name or "").strip()
        user.phone = (phone or "").strip() or None
        user.postal_code = (postal_code or "").strip() or None
        if user.member_id is not None:
            member = self.db.get(Member, user.member_id)
            if member is not None:
                member.display_name = user.display_name
        self.db.flush()
        return user

    # ---- photo -------------------------------------------------------------------
    # One picture per sign-in account. A person who holds both a member profile
    # and administrator access has ONE avatar, shown in both portals; either
    # portal may change it, and each portal changes only its own signed-in
    # account's picture (architecture V2 §5.3).
    def set_photo(self, user: UserAccount, data: bytes, declared_type: str | None, crop: Crop | None = None) -> UserAccount:
        """A new picture: the rebuilt original is kept, and the avatar is cut
        from `crop` (the centred square when none was chosen)."""
        if declared_type and declared_type.split(";")[0].strip() not in PHOTO_TYPES:
            raise ProfileError(415, "Please choose a JPG, PNG or WebP image.")
        try:
            picture = prepare_picture(data, max_bytes=self.photo_max_bytes, crop=crop)
        except ImageRejected as exc:
            raise ProfileError(exc.status_code, exc.detail) from exc
        now = datetime.now(timezone.utc)
        key = f"profile-photos/{user.id}/{now.strftime('%Y%m%dT%H%M%S%f')}.{picture.extension}"
        old_key, old_original = user.photo_object_key, user.photo_original_key
        # Bytes first, the pointer last: a failure mid-way leaves the old
        # photo in place rather than a pointer to bytes that were never written.
        self.media.put(original_key(key), picture.original, picture.content_type)
        self.media.put(thumb_key(key), picture.thumb, picture.content_type)
        self.media.put(key, picture.full, picture.content_type)
        user.photo_object_key = key
        user.photo_content_type = picture.content_type
        user.photo_updated_at = now
        user.photo_original_key = original_key(key)
        user.photo_original_width, user.photo_original_height = picture.width, picture.height
        user.photo_crop_x, user.photo_crop_y, user.photo_crop_size = picture.crop.x, picture.crop.y, picture.crop.size
        self.db.flush()
        if old_key and old_key != key:
            self._delete_quietly(old_key)
        if old_original and old_original != user.photo_original_key:
            self._delete_quietly(old_original, variants=False)
        return user

    def recrop_photo(self, user: UserAccount, crop: Crop) -> UserAccount:
        """A new square of the picture already kept — no new upload. The
        original is untouched; only the avatar variants are cut again."""
        if not user.photo_object_key or not user.photo_original_key or not user.photo_content_type:
            raise ProfileError(409, "This picture was saved before cropping was available. Upload it again to crop it.")
        try:
            original = self.media.get(user.photo_original_key)
        except ObjectNotFound as exc:
            raise ProfileError(409, "The original of this picture is no longer available. Upload it again to crop it.") from exc
        try:
            full, thumb = recut_picture(original, crop)
        except ImageRejected as exc:
            raise ProfileError(exc.status_code, exc.detail) from exc
        now = datetime.now(timezone.utc)
        extension = user.photo_object_key.rpartition(".")[2]
        key = f"profile-photos/{user.id}/{now.strftime('%Y%m%dT%H%M%S%f')}.{extension}"
        old_key = user.photo_object_key
        self.media.put(thumb_key(key), thumb, user.photo_content_type)
        self.media.put(key, full, user.photo_content_type)
        user.photo_object_key = key
        user.photo_updated_at = now
        user.photo_crop_x, user.photo_crop_y, user.photo_crop_size = crop.x, crop.y, crop.size
        self.db.flush()
        if old_key != key:
            self._delete_quietly(old_key)
        return user

    def _delete_quietly(self, key: str, *, variants: bool = True) -> None:
        for target in ((key, thumb_key(key)) if variants else (key,)):
            try:
                self.media.delete(target)
            except ObjectNotFound:
                pass
            except Exception as exc:
                # The new photo is already in place, so a stale file is not an
                # error worth failing on — but it is worth saying, or an object
                # store quietly refusing every delete looks like nothing at all.
                log.warning("could not remove a previous profile photo object: %s: %s",
                            type(exc).__name__, str(exc)[:200])

    def remove_photo(self, user: UserAccount) -> UserAccount:
        if user.photo_object_key:
            self._delete_quietly(user.photo_object_key)
        if user.photo_original_key:
            self._delete_quietly(user.photo_original_key, variants=False)
        user.photo_object_key = None
        user.photo_content_type = None
        user.photo_updated_at = datetime.now(timezone.utc)
        clear_photo_crop(user)
        self.db.flush()
        return user

    def read_photo(self, user: UserAccount, size: str = "full") -> tuple[bytes, str]:
        """`original` is for the owner's crop editor only; the routes that
        serve a picture to anyone else never ask for it."""
        if not user.photo_object_key or not user.photo_content_type:
            raise ProfileError(404, "No profile photo.")
        if size == "original":
            if not user.photo_original_key:
                raise ProfileError(404, "This picture has no original to crop from.")
            try:
                return self.media.get(user.photo_original_key), user.photo_content_type
            except ObjectNotFound as exc:
                raise ProfileError(404, "This picture has no original to crop from.") from exc
        key = thumb_key(user.photo_object_key) if size == "thumb" else user.photo_object_key
        try:
            return self.media.get(key), user.photo_content_type
        except ObjectNotFound:
            if size == "thumb":
                # A photo saved before variants existed has no thumbnail.
                return self.read_photo(user, "full")
            raise ProfileError(404, "No profile photo.")

    # ---- export ------------------------------------------------------------------
    def export(self, user: UserAccount) -> dict[str, Any]:
        """Everything the member has entered or been given, as plain JSON.
        Calculated results are exported exactly as stored (never re-scored)."""
        member_id = user.member_id

        def rows(model, order):
            if member_id is None:
                return []
            return self.db.query(model).filter(model.member_id == member_id).order_by(order).all()

        def plain(row, fields):
            out = {}
            for f in fields:
                value = getattr(row, f, None)
                if isinstance(value, datetime):
                    value = value.isoformat()
                elif isinstance(value, (UUID, Decimal, date)):
                    value = str(value)
                out[f] = value
            return out

        attempt_fields = ("id", "completed_at", "calculation_version")
        return {
            "exported_at": datetime.now(timezone.utc).isoformat(),
            "account": {"email": user.email, "first_name": user.first_name, "last_name": user.last_name, "phone": user.phone,
                        "postal_code": user.postal_code, "created_at": user.created_at.isoformat(),
                        "email_verified": user.email_verified_at is not None, "has_photo": bool(user.photo_object_key)},
            "health_number": [plain(a, attempt_fields + ("answers", "displayed_score", "status", "bucket", "category", "interpretation"))
                              for a in rows(HealthNumberAttempt, HealthNumberAttempt.completed_at)],
            "body_composition": [plain(a, attempt_fields + ("sex", "measurements", "bmi", "body_fat_percent", "fat_mass_lb", "lean_mass_lb", "unavailable_reason"))
                                 for a in rows(BodyCompositionAttempt, BodyCompositionAttempt.completed_at)],
            "blood_markers": [plain(a, attempt_fields + ("markers", "tg_hdl", "homa_ir", "aa_epa", "aa_epa_source", "results")) for a in rows(BloodMarkerAttempt, BloodMarkerAttempt.completed_at)],
            "health_assessment": [plain(a, attempt_fields + ("answers", "total", "status", "bucket", "epa_dha_dose", "interpretation"))
                                  for a in rows(HealthAssessmentAttempt, HealthAssessmentAttempt.completed_at)],
            "simple_quiz": [plain(a, attempt_fields + ("answers", "yes_count", "no_count")) for a in rows(SimpleQuizAttempt, SimpleQuizAttempt.completed_at)],
            "mood": [plain(m, ("entry_date", "mood", "note", "updated_at")) for m in rows(MoodEntry, MoodEntry.entry_date)],
            "food_diary": [plain(m, ("entry_date", "meal_time", "description", "feelings", "notes", "protein_g", "carbs_g", "fat_g", "kcal",
                                     "updated_at"))
                           for m in rows(FoodDiaryEntry, FoodDiaryEntry.entry_date)],
            "food_diary_saved_days": [plain(d, ("entry_date", "saved_at")) for d in rows(FoodDiaryDay, FoodDiaryDay.entry_date)],
            "meal_plans": [plain(d, ("name", "notes", "describe", "mode", "meals", "assigned_date", "created_at", "updated_at"))
                           for d in rows(MealPlanDay, MealPlanDay.created_at)],
            # What they wrote in, and what Veye wrote back. The docstring
            # promises what the member "has been given" as well as what they
            # entered, and an answer they received is part of their record.
            # The console's internal note and the delivery result are not.
            "requests": [plain(r, ("kind", "status", "subject", "message", "created_at")) | {
                "replies": [plain(reply, ("body", "created_at"))
                            for reply in sorted(r.replies, key=lambda x: x.created_at)],
            } for r in rows(MemberRequest, MemberRequest.created_at)],
            # Their own decisions about sharing, with the wording each was made
            # against — evidence belongs to the person who gave it.
            "health_data_sharing": self._sharing_export(member_id),
            "guided_sessions": [plain(s, ("flow_key", "flow_version", "status", "current_node", "started_at", "updated_at", "completed_at"))
                                for s in rows(MemberGuidedFlowSession, MemberGuidedFlowSession.started_at)],
        }

    def _sharing_export(self, member_id: UUID | None) -> dict[str, Any]:
        if member_id is None:
            return {}
        from app.health_permission.service import HealthPermissionService

        row = HealthPermissionService(self.db).for_member(member_id)
        return {
            "state": row.state,
            "policy_version": row.policy_version or "",
            "decided_at": row.decided_at.isoformat() if row.decided_at else None,
            "revoked_at": row.revoked_at.isoformat() if row.revoked_at else None,
            "history": [{"to_state": e.to_state, "actor": e.actor, "source": e.source,
                         "policy_version": e.policy_version, "created_at": e.created_at.isoformat()}
                        for e in row.events],
        }

    # ---- deletion ---------------------------------------------------------------------
    def delete_member_account(self, user: UserAccount) -> None:
        """Removes the account and every row the member owns. Explicit deletes
        (not database cascades) so the same code holds on SQLite and PostgreSQL;
        requests are detached rather than deleted so the inbox history stays
        readable. The photo bytes go too."""
        member_id = user.member_id
        if user.photo_object_key:
            try:
                self.media.delete(user.photo_object_key)
            except Exception:
                pass
        if member_id is not None:
            conversation_ids = [cid for (cid,) in self.db.query(CompanionConversation.id).filter(CompanionConversation.member_id == member_id).all()]
            if conversation_ids:
                message_ids = [mid for (mid,) in self.db.query(CompanionMessage.id).filter(CompanionMessage.conversation_id.in_(conversation_ids)).all()]
                if message_ids:
                    self.db.query(CompanionMessageSource).filter(CompanionMessageSource.message_id.in_(message_ids)).delete(synchronize_session=False)
                    self.db.query(CompanionFeedback).filter(CompanionFeedback.message_id.in_(message_ids)).delete(synchronize_session=False)
                self.db.query(CompanionMessage).filter(CompanionMessage.conversation_id.in_(conversation_ids)).delete(synchronize_session=False)
                self.db.query(CompanionConversation).filter(CompanionConversation.id.in_(conversation_ids)).delete(synchronize_session=False)
            for model in (HealthNumberAttempt, BodyCompositionAttempt, BloodMarkerAttempt, HealthAssessmentAttempt, SimpleQuizAttempt,
                          MoodEntry, FoodDiaryEntry, FoodDiaryDay, MealPlanDay, MemberGuidedFlowSession):
                self.db.query(model).filter(model.member_id == member_id).delete(synchronize_session=False)
            self.db.query(MemberRequest).filter(MemberRequest.member_id == member_id).update({"member_id": None}, synchronize_session=False)
        for model in (AuthSession, AuthToken, Notification, NotificationPreference):
            self.db.query(model).filter(model.user_id == user.id).delete(synchronize_session=False)
        self.db.delete(user)
        self.db.flush()
        if member_id is not None:
            member = self.db.get(Member, member_id)
            if member is not None:
                self.db.delete(member)
        self.db.flush()
