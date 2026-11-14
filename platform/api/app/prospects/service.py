"""The rules around a visitor's saved result.

Four facts are kept apart on purpose (architecture V2 §4.1): agreeing to
storage, proving an email address, being signed in as a member, and deciding
to share health data with the team. Saving a result needs only the first.
Joining it to an account needs the other two kinds of proof as well:

  * a **claim capability** — the token the saving tab was handed, or the one
    delivered to the address that was typed — which shows the claimant is the
    person who saved it;
  * **proof of the address** — either the member's own verified account
    address is that same address, or the capability used was the emailed one,
    which only that mailbox ever received;
  * a **member session whose address is verified**.

An address typed into a form proves nothing, so an account that merely
registers with the same address gets nothing from here. Nothing the console
can do reads the answers or the number either: storage permission is not
viewing permission.

A saved result outlives nothing it should not. Every read treats a record whose
`expires_at` has passed as gone, whether or not the purge job has run yet, so a
stopped scheduler can delay the physical deletion but never extend what the
visitor agreed to.
"""

from __future__ import annotations

import hashlib
import json
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Callable
from uuid import UUID, uuid4

from sqlalchemy import func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.assessments.models import HealthNumberAttempt
from app.assessments.schemas import HealthNumberAnswers
from app.assessments.service import CALCULATION_VERSION, calculate_health_number
from app.auth.models import UserAccount
from app.policies.service import aware
from app.prospects.crypto import AnswerCipher, CipherError
from app.prospects.models import (
    ACTIVE_STATUSES,
    STATUS_CLAIMED,
    STATUS_ERASED,
    STATUS_EXPIRED,
    STATUS_LABELS,
    STATUS_PENDING_CLAIM,
    STATUS_UNVERIFIED,
    STATUS_VERIFIED,
    TOKEN_BROWSER,
    TOKEN_EMAIL,
    ProspectAssessment,
    ProspectEvent,
    ProspectToken,
)
from app.prospects.notice import notice_for
from app.prospects.retention import MODE_NEVER, RetentionPolicy, current_retention

# A token outlives neither the record nor a month: a Forever record can be
# reached again through "send me a new link", which needs the mailbox anyway.
TOKEN_MAX_DAYS = 30
# How many recent records one recovery request re-sends links for.
RECOVERY_LIMIT = 3


class ProspectError(Exception):
    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


# One wording for every token that does not lead anywhere: unknown, used,
# expired, erased, wrong purpose. Telling them apart from outside would tell a
# prober which addresses saved something.
NOT_AVAILABLE = "This link or saved result is no longer available."


def hash_token(raw: str) -> str:
    return hashlib.sha256((raw or "").encode("utf-8")).hexdigest()


def normalise_email(value: str) -> str:
    return (value or "").strip().lower()


def mask_email(value: str | None) -> str:
    """`ad•••@demo.veye.test`: enough for the visitor to recognise their own
    address and for an administrator to tell rows apart, not enough to read."""
    if not value or "@" not in value:
        return "—"
    local, domain = value.split("@", 1)
    shown = local[:2] if len(local) > 2 else local[:1]
    return f"{shown}{'•' * 3}@{domain}"


@dataclass(frozen=True)
class CaptureResult:
    prospect: ProspectAssessment
    result: Any                      # HealthNumberResult
    browser_token: str
    email_token: str
    replayed: bool


@dataclass(frozen=True)
class ClaimResult:
    prospect_id: UUID
    attempt_id: UUID
    deduplicated: bool
    already_claimed: bool


def _result_payload(result) -> dict:
    return {
        "raw_score": float(result.raw_score), "displayed_score": float(result.displayed_score),
        "status": result.status, "bucket": result.bucket, "category": result.category,
        "category_rule": result.category_rule, "interpretation": result.interpretation,
        "points": result.points,
    }


class ProspectService:
    def __init__(self, db: Session, *, cipher: AnswerCipher | None,
                 now: Callable[[], datetime] | None = None) -> None:
        self.db = db
        self.cipher = cipher
        self._now = now or (lambda: datetime.now(timezone.utc))

    def now(self) -> datetime:
        return self._now()

    # ---- capture -------------------------------------------------------------
    def capture(self, *, email: str, answers: HealthNumberAnswers, notice_version: str, notice_hash: str,
                idempotency_key: str, source: str = "onboarding") -> CaptureResult:
        policy = current_retention(self.db)
        if not policy.saving_enabled:
            raise ProspectError(409, "Saving results is switched off. Your Health Number can still be shown without being saved.")
        notice = notice_for(policy)
        assert notice is not None
        if notice_version != notice.version or notice_hash != notice.hash:
            raise ProspectError(409, "The notice about saving changed while you were reading it. Please read it again before saving.")
        if self.cipher is None:
            raise ProspectError(503, "Saving is not available right now. Your Health Number can still be shown without being saved.")
        address = normalise_email(email)
        key_hash = hash_token(idempotency_key)

        existing = (self.db.query(ProspectAssessment)
                    .filter(ProspectAssessment.idempotency_key_hash == key_hash).one_or_none())
        if existing is not None:
            return self._replay(existing, address, answers)

        now = self.now()
        result = calculate_health_number(answers)
        prospect_id = uuid4()
        payload = json.dumps({"answers": answers.model_dump(), "result": _result_payload(result),
                              "calculation_version": CALCULATION_VERSION}, sort_keys=True).encode("utf-8")
        prospect = ProspectAssessment(
            id=prospect_id, email_normalized=address,
            payload_ciphertext=self.cipher.encrypt(payload, aad=prospect_id.bytes),
            calculation_version=CALCULATION_VERSION, source=source, captured_at=now,
            consent_version=notice.version, consent_notice_hash=notice.hash, consent_at=now,
            retention_mode=policy.mode, retention_days=policy.days, retention_policy_version=policy.version,
            expires_at=policy.expires_at(now), status=STATUS_UNVERIFIED, idempotency_key_hash=key_hash,
            is_synthetic=address.endswith("@demo.veye.test"),
        )
        self.db.add(prospect)
        try:
            self.db.flush()
        except IntegrityError:
            # The same key arrived twice at once and the other one won.
            self.db.rollback()
            existing = (self.db.query(ProspectAssessment)
                        .filter(ProspectAssessment.idempotency_key_hash == key_hash).one_or_none())
            if existing is None:  # pragma: no cover - the constraint fired for a reason
                raise
            return self._replay(existing, address, answers)
        self._event(prospect, "captured", "visitor", policy_version=policy.version,
                    details={"retention_mode": policy.mode, "retention_days": policy.days,
                             "consent_version": notice.version, "source": source})
        browser = self._issue(prospect, TOKEN_BROWSER)
        emailed = self._issue(prospect, TOKEN_EMAIL)
        return CaptureResult(prospect=prospect, result=result, browser_token=browser, email_token=emailed,
                             replayed=False)

    def _replay(self, prospect: ProspectAssessment, address: str, answers: HealthNumberAnswers) -> CaptureResult:
        """A retry of the same submission. A key presented with a different
        address, or with different answers, is not a retry — it is another
        submission (or somebody else's key), and answering it with the stored
        result would show a visitor a number for answers they did not give."""
        refused = ProspectError(409, "That submission was already handled. Start the assessment again to save a new result.")
        if prospect.email_normalized != address or prospect.status not in ACTIVE_STATUSES or self._expired(prospect):
            raise refused
        payload = self._open(prospect)
        if payload.get("answers") != answers.model_dump():
            raise refused
        result = _Stored(payload["result"])
        # The raw tokens were never stored; a retry gets fresh ones and the
        # old browser token stops working, so only the latest tab holds one.
        self._burn(prospect, TOKEN_BROWSER)
        browser = self._issue(prospect, TOKEN_BROWSER)
        return CaptureResult(prospect=prospect, result=result, browser_token=browser, email_token="",
                             replayed=True)

    # ---- tokens ----------------------------------------------------------------
    def _issue(self, prospect: ProspectAssessment, purpose: str) -> str:
        raw = secrets.token_urlsafe(32)
        lifetime = self.now() + timedelta(days=TOKEN_MAX_DAYS)
        expiry = aware(prospect.expires_at)
        self.db.add(ProspectToken(prospect_id=prospect.id, purpose=purpose, token_hash=hash_token(raw),
                                  expires_at=min(lifetime, expiry) if expiry else lifetime))
        self.db.flush()
        return raw

    def _burn(self, prospect: ProspectAssessment, purpose: str | None = None) -> None:
        query = self.db.query(ProspectToken).filter(ProspectToken.prospect_id == prospect.id,
                                                    ProspectToken.used_at.is_(None))
        if purpose:
            query = query.filter(ProspectToken.purpose == purpose)
        query.update({"used_at": self.now()}, synchronize_session=False)
        self.db.flush()

    def resolve(self, raw_token: str, *, purposes: tuple[str, ...] = (TOKEN_BROWSER, TOKEN_EMAIL)
                ) -> tuple[ProspectAssessment, ProspectToken]:
        """The record a live token leads to, or one indistinguishable refusal."""
        if not raw_token or len(raw_token) > 200:
            raise ProspectError(404, NOT_AVAILABLE)
        token = (self.db.query(ProspectToken)
                 .filter(ProspectToken.token_hash == hash_token(raw_token)).one_or_none())
        if token is None or token.purpose not in purposes or token.used_at is not None:
            raise ProspectError(404, NOT_AVAILABLE)
        if aware(token.expires_at) <= self.now():
            raise ProspectError(404, NOT_AVAILABLE)
        prospect = self.db.get(ProspectAssessment, token.prospect_id)
        if prospect is None or prospect.status not in ACTIVE_STATUSES or self._expired(prospect):
            raise ProspectError(404, NOT_AVAILABLE)
        return prospect, token

    # ---- reading (never a health value) ------------------------------------------
    def describe(self, prospect: ProspectAssessment) -> dict:
        return {
            "status": prospect.status, "status_label": STATUS_LABELS.get(prospect.status, prospect.status),
            "email_masked": mask_email(prospect.email_normalized),
            "email_verified": prospect.email_verified_at is not None,
            "captured_at": aware(prospect.captured_at), "expires_at": aware(prospect.expires_at),
            "retention_mode": prospect.retention_mode, "retention_days": prospect.retention_days,
        }

    def confirm_email(self, raw_token: str) -> ProspectAssessment:
        """The emailed link was opened: that mailbox is reachable by whoever
        opened it. The token is not spent — it is still the claim capability."""
        prospect, _ = self.resolve(raw_token, purposes=(TOKEN_EMAIL,))
        if prospect.email_verified_at is None:
            prospect.email_verified_at = self.now()
            if prospect.status == STATUS_UNVERIFIED:
                prospect.status = STATUS_VERIFIED
            self._event(prospect, "email_verified", "visitor")
            self.db.flush()
        return prospect

    # ---- linking and claiming -------------------------------------------------------
    def link_at_signup(self, raw_token: str | None, *, user: UserAccount, attempt_id: UUID | None) -> str:
        """Called by sign-up with the token the onboarding tab held. Grants
        nothing: the new account already has its own copy of the submission
        (`attempt_id`), and this only remembers that the two are one, so the
        claim — once the address is proven — does not write a second attempt.
        Returns a short status for the sign-up response."""
        if not raw_token or user.member_id is None:
            return "none"
        try:
            prospect, token = self.resolve(raw_token)
        except ProspectError:
            return "unavailable"
        prospect.pending_member_id = user.member_id
        prospect.pending_attempt_id = attempt_id
        prospect.pending_proof = token.purpose
        prospect.status = STATUS_PENDING_CLAIM
        self._event(prospect, "linked_at_signup", "member", actor_user_id=user.id,
                    details={"proof": token.purpose, "same_address": prospect.email_normalized == normalise_email(user.email)})
        self.db.flush()
        # A pending link whose address is already proven completes when the
        # account's own address is verified (see finalize_for_verified_account).
        return "pending_verification"

    def finalize_for_verified_account(self, user: UserAccount) -> list[ClaimResult]:
        """The account's address was just verified. Complete every pending
        link that this proves: the same address, or a link made with the
        emailed capability (which only that mailbox received)."""
        if user.member_id is None or user.email_verified_at is None:
            return []
        out: list[ClaimResult] = []
        rows = (self.db.query(ProspectAssessment)
                .filter(ProspectAssessment.pending_member_id == user.member_id,
                        ProspectAssessment.status == STATUS_PENDING_CLAIM).all())
        for prospect in rows:
            if self._expired(prospect):
                continue
            same = prospect.email_normalized == normalise_email(user.email)
            if same or prospect.pending_proof == TOKEN_EMAIL:
                out.append(self._complete_claim(prospect, user, proof=prospect.pending_proof or TOKEN_BROWSER))
        return out

    def claim(self, raw_token: str, *, user: UserAccount) -> ClaimResult:
        """A signed-in member presents a capability."""
        if user.member_id is None:
            raise ProspectError(403, "This area is for Veye members.")
        if user.email_verified_at is None:
            raise ProspectError(409, "Verify your email address first. Your saved result stays where it is until you do.")
        token = (self.db.query(ProspectToken)
                 .filter(ProspectToken.token_hash == hash_token(raw_token or "")).one_or_none())
        if token is not None:
            prior = self.db.get(ProspectAssessment, token.prospect_id)
            # Two tabs, one click each: the second finds the work done.
            if prior is not None and prior.status == STATUS_CLAIMED and prior.claimed_member_id == user.member_id:
                return ClaimResult(prospect_id=prior.id, attempt_id=prior.claimed_attempt_id, deduplicated=True,
                                   already_claimed=True)
        prospect, token = self.resolve(raw_token)
        if token.purpose == TOKEN_BROWSER and prospect.email_normalized != normalise_email(user.email):
            raise ProspectError(409, "This result was saved under a different email address. Open the link we emailed "
                                     f"to {mask_email(prospect.email_normalized)} to add it to this account.")
        return self._complete_claim(prospect, user, proof=token.purpose)

    def _complete_claim(self, prospect: ProspectAssessment, user: UserAccount, *, proof: str) -> ClaimResult:
        # The conditional update is the lock: of two concurrent claims exactly
        # one moves the row out of an active state.
        moved = (self.db.query(ProspectAssessment)
                 .filter(ProspectAssessment.id == prospect.id, ProspectAssessment.status.in_(ACTIVE_STATUSES),
                         ProspectAssessment.claimed_member_id.is_(None))
                 .update({"status": STATUS_CLAIMED, "claimed_member_id": user.member_id,
                          "claimed_at": self.now()}, synchronize_session=False))
        self.db.flush()
        self.db.refresh(prospect)
        if moved != 1:
            if prospect.status == STATUS_CLAIMED and prospect.claimed_member_id == user.member_id:
                return ClaimResult(prospect_id=prospect.id, attempt_id=prospect.claimed_attempt_id,
                                   deduplicated=True, already_claimed=True)
            raise ProspectError(404, NOT_AVAILABLE)

        attempt_id: UUID | None = None
        deduplicated = False
        if prospect.pending_member_id == user.member_id and prospect.pending_attempt_id is not None:
            existing = self.db.get(HealthNumberAttempt, prospect.pending_attempt_id)
            if existing is not None and existing.member_id == user.member_id:
                attempt_id = existing.id
                deduplicated = True
        if attempt_id is None:
            payload = self._open(prospect)
            stored = payload["result"]
            attempt = HealthNumberAttempt(
                member_id=user.member_id, answers=payload["answers"],
                raw_score=Decimal(str(stored["raw_score"])), displayed_score=Decimal(str(stored["displayed_score"])),
                status=stored["status"], bucket=stored["bucket"], category=stored["category"],
                interpretation=stored["interpretation"],
                calculation_version=payload.get("calculation_version") or prospect.calculation_version,
                # The member took this assessment when they took it, not when
                # they signed up: their history keeps the real date.
                completed_at=aware(prospect.captured_at),
            )
            self.db.add(attempt)
            self.db.flush()
            attempt_id = attempt.id
        prospect.claimed_attempt_id = attempt_id
        # The member's own record now holds it; this copy is no longer needed.
        prospect.payload_ciphertext = None
        prospect.email_normalized = None
        prospect.pending_member_id = None
        prospect.pending_attempt_id = None
        self._burn(prospect)
        self._event(prospect, "claimed", "member", actor_user_id=user.id,
                    details={"proof": proof, "deduplicated": deduplicated})
        self.db.flush()
        return ClaimResult(prospect_id=prospect.id, attempt_id=attempt_id, deduplicated=deduplicated,
                           already_claimed=False)

    # ---- erasure ------------------------------------------------------------------
    def erase(self, prospect: ProspectAssessment, *, actor_type: str, actor_user_id: UUID | None = None,
              reason: str | None = None) -> bool:
        """Idempotent. Removes the payload and the address and keeps only the
        fact that a record existed and was deleted, for the conversion counts
        and so a repeated request answers the same way."""
        if prospect.status == STATUS_ERASED:
            return False
        prospect.status = STATUS_ERASED
        prospect.erased_at = prospect.purged_at = self.now()
        prospect.payload_ciphertext = None
        prospect.email_normalized = None
        prospect.pending_member_id = None
        prospect.pending_attempt_id = None
        self._burn(prospect)
        details = {"reason": (reason or "")[:200]} if reason else {}
        self._event(prospect, "erased", actor_type, actor_user_id=actor_user_id, details=details)
        self.db.flush()
        return True

    def erase_by_token(self, raw_token: str) -> None:
        prospect, _ = self.resolve(raw_token)
        self.erase(prospect, actor_type="visitor")

    # ---- recovery from another device ----------------------------------------------------
    def recovery_targets(self, email: str) -> list[tuple[ProspectAssessment, str]]:
        """Fresh emailed links for the address's live records. The caller
        sends them and answers identically whether or not any exist."""
        address = normalise_email(email)
        rows = (self.db.query(ProspectAssessment)
                .filter(ProspectAssessment.email_normalized == address,
                        ProspectAssessment.status.in_(ACTIVE_STATUSES))
                .order_by(ProspectAssessment.captured_at.desc(), ProspectAssessment.id.desc())
                .limit(RECOVERY_LIMIT).all())
        out = []
        for prospect in rows:
            if self._expired(prospect):
                continue
            self._burn(prospect, TOKEN_EMAIL)
            out.append((prospect, self._issue(prospect, TOKEN_EMAIL)))
            self._event(prospect, "link_resent", "visitor")
        return out

    # ---- retention ------------------------------------------------------------------
    def purge_expired(self, *, dry_run: bool = False) -> dict:
        """Physically remove what has expired. Safe to run any number of times
        and from any number of processes: a row already purged is no longer in
        an active state, so it is never touched twice."""
        now = self.now()
        due = (self.db.query(ProspectAssessment)
               .filter(ProspectAssessment.status.in_(ACTIVE_STATUSES),
                       ProspectAssessment.expires_at.is_not(None),
                       ProspectAssessment.expires_at <= now)
               .order_by(ProspectAssessment.expires_at, ProspectAssessment.id).all())
        if dry_run:
            return {"due": len(due), "purged": 0}
        purged = 0
        for prospect in due:
            moved = (self.db.query(ProspectAssessment)
                     .filter(ProspectAssessment.id == prospect.id, ProspectAssessment.status.in_(ACTIVE_STATUSES))
                     .update({"status": STATUS_EXPIRED, "payload_ciphertext": None, "email_normalized": None,
                              "pending_member_id": None, "pending_attempt_id": None, "purged_at": now},
                             synchronize_session=False))
            if moved == 1:
                self.db.query(ProspectToken).filter(ProspectToken.prospect_id == prospect.id).delete(synchronize_session=False)
                self._event(prospect, "purged", "system", details={"reason": "retention_elapsed"})
                purged += 1
        self.db.flush()
        return {"due": len(due), "purged": purged}

    def retention_impact(self, policy: RetentionPolicy) -> dict:
        """What applying `policy` to existing records would do. Counts only."""
        now = self.now()
        live = (self.db.query(ProspectAssessment)
                .filter(ProspectAssessment.status.in_(ACTIVE_STATUSES)).all())
        live = [p for p in live if not self._expired(p)]
        shorten = expire_now = unaffected = 0
        for prospect in live:
            proposed = policy.expires_at(aware(prospect.captured_at))
            current = aware(prospect.expires_at)
            if proposed is None or (current is not None and proposed >= current):
                unaffected += 1
            elif proposed <= now:
                expire_now += 1
            else:
                shorten += 1
        return {"active": len(live), "would_shorten": shorten, "would_expire_now": expire_now,
                "unaffected": unaffected}

    def apply_shorter_retention(self, policy: RetentionPolicy, *, actor_user_id: UUID | None) -> dict:
        """Move existing expiries EARLIER to match `policy`; never later. A
        record whose new expiry has already passed is purged right away."""
        now = self.now()
        changed = 0
        live = (self.db.query(ProspectAssessment)
                .filter(ProspectAssessment.status.in_(ACTIVE_STATUSES)).all())
        for prospect in live:
            if self._expired(prospect):
                continue
            proposed = policy.expires_at(aware(prospect.captured_at))
            current = aware(prospect.expires_at)
            if proposed is None or (current is not None and proposed >= current):
                continue
            prospect.expires_at = max(proposed, now) if policy.mode != MODE_NEVER else now
            self._event(prospect, "retention_shortened", "administrator", actor_user_id=actor_user_id,
                        policy_version=policy.version,
                        details={"to_mode": policy.mode, "to_days": policy.days})
            changed += 1
        self.db.flush()
        purged = self.purge_expired()["purged"]
        return {"shortened": changed, "purged_now": purged}

    # ---- the console's view (metadata only) -----------------------------------------------
    def counts(self) -> dict:
        rows = dict(self.db.query(ProspectAssessment.status, func.count(ProspectAssessment.id))
                    .group_by(ProspectAssessment.status).all())
        now = self.now()
        expired_unpurged = (self.db.query(func.count(ProspectAssessment.id))
                            .filter(ProspectAssessment.status.in_(ACTIVE_STATUSES),
                                    ProspectAssessment.expires_at.is_not(None),
                                    ProspectAssessment.expires_at <= now).scalar() or 0)
        soon = (self.db.query(func.count(ProspectAssessment.id))
                .filter(ProspectAssessment.status.in_(ACTIVE_STATUSES),
                        ProspectAssessment.expires_at.is_not(None),
                        ProspectAssessment.expires_at > now,
                        ProspectAssessment.expires_at <= now + timedelta(days=7)).scalar() or 0)
        active = sum(int(rows.get(s, 0)) for s in ACTIVE_STATUSES) - int(expired_unpurged)
        return {
            "unregistered": active,
            "unverified": int(rows.get(STATUS_UNVERIFIED, 0)),
            "verified": int(rows.get(STATUS_VERIFIED, 0)),
            "pending_claim": int(rows.get(STATUS_PENDING_CLAIM, 0)),
            "registered": int(rows.get(STATUS_CLAIMED, 0)),
            "expired": int(rows.get(STATUS_EXPIRED, 0)) + int(expired_unpurged),
            "deleted": int(rows.get(STATUS_ERASED, 0)),
            "expiring_within_7_days": int(soon),
            "awaiting_purge": int(expired_unpurged),
        }

    def effective_status(self, prospect: ProspectAssessment) -> str:
        """What the record is now, even if the purge job has not caught up."""
        if prospect.status in ACTIVE_STATUSES and self._expired(prospect):
            return STATUS_EXPIRED
        return prospect.status

    def list(self, *, status: str | None, q: str | None, sort: str, page: int, page_size: int
             ) -> tuple[list[ProspectAssessment], int]:
        now = self.now()
        query = self.db.query(ProspectAssessment)
        if status == "active":
            query = query.filter(ProspectAssessment.status.in_(ACTIVE_STATUSES),
                                 or_(ProspectAssessment.expires_at.is_(None), ProspectAssessment.expires_at > now))
        elif status == STATUS_EXPIRED:
            query = query.filter(or_(ProspectAssessment.status == STATUS_EXPIRED,
                                     (ProspectAssessment.status.in_(ACTIVE_STATUSES))
                                     & ProspectAssessment.expires_at.is_not(None)
                                     & (ProspectAssessment.expires_at <= now)))
        elif status in STATUS_LABELS:
            query = query.filter(ProspectAssessment.status == status)
            if status in ACTIVE_STATUSES:
                query = query.filter(or_(ProspectAssessment.expires_at.is_(None), ProspectAssessment.expires_at > now))
        if q:
            # Exact address only: a prefix search over people who never signed
            # up would make this list a way to discover them.
            query = query.filter(ProspectAssessment.email_normalized == normalise_email(q))
        total = query.count()
        order = {
            "captured_asc": (ProspectAssessment.captured_at.asc(), ProspectAssessment.id.asc()),
            "expires_asc": (ProspectAssessment.expires_at.asc(), ProspectAssessment.id.asc()),
        }.get(sort, (ProspectAssessment.captured_at.desc(), ProspectAssessment.id.desc()))
        rows = query.order_by(*order).offset((page - 1) * page_size).limit(page_size).all()
        return rows, total

    def events(self, prospect_id: UUID) -> list[ProspectEvent]:
        return (self.db.query(ProspectEvent).filter(ProspectEvent.prospect_id == prospect_id)
                .order_by(ProspectEvent.created_at.asc(), ProspectEvent.id.asc()).all())

    # ---- internals ----------------------------------------------------------------------
    def _expired(self, prospect: ProspectAssessment) -> bool:
        expiry = aware(prospect.expires_at)
        return expiry is not None and expiry <= self.now()

    def _open(self, prospect: ProspectAssessment) -> dict:
        if self.cipher is None or not prospect.payload_ciphertext:
            raise ProspectError(404, NOT_AVAILABLE)
        try:
            return json.loads(self.cipher.decrypt(prospect.payload_ciphertext, aad=prospect.id.bytes))
        except CipherError as exc:
            raise ProspectError(500, "This saved result could not be opened.") from exc

    def _event(self, prospect: ProspectAssessment, event_type: str, actor_type: str, *,
               actor_user_id: UUID | None = None, policy_version: int | None = None, details: dict | None = None) -> None:
        self.db.add(ProspectEvent(prospect_id=prospect.id, event_type=event_type, actor_type=actor_type,
                                  actor_user_id=actor_user_id, policy_version=policy_version,
                                  details=details or {}, created_at=self.now()))


class _Stored:
    """The stored result, shaped like a fresh calculation for the response."""

    def __init__(self, data: dict) -> None:
        self.raw_score = data["raw_score"]
        self.displayed_score = data["displayed_score"]
        self.status = data["status"]
        self.bucket = data["bucket"]
        self.category = data["category"]
        self.category_rule = data.get("category_rule", "")
        self.interpretation = data["interpretation"]
        self.points = data.get("points", {})
