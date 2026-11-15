"""Erasing a member profile (architecture V2 §6).

  1. **Request.** The member proves who they are (current password) and types
     DELETE. Access closes at once: the member profile is detached from the
     account in the same transaction, so `/login` and every member route refuse
     from the next request, and every member-portal session is revoked. For an
     account with nothing else on it, the whole account is switched off and all
     its sessions end.
  2. **Purge.** A sequence of idempotent stages, each committed on its own and
     safe to run again. A failure stops the run in `purge_blocked` with a
     category, never reopens access, and the scheduled job retries it.
  3. **Receipt.** Counts per category (never a value), a ledger entry written
     OUTSIDE the database, and an email that says it happened and contains no
     health information.

The ledger exists for backups. Restoring a database snapshot taken before an
erasure would bring the person back; `replay_ledger` re-applies every erasure
the ledger knows about to whatever the restored database contains.

What is NOT erased, and why — all of it reported to the owner as decisions:
  * the administrator audit log keeps its rows (who did what, when) but the
    email addresses recorded in their details are removed;
  * an account that also holds console access keeps that access, its console
    sessions and its picture (one picture serves both portals);
  * messages the person sent from the public site WITHOUT signing in are not
    linked to the profile and are not touched (nothing proves they are theirs).
"""

from __future__ import annotations

import hashlib
import json
import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Callable
from uuid import UUID

from sqlalchemy import and_, or_
from sqlalchemy.orm import Session

from app.admin.models import AdminAuditEntry
from app.assessments.models import HealthNumberAttempt
from app.auth.models import AuthSession, AuthToken, UserAccount
from app.auth.password import verify_password
from app.auth.throttle import SignInAttempt
from app.companion.models import (
    CompanionConversation,
    CompanionFeedback,
    CompanionMessage,
    CompanionMessageSource,
    CompanionPolicyDecision,
    MemberPersonalTip,
)
from app.core.idempotency import IdempotencyRecord
from app.core.rate_limit import RateLimitEvent
from app.erasure.models import (
    OPEN_STATES,
    POLICY_VERSION,
    SCOPE_ENTIRE_IDENTITY,
    SCOPE_MEMBER_DATA,
    STATE_ACCESS_CLOSED,
    STATE_ERASED,
    STATE_PURGE_BLOCKED,
    STATE_PURGING,
    STATE_REQUESTED,
    ErasureRequest,
)
from app.food.models import FoodDiaryDay, FoodDiaryEntry
from app.food_choices.models import MemberFoodSelection, MemberHowToPlan
from app.guided_flows.models import MemberGuidedFlowSession
from app.health_permission.models import MemberHealthPermission, MemberHealthPermissionEvent
from app.meal_plans.models import MealPlanDay
from app.food.photos import MealPhotoService
from app.members.models import Member
from app.members.service import clear_photo_crop
from app.mood.models import MoodEntry
from app.notifications import templates
from app.notifications.models import Notification, NotificationOutbox, NotificationPreference
from app.notifications.service import NotificationService
from app.observability.models import AiTraceEvent
from app.progress.blood_markers.models import BloodMarkerAttempt
from app.progress.body_composition.models import BodyCompositionAttempt
from app.progress.health_assessment.models import HealthAssessmentAttempt
from app.progress.simple_quiz.models import SimpleQuizAttempt
from app.prospects.models import ProspectAssessment, ProspectEvent, ProspectToken
from app.requests.models import MemberRequest, MemberRequestReply
from app.storage.images import thumb_key
from app.storage.object_storage import ObjectNotFound, ObjectStorage

log = logging.getLogger("veye.erasure")

CONFIRM_WORD = "DELETE"
LEDGER_PREFIX = "erasure-ledger/"
MAX_ATTEMPTS = 8
# A purge whose process died mid-run is handed out again after this long.
STALE_PURGE = timedelta(minutes=15)
# Message kinds about the person's own member life. A dual-access account keeps
# the console ones (its invitation, its own security messages).
MEMBER_KINDS = ("welcome", "email_verification", "health_sharing_request", "prospect_confirmation",
                "companion_escalation")


class ErasureError(Exception):
    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


@dataclass(frozen=True)
class Preview:
    scope: str
    removed: list[str]
    kept: list[str]
    counts: dict[str, int]


def _count(db: Session, model, *criteria) -> int:
    return int(db.query(model).filter(*criteria).count())


class ErasureService:
    def __init__(self, db: Session, *, media: ObjectStorage, notifications: NotificationService,
                 pseudonym: Callable[[str], str], now: Callable[[], datetime] | None = None) -> None:
        self.db = db
        self.media = media
        self.notifications = notifications
        self.pseudonym = pseudonym
        self._now = now or (lambda: datetime.now(timezone.utc))

    # ---- what will happen -------------------------------------------------------
    def preview(self, user: UserAccount) -> Preview:
        member_id = user.member_id
        assert member_id is not None
        scope = SCOPE_MEMBER_DATA if user.admin_access else SCOPE_ENTIRE_IDENTITY
        counts = {
            "health_number": _count(self.db, HealthNumberAttempt, HealthNumberAttempt.member_id == member_id),
            "body_composition": _count(self.db, BodyCompositionAttempt, BodyCompositionAttempt.member_id == member_id),
            "blood_markers": _count(self.db, BloodMarkerAttempt, BloodMarkerAttempt.member_id == member_id),
            "health_assessment": _count(self.db, HealthAssessmentAttempt, HealthAssessmentAttempt.member_id == member_id),
            "simple_quiz": _count(self.db, SimpleQuizAttempt, SimpleQuizAttempt.member_id == member_id),
            "mood_entries": _count(self.db, MoodEntry, MoodEntry.member_id == member_id),
            "food_diary_entries": _count(self.db, FoodDiaryEntry, FoodDiaryEntry.member_id == member_id),
            "meal_plans": _count(self.db, MealPlanDay, MealPlanDay.member_id == member_id),
            "companion_conversations": _count(self.db, CompanionConversation, CompanionConversation.member_id == member_id),
            "requests": _count(self.db, MemberRequest, MemberRequest.member_id == member_id),
        }
        removed = ["Your member profile and everything in it: Health Number, body composition, blood markers, "
                   "Health Assessment and Simple Quiz results and answers, moods and notes, food diary, meal plans, "
                   "food choices, guided sessions and conversations with Sprout",
                   "Messages you sent to Veye from inside the app, and the replies to them",
                   "Your health-sharing choices and their history",
                   "Results you saved before signing up and added to your account"]
        if scope == SCOPE_ENTIRE_IDENTITY:
            removed.append("Your sign-in account, your email address, your sessions and your profile picture")
            kept = ["A minimal record that a deletion happened: when, its reference and counts of what was removed "
                    "— no health information",
                    "Entries in Veye's administrator audit log about actions on your account, with your email "
                    "address removed from them"]
        else:
            kept = ["Your console access, its sign-in sessions and your picture (it is the same picture in the "
                    "console). Remove console access separately under Settings → Administrators.",
                    "A minimal record that a deletion happened: when, its reference and counts of what was removed",
                    "Administrator audit log entries, with your email address removed from them"]
        return Preview(scope=scope, removed=removed, kept=kept, counts=counts)

    # ---- the request: access closes now -------------------------------------------
    def request(self, user: UserAccount, *, password: str, confirm: str) -> ErasureRequest:
        if user.member_id is None:
            raise ErasureError(409, "There is no member profile on this account.")
        if not verify_password(user.password_hash, password):
            raise ErasureError(403, "That password is not right.")
        if (confirm or "").strip() != CONFIRM_WORD:
            raise ErasureError(422, f"Type {CONFIRM_WORD} to confirm.")
        member_id = user.member_id
        open_request = (self.db.query(ErasureRequest)
                        .filter(ErasureRequest.subject_member_id == member_id, ErasureRequest.state.in_(OPEN_STATES))
                        .one_or_none())
        if open_request is not None:
            return open_request
        scope = SCOPE_MEMBER_DATA if user.admin_access else SCOPE_ENTIRE_IDENTITY
        request = ErasureRequest(subject_user_id=user.id, subject_member_id=member_id, scope=scope,
                                 state=STATE_ACCESS_CLOSED, receipt_email=user.email, requested_at=self._now(),
                                 policy_version=POLICY_VERSION)
        self.db.add(request)
        # Close access in the same transaction as the request. Detaching the
        # profile is what makes `require_member` and `/login` refuse at once.
        member = self.db.get(Member, member_id)
        if member is not None:
            member.erasure_requested_at = self._now()
        user.member_id = None
        sessions = self.db.query(AuthSession).filter(AuthSession.user_id == user.id, AuthSession.revoked_at.is_(None))
        if scope == SCOPE_MEMBER_DATA:
            sessions = sessions.filter(AuthSession.portal == "member")
        else:
            user.is_active = False
            user.deactivated_at = self._now()
        sessions.update({"revoked_at": self._now()}, synchronize_session=False)
        self.db.flush()
        return request

    # ---- the purge: idempotent stages ----------------------------------------------
    STAGES = ("companion", "assessments", "journals", "guided_flows", "requests", "sharing", "prospects",
              "notifications", "media", "identity", "audit", "ledger")

    def process(self, request: ErasureRequest) -> ErasureRequest:
        if request.state == STATE_ERASED:
            return request
        # Claim it: the request handler and the scheduled job may both reach
        # the same request, and only one of them may run the stages.
        now = self._now()
        claimed = (self.db.query(ErasureRequest)
                   .filter(ErasureRequest.id == request.id,
                           or_(ErasureRequest.state.in_((STATE_REQUESTED, STATE_ACCESS_CLOSED, STATE_PURGE_BLOCKED)),
                               and_(ErasureRequest.state == STATE_PURGING, ErasureRequest.updated_at < now - STALE_PURGE)))
                   .update({"state": STATE_PURGING, "attempts": ErasureRequest.attempts + 1,
                            "failure_category": None, "updated_at": now}, synchronize_session=False))
        self.db.commit()
        self.db.refresh(request)
        if claimed != 1:
            return request
        receipt = dict(request.receipt or {})
        start = self.STAGES.index(request.stage) + 1 if request.stage in self.STAGES else 0
        for stage in self.STAGES[start:]:
            try:
                counts = getattr(self, f"_stage_{stage}")(request)
                for key, value in (counts or {}).items():
                    receipt[key] = receipt.get(key, 0) + int(value)
                request.receipt = receipt
                request.stage = stage
                self.db.commit()
            except Exception as exc:
                self.db.rollback()
                request = self.db.get(ErasureRequest, request.id)
                request.state = STATE_PURGE_BLOCKED
                request.failure_category = f"{stage}:{type(exc).__name__}"[:64]
                self.db.commit()
                log.warning("erasure %s blocked at %s: %s", request.id, stage, type(exc).__name__)
                return request
        request.state = STATE_ERASED
        request.completed_at = self._now()
        self._queue_receipt(request)
        self.db.commit()
        return request

    def _members(self, request: ErasureRequest) -> UUID:
        return request.subject_member_id

    def _stage_companion(self, request: ErasureRequest) -> dict:
        m = self._members(request)
        conversations = [cid for (cid,) in self.db.query(CompanionConversation.id).filter(CompanionConversation.member_id == m)]
        messages = [mid for (mid,) in self.db.query(CompanionMessage.id).filter(CompanionMessage.conversation_id.in_(conversations))] if conversations else []
        if messages:
            self.db.query(CompanionMessageSource).filter(CompanionMessageSource.message_id.in_(messages)).delete(synchronize_session=False)
            self.db.query(CompanionFeedback).filter(CompanionFeedback.message_id.in_(messages)).delete(synchronize_session=False)
            self.db.query(CompanionMessage).filter(CompanionMessage.id.in_(messages)).delete(synchronize_session=False)
        # Rows keyed by member without a foreign key: deleting the member would
        # never cascade to these, so they are named here explicitly.
        decisions = self.db.query(CompanionPolicyDecision).filter(CompanionPolicyDecision.member_id == m).delete(synchronize_session=False)
        self.db.query(CompanionFeedback).filter(CompanionFeedback.member_id == m).delete(synchronize_session=False)
        if conversations:
            self.db.query(CompanionConversation).filter(CompanionConversation.id.in_(conversations)).delete(synchronize_session=False)
        tips = self.db.query(MemberPersonalTip).filter(MemberPersonalTip.member_id == m).delete(synchronize_session=False)
        traces = self.db.query(AiTraceEvent).filter(AiTraceEvent.member_ref == self.pseudonym("member:" + str(m))).delete(synchronize_session=False)
        idem = self.db.query(IdempotencyRecord).filter(IdempotencyRecord.subject.in_((str(m), str(request.subject_user_id)))).delete(synchronize_session=False)
        return {"companion_conversations": len(conversations), "companion_messages": len(messages),
                "companion_policy_decisions": int(decisions or 0), "personal_tips": int(tips or 0),
                "telemetry_traces": int(traces or 0), "idempotency_records": int(idem or 0)}

    def _stage_assessments(self, request: ErasureRequest) -> dict:
        m = self._members(request)
        out = {}
        for name, model in (("health_number", HealthNumberAttempt), ("body_composition", BodyCompositionAttempt),
                            ("blood_markers", BloodMarkerAttempt), ("health_assessment", HealthAssessmentAttempt),
                            ("simple_quiz", SimpleQuizAttempt)):
            out[name] = int(self.db.query(model).filter(model.member_id == m).delete(synchronize_session=False) or 0)
        return out

    def _stage_journals(self, request: ErasureRequest) -> dict:
        m = self._members(request)
        out = {}
        # The diary's photos are member data in object storage, under the
        # member's own prefix: they go with the entries whatever the scope
        # (a dual-access person keeps the console, never their meal photos).
        # Listing the prefix also catches a photo whose entry delete could not
        # remove it. Idempotent, so a retried or replayed purge finishes.
        out["meal_photo_objects"] = MealPhotoService(self.db, self.media, max_bytes=0).purge_member(m)
        for name, model in (("mood_entries", MoodEntry), ("food_diary_entries", FoodDiaryEntry),
                            ("food_diary_days", FoodDiaryDay), ("meal_plans", MealPlanDay),
                            ("food_choices", MemberFoodSelection), ("how_to_plans", MemberHowToPlan)):
            out[name] = int(self.db.query(model).filter(model.member_id == m).delete(synchronize_session=False) or 0)
        return out

    def _stage_guided_flows(self, request: ErasureRequest) -> dict:
        m = self._members(request)
        return {"guided_sessions": int(self.db.query(MemberGuidedFlowSession).filter(MemberGuidedFlowSession.member_id == m).delete(synchronize_session=False) or 0)}

    def _stage_requests(self, request: ErasureRequest) -> dict:
        m = self._members(request)
        ids = [rid for (rid,) in self.db.query(MemberRequest.id).filter(MemberRequest.member_id == m)]
        if ids:
            self.db.query(MemberRequestReply).filter(MemberRequestReply.request_id.in_(ids)).delete(synchronize_session=False)
            self.db.query(MemberRequest).filter(MemberRequest.id.in_(ids)).delete(synchronize_session=False)
        return {"requests": len(ids)}

    def _stage_sharing(self, request: ErasureRequest) -> dict:
        m = self._members(request)
        events = self.db.query(MemberHealthPermissionEvent).filter(MemberHealthPermissionEvent.member_id == m).delete(synchronize_session=False)
        self.db.query(MemberHealthPermission).filter(MemberHealthPermission.member_id == m).delete(synchronize_session=False)
        return {"sharing_events": int(events or 0)}

    def _stage_prospects(self, request: ErasureRequest) -> dict:
        m = self._members(request)
        ids = [pid for (pid,) in self.db.query(ProspectAssessment.id).filter(
            or_(ProspectAssessment.claimed_member_id == m, ProspectAssessment.pending_member_id == m))]
        if ids:
            self.db.query(ProspectEvent).filter(ProspectEvent.prospect_id.in_(ids)).delete(synchronize_session=False)
            self.db.query(ProspectToken).filter(ProspectToken.prospect_id.in_(ids)).delete(synchronize_session=False)
            self.db.query(ProspectAssessment).filter(ProspectAssessment.id.in_(ids)).delete(synchronize_session=False)
        return {"saved_results": len(ids)}

    def _stage_notifications(self, request: ErasureRequest) -> dict:
        query = self.db.query(Notification.id).filter(Notification.user_id == request.subject_user_id)
        if request.scope == SCOPE_MEMBER_DATA:
            query = query.filter(Notification.kind.in_(MEMBER_KINDS))
        ids = [nid for (nid,) in query]
        if ids:
            self.db.query(NotificationOutbox).filter(NotificationOutbox.notification_id.in_(ids)).delete(synchronize_session=False)
            self.db.query(Notification).filter(Notification.id.in_(ids)).delete(synchronize_session=False)
        if request.scope == SCOPE_ENTIRE_IDENTITY:
            self.db.query(NotificationPreference).filter(NotificationPreference.user_id == request.subject_user_id).delete(synchronize_session=False)
        return {"notifications": len(ids)}

    def _stage_media(self, request: ErasureRequest) -> dict:
        """The picture belongs to the account; a dual-access account keeps it
        (it is the console avatar too). Deleting an object that is already
        gone is success, so a retry after a partial failure finishes cleanly."""
        if request.scope != SCOPE_ENTIRE_IDENTITY:
            return {}
        user = self.db.get(UserAccount, request.subject_user_id)
        if user is None or not (user.photo_object_key or user.photo_original_key):
            return {}
        removed = 0
        # The avatar variants AND the kept original the crop is cut from.
        keys = [key for key in (user.photo_object_key, user.photo_object_key and thumb_key(user.photo_object_key),
                                user.photo_original_key) if key]
        for key in keys:
            try:
                self.media.delete(key)
                removed += 1
            except ObjectNotFound:
                pass
        user.photo_object_key = None
        user.photo_content_type = None
        clear_photo_crop(user)
        self.db.flush()
        return {"photo_objects": removed}

    def _stage_identity(self, request: ErasureRequest) -> dict:
        out = {}
        member = self.db.get(Member, request.subject_member_id)
        if member is not None:
            # Anything a concurrent request managed to write after the first
            # stages ran is caught by this second sweep before the row goes.
            for stage in ("assessments", "journals", "guided_flows", "sharing"):
                getattr(self, f"_stage_{stage}")(request)
            self.db.delete(member)
            out["member_profile"] = 1
        if request.scope == SCOPE_ENTIRE_IDENTITY:
            user = self.db.get(UserAccount, request.subject_user_id)
            if user is not None:
                email = user.email
                self.db.query(AuthSession).filter(AuthSession.user_id == user.id).delete(synchronize_session=False)
                self.db.query(AuthToken).filter(AuthToken.user_id == user.id).delete(synchronize_session=False)
                self.db.query(SignInAttempt).filter(SignInAttempt.email == email).delete(synchronize_session=False)
                self.db.query(RateLimitEvent).filter(RateLimitEvent.subject.in_((str(user.id), str(request.subject_member_id)))).delete(synchronize_session=False)
                self.db.delete(user)
                out["sign_in_account"] = 1
        self.db.flush()
        return out

    def _stage_audit(self, request: ErasureRequest) -> dict:
        """Keep who-did-what-when; remove the email addresses the details
        recorded about this person."""
        ids = (str(request.subject_user_id), str(request.subject_member_id))
        rows = self.db.query(AdminAuditEntry).filter(AdminAuditEntry.entity_id.in_(ids)).all()
        redacted = 0
        for row in rows:
            details = dict(row.details or {})
            scrubbed = {k: ("[erased]" if "email" in k.lower() else v) for k, v in details.items()}
            if scrubbed != details:
                row.details = scrubbed
                redacted += 1
        self.db.flush()
        return {"audit_entries_redacted": redacted}

    def _stage_ledger(self, request: ErasureRequest) -> dict:
        """Written outside the database, so a restored backup can be re-erased
        (`replay_ledger`). Ids only — no name, no email, no health value."""
        entry = {"request_id": str(request.id), "subject_user_id": str(request.subject_user_id),
                 "subject_member_id": str(request.subject_member_id), "scope": request.scope,
                 "policy_version": request.policy_version, "erased_at": self._now().isoformat()}
        self.media.put(f"{LEDGER_PREFIX}{request.id}.json", json.dumps(entry, sort_keys=True).encode("utf-8"),
                       "application/json")
        return {}

    def _queue_receipt(self, request: ErasureRequest) -> None:
        if not request.receipt_email:
            return
        label = "member profile and its data" if request.scope == SCOPE_MEMBER_DATA else "member profile and account"
        rendered = templates.erasure_receipt("", str(request.id), label, completed=True)
        outbox = self.notifications.queue("erasure_receipt", to_email=request.receipt_email, subject=rendered.subject,
                                          text=rendered.text, html=rendered.html, user=None,
                                          context={"erasure_request_id": str(request.id)},
                                          idempotency_key=f"erasure-receipt:{request.id}")
        request.receipt_outbox_id = outbox.id
        request.receipt_email = None

    # ---- restore safety ----------------------------------------------------------------
    def replay_ledger(self) -> dict:
        """Re-apply every erasure the ledger records to the current database.
        After a restore from a backup older than an erasure, the subject's rows
        reappear; this finds them and deletes them again."""
        reapplied = 0
        entries = 0
        for key in self.media.list_keys(LEDGER_PREFIX):
            entries += 1
            entry = json.loads(self.media.get(key))
            member_id, user_id = UUID(entry["subject_member_id"]), UUID(entry["subject_user_id"])
            present = self.db.get(Member, member_id) is not None or (
                entry["scope"] == SCOPE_ENTIRE_IDENTITY and self.db.get(UserAccount, user_id) is not None)
            if not present:
                continue
            replay = ErasureRequest(id=UUID(entry["request_id"]), subject_user_id=user_id, subject_member_id=member_id,
                                    scope=entry["scope"], state=STATE_ACCESS_CLOSED, requested_via="ledger_replay",
                                    policy_version=entry.get("policy_version", POLICY_VERSION))
            existing = self.db.get(ErasureRequest, replay.id)
            if existing is not None:
                existing.state, existing.stage, existing.completed_at = STATE_ACCESS_CLOSED, "", None
                replay = existing
            else:
                self.db.add(replay)
            user = self.db.get(UserAccount, user_id)
            if user is not None:
                if user.member_id == member_id:
                    user.member_id = None
                if entry["scope"] == SCOPE_ENTIRE_IDENTITY:
                    user.is_active = False
            self.db.commit()
            self.process(replay)
            reapplied += 1
        return {"ledger_entries": entries, "reapplied": reapplied}


def process_pending_erasures(db: Session, *, dry_run: bool = False) -> dict:
    """The scheduled job: finish anything requested but not yet erased."""
    from app.core.runtime import get_runtime

    runtime = get_runtime()
    pending = (db.query(ErasureRequest)
               .filter(ErasureRequest.state.in_(OPEN_STATES), ErasureRequest.attempts < MAX_ATTEMPTS)
               .order_by(ErasureRequest.requested_at).all())
    if dry_run:
        return {"pending": len(pending), "erased": 0, "blocked": 0}
    service = build_service(db, runtime)
    erased = blocked = 0
    for request in pending:
        outcome = service.process(request)
        erased += outcome.state == STATE_ERASED
        blocked += outcome.state == STATE_PURGE_BLOCKED
    for request in pending:
        if request.receipt_outbox_id:
            service.notifications.dispatch(request.receipt_outbox_id)
    return {"pending": len(pending), "erased": erased, "blocked": blocked}


def replay_erasure_ledger(db: Session, *, dry_run: bool = False) -> dict:
    from app.core.runtime import get_runtime

    runtime = get_runtime()
    if dry_run:
        return {"ledger_entries": len(runtime.media_store.list_keys(LEDGER_PREFIX)), "reapplied": 0}
    return build_service(db, runtime).replay_ledger()


def build_service(db: Session, runtime) -> ErasureService:
    return ErasureService(db, media=runtime.media_store, notifications=NotificationService(db, runtime.email),
                          pseudonym=runtime.telemetry.pseudonym, now=runtime.clock)


def subject_digest(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()
