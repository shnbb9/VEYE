"""Member account service: profile edits, the profile photo (through the
ObjectStorage boundary), the member's own data export, and complete deletion
of a member account with everything it owns.

Every method takes the authenticated account and touches only that account's
rows — the authorization is the caller's principal, never an id from the
client."""

from __future__ import annotations

import hashlib
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from app.assessments.models import HealthNumberAttempt
from app.auth.models import AuthSession, AuthToken, UserAccount
from app.companion.models import CompanionConversation, CompanionFeedback, CompanionMessage, CompanionMessageSource
from app.food.models import FoodDiaryEntry
from app.guided_flows.models import MemberGuidedFlowSession
from app.members.models import Member
from app.mood.models import MoodEntry
from app.notifications.models import Notification, NotificationPreference
from app.progress.blood_markers.models import BloodMarkerAttempt
from app.progress.body_composition.models import BodyCompositionAttempt
from app.progress.health_assessment.models import HealthAssessmentAttempt
from app.progress.simple_quiz.models import SimpleQuizAttempt
from app.requests.models import MemberRequest
from app.storage.object_storage import ObjectNotFound, ObjectStorage

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
    return hashlib.sha1(f"{user.photo_object_key}:{user.photo_updated_at.isoformat()}".encode()).hexdigest()[:12]


class MemberProfileService:
    def __init__(self, db: Session, media: ObjectStorage, *, photo_max_bytes: int = 2_000_000) -> None:
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
    def set_photo(self, user: UserAccount, data: bytes, declared_type: str | None) -> UserAccount:
        if not data:
            raise ProfileError(422, "Choose an image file.")
        if len(data) > self.photo_max_bytes:
            raise ProfileError(413, f"The photo is too large. Please use an image under {self.photo_max_bytes // 1_000_000} MB.")
        content_type = sniff_photo_type(data)
        if content_type is None or (declared_type and declared_type.split(";")[0].strip() not in PHOTO_TYPES):
            raise ProfileError(415, "Please choose a JPG, PNG or WebP image.")
        ext = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}[content_type]
        now = datetime.now(timezone.utc)
        key = f"profile-photos/{user.id}/{now.strftime('%Y%m%dT%H%M%S%f')}.{ext}"
        old_key = user.photo_object_key
        self.media.put(key, data, content_type)
        user.photo_object_key = key
        user.photo_content_type = content_type
        user.photo_updated_at = now
        self.db.flush()
        if old_key and old_key != key:
            try:
                self.media.delete(old_key)
            except Exception:  # the new photo is already in place; a stale file is not an error
                pass
        return user

    def remove_photo(self, user: UserAccount) -> UserAccount:
        if user.photo_object_key:
            try:
                self.media.delete(user.photo_object_key)
            except Exception:
                pass
        user.photo_object_key = None
        user.photo_content_type = None
        user.photo_updated_at = datetime.now(timezone.utc)
        self.db.flush()
        return user

    def read_photo(self, user: UserAccount) -> tuple[bytes, str]:
        if not user.photo_object_key or not user.photo_content_type:
            raise ProfileError(404, "No profile photo.")
        try:
            return self.media.get(user.photo_object_key), user.photo_content_type
        except ObjectNotFound as exc:
            raise ProfileError(404, "No profile photo.") from exc

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
            "food_diary": [plain(m, ("entry_date", "meal_time", "description", "feelings", "notes", "updated_at"))
                           for m in rows(FoodDiaryEntry, FoodDiaryEntry.entry_date)],
            "requests": [plain(r, ("kind", "status", "subject", "message", "created_at")) for r in rows(MemberRequest, MemberRequest.created_at)],
            "guided_sessions": [plain(s, ("flow_key", "flow_version", "status", "current_node", "started_at", "updated_at", "completed_at"))
                                for s in rows(MemberGuidedFlowSession, MemberGuidedFlowSession.started_at)],
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
                          MoodEntry, FoodDiaryEntry, MemberGuidedFlowSession):
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
