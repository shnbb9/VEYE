"""Saved results before sign-up: the visitor's routes, the member's claim, and
the console's metadata-only view and retention settings.

Public routes carry no session and are rate limited; their refusals say the
same thing whether or not a record exists. No response from this module ever
contains a visitor's answers, and the only one that contains a Health Number
is the capture response itself — to the person who just took the quiz.
"""

from __future__ import annotations

import hashlib
import re
from datetime import datetime
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from app.admin.audit import record_audit
from app.assessments.schemas import HealthNumberAnswers
from app.assessments.service import CALCULATION_VERSION
from app.auth.models import UserAccount
from app.auth.principal import CurrentPrincipal, require_admin, require_member
from app.auth.schemas import EmailAddress
from app.core.config import settings as configured_settings
from app.core.rate_limit import RateLimiter, client_address
from app.core.runtime import Runtime, get_runtime
from app.db.session import SessionLocal, get_db
from app.jobs.runner import latest_run, run_job
from app.members.models import Member
from app.notifications import templates
from app.notifications.service import NotificationService
from app.policies.service import Actor, PolicyConflict, PolicyStore, aware
from app.prospects.crypto import AnswerCipher, CipherNotConfigured
from app.prospects.models import STATUS_CLAIMED, STATUS_LABELS, ProspectAssessment
from app.prospects.notice import NOT_SAVED_NOTE, NOTICE_VERSION, notice_for
from app.prospects.retention import (
    ALLOWED_DAYS,
    MODE_FOREVER,
    RETENTION_KEY,
    RetentionValue,
    current_retention,
    policy_from,
)
from app.prospects.service import ProspectError, ProspectService, mask_email

public_router = APIRouter(prefix="/api/v1/prospects", tags=["prospects"])
member_router = APIRouter(prefix="/api/v1/members/me/saved-results", tags=["prospects"])
admin_router = APIRouter(prefix="/api/v1/admin/prospects", tags=["admin-prospects"],
                         dependencies=[Depends(require_admin)])
privacy_router = APIRouter(prefix="/api/v1/admin/settings/privacy", tags=["admin-settings"],
                           dependencies=[Depends(require_admin)])

KEY_PATTERN = r"^[A-Za-z0-9._:-]{16,128}$"


def cipher_for(config=None) -> AnswerCipher | None:
    """The configured cipher, or None when this deployment may not save
    anything (production without a key). Never a silent fallback there."""
    config = config or get_runtime().settings
    raw = config.prospect_encryption_keys.get_secret_value() if config.prospect_encryption_keys else None
    try:
        return AnswerCipher.from_config(raw, production=config.is_production)
    except (CipherNotConfigured, ValueError):
        return None


def _service(db: Session, runtime: Runtime) -> ProspectService:
    return ProspectService(db, cipher=cipher_for(runtime.settings), now=runtime.clock)


def _raise(exc: ProspectError) -> None:
    raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


# ---- schemas ----------------------------------------------------------------------

class NoticeOut(BaseModel):
    version: str
    text: str
    consent_label: str
    hash: str
    privacy_path: str


class SavingPolicyOut(BaseModel):
    saving_enabled: bool
    retention_label: str
    not_saved_note: str
    notice: NoticeOut | None


class ConsentIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    # An unticked box is not sent at all: the browser previews instead.
    agreed: Literal[True]
    notice_version: str = Field(max_length=64)
    notice_hash: str = Field(min_length=64, max_length=64)


class CaptureIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    email: EmailAddress
    answers: HealthNumberAnswers
    consent: ConsentIn
    idempotency_key: str = Field(pattern=KEY_PATTERN)


class CaptureResultOut(BaseModel):
    raw_score: float
    displayed_score: float
    status: str
    bucket: str
    category: str
    category_rule: str
    interpretation: str
    calculation_version: str
    points: dict[str, float]


class SavedStatusOut(BaseModel):
    status: str
    status_label: str
    email_masked: str
    email_verified: bool
    captured_at: datetime
    expires_at: datetime | None
    retention_mode: str
    retention_days: int | None


class CaptureOut(BaseModel):
    result: CaptureResultOut
    saved: SavedStatusOut
    claim_token: str
    confirmation_email: str          # sent | failed | queued | retry | skipped
    replayed: bool


class TokenIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    token: str = Field(min_length=16, max_length=200)


class RecoverIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    email: EmailAddress


class ClaimOut(BaseModel):
    attempt_id: UUID
    deduplicated: bool
    already_claimed: bool


class RegisteredMember(BaseModel):
    member_id: UUID
    name: str


class ProspectRowOut(BaseModel):
    id: UUID
    email_masked: str
    status: str
    status_label: str
    captured_at: datetime
    expires_at: datetime | None
    retention_label: str
    source: str
    email_verified: bool
    registered_member: RegisteredMember | None
    claimed_at: datetime | None
    erased_at: datetime | None
    # Always the same sentence: the console can never ask a prospect to share.
    sharing_note: str = "Sharing is available after sign-up and email verification."


class ProspectEventOut(BaseModel):
    event_type: str
    label: str
    actor_type: str
    at: datetime
    policy_version: int | None


class ProspectDetailOut(ProspectRowOut):
    consent_version: str
    retention_policy_version: int
    calculation_version: str
    events: list[ProspectEventOut]


class ProspectsPageOut(BaseModel):
    rows: list[ProspectRowOut]
    total: int
    page: int
    page_size: int
    counts: dict[str, int]
    retention_label: str
    saving_enabled: bool


class EraseIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reason: str = Field(default="", max_length=200)


EVENT_LABELS = {
    "captured": "Saved by the visitor",
    "email_verified": "Address confirmed from its mailbox",
    "linked_at_signup": "Linked to a new account, waiting for the address to be proven",
    "claimed": "Added to the member's own record",
    "purged": "Retention elapsed; answers and address removed",
    "erased": "Deleted",
    "link_resent": "A new link was sent",
    "retention_shortened": "Expiry moved earlier by a shorter retention policy",
}


def _retention_label(row: ProspectAssessment) -> str:
    if row.retention_mode == MODE_FOREVER:
        return "Until deleted"
    if row.retention_days:
        return f"{row.retention_days} days"
    return "—"


def _row(db: Session, service: ProspectService, row: ProspectAssessment) -> ProspectRowOut:
    effective = service.effective_status(row)
    registered = None
    if row.status == STATUS_CLAIMED and row.claimed_member_id is not None:
        member = db.get(Member, row.claimed_member_id)
        if member is not None:
            registered = RegisteredMember(member_id=member.id, name=member.display_name)
    return ProspectRowOut(
        id=row.id, email_masked=mask_email(row.email_normalized), status=effective,
        status_label=STATUS_LABELS.get(effective, effective), captured_at=aware(row.captured_at),
        expires_at=aware(row.expires_at), retention_label=_retention_label(row), source=row.source,
        email_verified=row.email_verified_at is not None, registered_member=registered,
        claimed_at=aware(row.claimed_at), erased_at=aware(row.erased_at),
    )


def _status_out(service: ProspectService, row: ProspectAssessment) -> SavedStatusOut:
    return SavedStatusOut(**service.describe(row))


def _send_confirmation(db: Session, runtime: Runtime, prospect: ProspectAssessment, email_token: str) -> str:
    """Queue the confirmation in the capture's own transaction; the caller
    commits and then dispatches, so the message never describes a record that
    did not get saved."""
    base = runtime.settings.web_base_url
    rendered = templates.prospect_confirmation(
        link=f"{base}/saved-result?token={email_token}", expires_at=aware(prospect.expires_at),
        support_email=None)
    outbox = NotificationService(db, runtime.email).queue(
        "prospect_confirmation", to_email=prospect.email_normalized or "", subject=rendered.subject,
        text=rendered.text, html=rendered.html, context={"prospect_id": str(prospect.id)})
    return str(outbox.id)


# ---- the visitor's routes ------------------------------------------------------------

@public_router.get("/policy", response_model=SavingPolicyOut)
def saving_policy(db: Session = Depends(get_db), runtime: Runtime = Depends(get_runtime)) -> SavingPolicyOut:
    """What the result gate shows. Saving is offered only when a policy says
    so AND this deployment can encrypt — never one without the other."""
    policy = current_retention(db)
    notice = notice_for(policy)
    available = notice is not None and cipher_for(runtime.settings) is not None
    return SavingPolicyOut(
        saving_enabled=available, retention_label=policy.label, not_saved_note=NOT_SAVED_NOTE,
        notice=NoticeOut(version=notice.version, text=notice.text, consent_label=notice.consent_label,
                         hash=notice.hash, privacy_path=notice.privacy_path) if available and notice else None,
    )


@public_router.post("/assessment", response_model=CaptureOut, status_code=status.HTTP_201_CREATED)
def capture(payload: CaptureIn, request: Request, db: Session = Depends(get_db),
            runtime: Runtime = Depends(get_runtime)) -> CaptureOut:
    # Unlimited, this is a way to make Veye email strangers.
    RateLimiter(db, runtime.settings).enforce("prospect_capture", subject=f"ip:{client_address(request)}")
    service = _service(db, runtime)
    try:
        outcome = service.capture(email=str(payload.email), answers=payload.answers,
                                  notice_version=payload.consent.notice_version,
                                  notice_hash=payload.consent.notice_hash,
                                  idempotency_key=payload.idempotency_key)
    except ProspectError as exc:
        db.commit()  # keep the rate-limit hit
        _raise(exc)
    outbox_id = None
    if not outcome.replayed:
        outbox_id = _send_confirmation(db, runtime, outcome.prospect, outcome.email_token)
    db.commit()
    delivery = "already_sent" if outcome.replayed else "queued"
    if outbox_id:
        sent = NotificationService(db, runtime.email).dispatch(UUID(outbox_id))
        delivery = sent.status if sent is not None else "queued"
    db.refresh(outcome.prospect)
    result = outcome.result
    return CaptureOut(
        result=CaptureResultOut(raw_score=float(result.raw_score), displayed_score=float(result.displayed_score),
                                status=result.status, bucket=result.bucket, category=result.category,
                                category_rule=result.category_rule, interpretation=result.interpretation,
                                calculation_version=outcome.prospect.calculation_version or CALCULATION_VERSION,
                                points=result.points),
        saved=_status_out(service, outcome.prospect), claim_token=outcome.browser_token,
        confirmation_email=delivery, replayed=outcome.replayed,
    )


@public_router.post("/status", response_model=SavedStatusOut)
def saved_status(payload: TokenIn, request: Request, db: Session = Depends(get_db),
                 runtime: Runtime = Depends(get_runtime)) -> SavedStatusOut:
    """POST, not GET: the token is a capability and has no business in a URL
    that proxies and browser history keep."""
    RateLimiter(db, runtime.settings).enforce("prospect_token", subject=f"ip:{client_address(request)}")
    service = _service(db, runtime)
    try:
        prospect, _ = service.resolve(payload.token)
    except ProspectError as exc:
        db.commit()
        _raise(exc)
    db.commit()
    return _status_out(service, prospect)


@public_router.post("/confirm", response_model=SavedStatusOut)
def confirm(payload: TokenIn, request: Request, db: Session = Depends(get_db),
            runtime: Runtime = Depends(get_runtime)) -> SavedStatusOut:
    RateLimiter(db, runtime.settings).enforce("prospect_token", subject=f"ip:{client_address(request)}")
    service = _service(db, runtime)
    try:
        prospect = service.confirm_email(payload.token)
    except ProspectError as exc:
        db.commit()
        _raise(exc)
    db.commit()
    return _status_out(service, prospect)


@public_router.post("/erase", status_code=status.HTTP_200_OK)
def erase(payload: TokenIn, request: Request, db: Session = Depends(get_db),
          runtime: Runtime = Depends(get_runtime)) -> dict:
    RateLimiter(db, runtime.settings).enforce("prospect_token", subject=f"ip:{client_address(request)}")
    service = _service(db, runtime)
    try:
        service.erase_by_token(payload.token)
    except ProspectError as exc:
        db.commit()
        _raise(exc)
    db.commit()
    return {"erased": True, "message": "Your saved result and the address you gave have been deleted."}


RECOVER_MESSAGE = ("If a saved result exists for that address, we have emailed a new link to it. "
                   "The link works only from that mailbox.")


@public_router.post("/recover", status_code=status.HTTP_202_ACCEPTED)
def recover(payload: RecoverIn, request: Request, db: Session = Depends(get_db),
            runtime: Runtime = Depends(get_runtime)) -> dict:
    """From another device: email new links to the address's live records.
    Same answer either way, and limited per caller AND per address (hashed,
    so the limiter does not become a list of probed addresses)."""
    limiter = RateLimiter(db, runtime.settings)
    limiter.enforce("prospect_recover", subject=f"ip:{client_address(request)}")
    address_key = hashlib.sha256(str(payload.email).strip().lower().encode()).hexdigest()[:32]
    limiter.enforce("prospect_recover_address", subject=f"addr:{address_key}")
    service = _service(db, runtime)
    outbox_ids = [_send_confirmation(db, runtime, prospect, token)
                  for prospect, token in service.recovery_targets(str(payload.email))]
    db.commit()
    notifications = NotificationService(db, runtime.email)
    for outbox_id in outbox_ids:
        notifications.dispatch(UUID(outbox_id))
    return {"accepted": True, "message": RECOVER_MESSAGE}


# ---- the member's claim -------------------------------------------------------------

@member_router.post("/claim", response_model=ClaimOut)
def claim(payload: TokenIn, principal: CurrentPrincipal = Depends(require_member), db: Session = Depends(get_db),
          runtime: Runtime = Depends(get_runtime)) -> ClaimOut:
    user = db.get(UserAccount, principal.user_id)
    if user is None:
        raise HTTPException(status_code=401, detail="Please sign in again.")
    service = _service(db, runtime)
    try:
        result = service.claim(payload.token, user=user)
    except ProspectError as exc:
        db.rollback()
        _raise(exc)
    db.commit()
    return ClaimOut(attempt_id=result.attempt_id, deduplicated=result.deduplicated,
                    already_claimed=result.already_claimed)


# ---- the console: metadata only --------------------------------------------------------

STATUS_FILTERS = ("active", "unverified", "verified", "pending_claim", "claimed", "expired", "erased")


@admin_router.get("", response_model=ProspectsPageOut)
def list_prospects(status_filter: str | None = Query(default=None, alias="status"),
                   q: str | None = Query(default=None, max_length=320),
                   sort: Literal["captured_desc", "captured_asc", "expires_asc"] = "captured_desc",
                   page: int = Query(default=1, ge=1, le=10_000), page_size: int = Query(default=25, ge=1, le=100),
                   db: Session = Depends(get_db), runtime: Runtime = Depends(get_runtime)) -> ProspectsPageOut:
    if status_filter is not None and status_filter not in STATUS_FILTERS:
        raise HTTPException(status_code=422, detail="Unknown status filter.")
    service = _service(db, runtime)
    rows, total = service.list(status=status_filter, q=(q or "").strip() or None, sort=sort, page=page,
                               page_size=page_size)
    policy = current_retention(db)
    return ProspectsPageOut(rows=[_row(db, service, r) for r in rows], total=total, page=page, page_size=page_size,
                            counts=service.counts(), retention_label=policy.label,
                            saving_enabled=policy.saving_enabled and cipher_for(runtime.settings) is not None)


def _get_prospect(db: Session, prospect_id: UUID) -> ProspectAssessment:
    row = db.get(ProspectAssessment, prospect_id)
    if row is None:
        raise HTTPException(status_code=404, detail="That saved result was not found.")
    return row


@admin_router.get("/{prospect_id}", response_model=ProspectDetailOut)
def prospect_detail(prospect_id: UUID, db: Session = Depends(get_db),
                    runtime: Runtime = Depends(get_runtime)) -> ProspectDetailOut:
    service = _service(db, runtime)
    row = _get_prospect(db, prospect_id)
    base = _row(db, service, row)
    return ProspectDetailOut(
        **base.model_dump(), consent_version=row.consent_version,
        retention_policy_version=row.retention_policy_version, calculation_version=row.calculation_version,
        events=[ProspectEventOut(event_type=e.event_type, label=EVENT_LABELS.get(e.event_type, e.event_type),
                                 actor_type=e.actor_type, at=aware(e.created_at), policy_version=e.policy_version)
                for e in service.events(row.id)],
    )


@admin_router.post("/{prospect_id}/erase", response_model=ProspectRowOut)
def admin_erase(prospect_id: UUID, payload: EraseIn, principal: CurrentPrincipal = Depends(require_admin),
                db: Session = Depends(get_db), runtime: Runtime = Depends(get_runtime)) -> ProspectRowOut:
    """For a deletion request that reached the team another way (a phone
    call, an email). It only ever removes data."""
    service = _service(db, runtime)
    row = _get_prospect(db, prospect_id)
    if service.erase(row, actor_type="administrator", actor_user_id=principal.user_id, reason=payload.reason):
        record_audit(db, principal, "prospect.erased", "prospect", str(row.id),
                     {"reason": (payload.reason or "")[:200]})
    db.commit()
    return _row(db, service, row)


# ---- the console: retention settings ----------------------------------------------------

class RetentionIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    mode: Literal["never", "days", "forever"]
    days: int | None = None
    # Forever has to be chosen on purpose, every time it is chosen.
    acknowledge_forever: bool = False
    note: str = Field(default="", max_length=300)


class ImpactOut(BaseModel):
    active: int
    would_shorten: int
    would_expire_now: int
    unaffected: int
    applies_to_new_captures: str
    lengthens_existing: bool = False


class JobRunOut(BaseModel):
    job: str
    status: str
    dry_run: bool
    started_at: datetime
    finished_at: datetime | None
    counts: dict
    error: str | None
    triggered_by: str


class PolicyVersionOut(BaseModel):
    version: int
    label: str
    published_at: datetime | None
    published_by: str
    note: str | None


class PrivacySettingsOut(BaseModel):
    mode: str
    days: int | None
    label: str
    version: int
    published_at: datetime | None
    published_by: str
    is_default: bool
    options: list[dict]
    encryption_ready: bool
    encryption_is_development_key: bool
    notice_version: str
    notice_preview: str | None
    notice_status: str
    counts: dict[str, int]
    last_cleanup: JobRunOut | None
    history: list[PolicyVersionOut]


def _job_out(run) -> JobRunOut | None:
    if run is None:
        return None
    return JobRunOut(job=run.job, status=run.status, dry_run=run.dry_run, started_at=aware(run.started_at),
                     finished_at=aware(run.finished_at), counts=run.counts or {}, error=run.error,
                     triggered_by=run.triggered_by)


OPTIONS = [{"mode": "never", "days": None, "label": "Never"}] + [
    {"mode": "days", "days": d, "label": f"{d} days"} for d in ALLOWED_DAYS] + [
    {"mode": "forever", "days": None, "label": "Forever"}]


def _privacy_out(db: Session, runtime: Runtime) -> PrivacySettingsOut:
    policy = current_retention(db)
    cipher = cipher_for(runtime.settings)
    notice = notice_for(policy) if policy.saving_enabled else notice_for(policy_from(RetentionValue(mode="days", days=30)))
    history = PolicyStore(db).history(RETENTION_KEY)
    return PrivacySettingsOut(
        mode=policy.mode, days=policy.days, label=policy.label, version=policy.version,
        published_at=policy.published_at, published_by=policy.published_by, is_default=policy.version == 0,
        options=OPTIONS, encryption_ready=cipher is not None,
        encryption_is_development_key=bool(cipher and cipher.is_development_key),
        notice_version=NOTICE_VERSION, notice_preview=notice.text if notice else None,
        notice_status="Engineering draft — have it approved before switching saving on.",
        counts=_service(db, runtime).counts(), last_cleanup=_job_out(latest_run(db, "purge-prospects")),
        history=[PolicyVersionOut(version=int(r.version or 0),
                                  label=policy_from(RetentionValue.model_validate(r.value)).label,
                                  published_at=aware(r.published_at), published_by=r.published_by_name or "",
                                  note=r.note) for r in history],
    )


def _validated(payload: RetentionIn) -> RetentionValue:
    try:
        return RetentionValue(mode=payload.mode, days=payload.days)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc).split("\n")[-1].strip()) from exc


@privacy_router.get("", response_model=PrivacySettingsOut)
def privacy_settings(db: Session = Depends(get_db), runtime: Runtime = Depends(get_runtime)) -> PrivacySettingsOut:
    return _privacy_out(db, runtime)


@privacy_router.post("/preview", response_model=ImpactOut)
def preview_retention(payload: RetentionIn, db: Session = Depends(get_db),
                      runtime: Runtime = Depends(get_runtime)) -> ImpactOut:
    """Counts only. Nothing changes until the policy is published, and
    existing records change only through the separate shorten action."""
    proposed = policy_from(_validated(payload))
    current = current_retention(db)
    impact = _service(db, runtime).retention_impact(proposed)
    return ImpactOut(**impact, applies_to_new_captures=proposed.label,
                     lengthens_existing=proposed.length > current.length)


@privacy_router.put("", response_model=PrivacySettingsOut)
def publish_retention(payload: RetentionIn, principal: CurrentPrincipal = Depends(require_admin),
                      db: Session = Depends(get_db), runtime: Runtime = Depends(get_runtime)) -> PrivacySettingsOut:
    value = _validated(payload)
    if value.mode == MODE_FOREVER and not payload.acknowledge_forever:
        raise HTTPException(status_code=422, detail="Keeping results forever needs your explicit confirmation, "
                                                    "and the owner's and counsel's approval.")
    if value.mode != "never" and cipher_for(runtime.settings) is None:
        raise HTTPException(status_code=409, detail="Saving cannot be switched on: this deployment has no "
                                                    "encryption key for saved answers.")
    current = current_retention(db)
    if current.version and current.value() == value.model_dump():
        raise HTTPException(status_code=409, detail="That is already the current retention policy.")
    try:
        row = PolicyStore(db).publish(RETENTION_KEY, value.model_dump(),
                                      by=Actor(principal.user_id, principal.display_name),
                                      note=(payload.note or None))
    except PolicyConflict as exc:
        raise HTTPException(status_code=409, detail="Someone else changed this setting at the same moment. "
                                                    "Reload and try again.") from exc
    record_audit(db, principal, "settings.prospect_retention.published", "policy", RETENTION_KEY,
                 {"version": row.version, "mode": value.mode, "days": value.days,
                  "previous_version": current.version, "acknowledged_forever": bool(payload.acknowledge_forever)})
    db.commit()
    return _privacy_out(db, runtime)


class ConfirmIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    confirm: Literal[True]


@privacy_router.post("/apply-shorter")
def apply_shorter(payload: ConfirmIn, principal: CurrentPrincipal = Depends(require_admin),
                  db: Session = Depends(get_db), runtime: Runtime = Depends(get_runtime)) -> dict:
    policy = current_retention(db)
    if policy.version == 0:
        raise HTTPException(status_code=409, detail="Publish a retention policy first.")
    outcome = _service(db, runtime).apply_shorter_retention(policy, actor_user_id=principal.user_id)
    record_audit(db, principal, "settings.prospect_retention.applied_to_existing", "policy", RETENTION_KEY,
                 {"version": policy.version, **outcome})
    db.commit()
    return outcome


class CleanupIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    dry_run: bool = True


@privacy_router.post("/cleanup", response_model=JobRunOut)
def run_cleanup(payload: CleanupIn, principal: CurrentPrincipal = Depends(require_admin),
                db: Session = Depends(get_db)) -> JobRunOut:
    """The scheduled purge, on demand. A dry run counts what is due."""
    record_audit(db, principal, "settings.prospect_retention.cleanup", "policy", RETENTION_KEY,
                 {"dry_run": payload.dry_run})
    db.commit()
    run = run_job(SessionLocal, "purge-prospects", dry_run=payload.dry_run,
                  triggered_by=f"console: {principal.display_name}")
    return _job_out(run)
