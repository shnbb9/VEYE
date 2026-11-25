"""Health Data Sharing Permission: the member's half and the console's half.

The asymmetry is the design. A member can grant, decline and withdraw. An
administrator can ask, and read the state they were given. There is no admin
route that sets a member's permission, and adding one would defeat the point
of having the permission at all.

Since V2 (architecture §4) the console can also *tell* the member they were
asked — an email whose button opens the app and grants nothing — and edit the
email and the terms through versioned drafts. A decision is recorded against
the exact published terms the member was shown (version and hash), and a
decision posted against terms that have since changed is refused.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.admin.audit import record_audit
from app.auth.models import UserAccount
from app.auth.principal import CurrentPrincipal, require_admin, require_member
from app.core.rate_limit import RateLimiter, client_address
from app.core.runtime import Runtime, get_runtime
from app.db.session import get_db
from app.health_permission.models import (
    POLICY_VERSION,
    SOURCE_AUTOMATIC,
    STATE_LABELS,
    STATE_REQUESTED,
    MemberHealthPermission,
)
from app.health_permission.policy import (
    CATEGORIES,
    COMPANION_USE,
    CTA_LABEL,
    EXPIRY_RULE,
    NOT_COVERED,
    NOTIFICATION_KEY,
    RESEND_CHOICES,
    TEMPLATE_KEY,
    TEMPLATE_VARIABLES,
    TERMS_KEY,
    TERMS_VARIABLES,
    WITHDRAWAL,
    NotificationValue,
    TemplateValue,
    TermsValue,
    current_notification,
    current_template,
    current_terms,
    is_material_change,
    terms_hash,
)
from app.health_permission.requests import SharingRequestError, SharingRequests, review_link
from app.health_permission.schemas import (
    DecisionIn,
    DeliveryStatusOut,
    HealthPermissionEventOut,
    HealthPermissionOut,
    NotificationIn,
    OpenRequestOut,
    RequestIn,
    TemplateIn,
    TermsIn,
    TermsOut,
)
from app.health_permission.service import HealthPermissionService, PermissionError_
from app.members.models import Member
from app.notifications import templates
from app.notifications.service import NotificationService
from app.policies.richtext import render_html, render_text, substitute
from app.policies.service import Actor, PolicyConflict, PolicyStore, aware

member_router = APIRouter(prefix="/api/v1/members/me/health-permission", tags=["health-permission"])
admin_router = APIRouter(prefix="/api/v1/admin/members", tags=["admin-health-permission"],
                         dependencies=[Depends(require_admin)])
settings_router = APIRouter(prefix="/api/v1/admin/settings/health-sharing", tags=["admin-settings"],
                            dependencies=[Depends(require_admin)])

# The one-paragraph explanation kept beside the version it is stamped with, so
# the words and the version can never drift apart. Since V2 it is the plain
# text of the current terms' summary.
EXPLANATION = (
    "Sharing lets the Veye team open your saved results — your Health Number, body "
    "composition, blood markers, questionnaires and moods — when they are helping you, "
    "and lets Veye Companion use them to answer you about your own progress. Until you "
    "share them, nobody at Veye can see them and Sprout answers without them. Your name, "
    "email, the messages you send and your food diary are not covered by this and stay "
    "visible to the team so they can help you. You can withdraw sharing at any time, and "
    "it stops at once."
)


def _support(db: Session) -> str:
    try:
        from app.product_settings.routes import read_support

        return read_support(db).support_email
    except Exception:
        return ""


def _terms_out(db: Session) -> TermsOut:
    terms = current_terms(db)
    return TermsOut(**terms.rendered({"organization_name": "Veye", "support_email": _support(db) or "the Veye team"}))


def _event_out(e) -> HealthPermissionEventOut:
    return HealthPermissionEventOut(
        id=e.id, from_state=e.from_state, to_state=e.to_state, actor=e.actor, actor_name=e.actor_name,
        source=e.source, policy_version=e.policy_version, created_at=e.created_at,
        terms_version=e.terms_version, terms_hash=e.terms_hash, scope=e.scope, purpose=e.purpose,
        recipient=e.recipient, expiry_rule=e.expiry_rule, note=e.note)


def permission_out(row: MemberHealthPermission, *, include_events: bool, db: Session | None = None,
                   include_terms: bool = False) -> HealthPermissionOut:
    current = POLICY_VERSION
    terms = None
    if db is not None:
        latest = current_terms(db)
        current = latest.label
        if include_terms:
            terms = _terms_out(db)
    open_request = None
    if row.state == STATE_REQUESTED and row.request_ref:
        automatic = bool(row.events) and row.events[-1].source == SOURCE_AUTOMATIC
        open_request = OpenRequestOut(ref=row.request_ref, requested_at=row.requested_at,
                                      requested_by_name=row.requested_by_name or "", automatic=automatic)
    return HealthPermissionOut(
        state=row.state, state_label=STATE_LABELS.get(row.state, row.state),
        shares_health_data=row.shares_health_data,
        policy_version=row.policy_version or "", current_policy_version=current,
        explanation=EXPLANATION,
        requested_at=row.requested_at, requested_by_name=row.requested_by_name or "",
        decided_at=row.decided_at, revoked_at=row.revoked_at,
        events=[_event_out(e) for e in (row.events if include_events else [])],
        terms=terms, open_request=open_request,
    )


def _raise(exc: PermissionError_ | SharingRequestError) -> None:
    raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


def _account(db: Session, principal: CurrentPrincipal) -> UserAccount:
    user = db.get(UserAccount, principal.user_id)
    if user is None:
        raise HTTPException(status_code=401, detail="Please sign in again.")
    return user


def _decision_terms(db: Session, user: UserAccount, payload: DecisionIn, row: MemberHealthPermission):
    """A decision needs a verified address and the CURRENT terms."""
    if user.email_verified_at is None:
        raise HTTPException(status_code=409, detail="Verify your email address first — we sent you a link when you "
                                                    "signed up, and you can send it again from Settings.")
    terms = current_terms(db)
    if payload.terms_version != terms.version or payload.terms_hash != terms.hash:
        raise HTTPException(status_code=409, detail="The terms changed while you were reading them. Please read "
                                                    "the current version before deciding.")
    if payload.request_ref and payload.request_ref != row.request_ref:
        raise HTTPException(status_code=404, detail=NOT_OPEN)
    return terms


NOT_OPEN = "This request is not for this account, or it is no longer open."


# ---- the member's half ---------------------------------------------------------

@member_router.get("", response_model=HealthPermissionOut)
def my_permission(principal: CurrentPrincipal = Depends(require_member),
                  db: Session = Depends(get_db)) -> HealthPermissionOut:
    assert principal.member_id is not None
    row = HealthPermissionService(db).for_member(principal.member_id)
    db.commit()
    out = permission_out(row, include_events=True, db=db, include_terms=True)
    out.email_verified = principal.email_verified
    return out


@member_router.get("/request/{ref}", response_model=HealthPermissionOut)
def review_request(ref: str, principal: CurrentPrincipal = Depends(require_member),
                   db: Session = Depends(get_db)) -> HealthPermissionOut:
    """What the emailed button leads to, once the member is signed in. The
    reference only identifies the request: it must belong to THIS member and
    still be open, and it opens nothing by itself."""
    assert principal.member_id is not None
    row = HealthPermissionService(db).current(principal.member_id)
    if row is None or row.state != STATE_REQUESTED or not row.request_ref or row.request_ref != ref:
        raise HTTPException(status_code=404, detail=NOT_OPEN)
    out = permission_out(row, include_events=False, db=db, include_terms=True)
    out.email_verified = principal.email_verified
    return out


@member_router.post("/grant", response_model=HealthPermissionOut)
def grant(payload: DecisionIn, principal: CurrentPrincipal = Depends(require_member),
          db: Session = Depends(get_db)) -> HealthPermissionOut:
    """Only this route, reached from the application by the member themselves,
    can open the records. Nothing is granted by replying to an email or by
    opening its link."""
    assert principal.member_id is not None
    user = _account(db, principal)
    service = HealthPermissionService(db)
    row = service.for_member(principal.member_id)
    terms = _decision_terms(db, user, payload, row)
    row = service.grant(principal.member_id, by_user_id=principal.user_id, by_name=principal.display_name,
                        terms=terms, request_ref=payload.request_ref)
    db.commit()
    return permission_out(row, include_events=True, db=db, include_terms=True)


@member_router.post("/decline", response_model=HealthPermissionOut)
def decline(payload: DecisionIn, principal: CurrentPrincipal = Depends(require_member),
            db: Session = Depends(get_db)) -> HealthPermissionOut:
    assert principal.member_id is not None
    user = _account(db, principal)
    service = HealthPermissionService(db)
    row = service.for_member(principal.member_id)
    terms = _decision_terms(db, user, payload, row)
    row = service.decline(principal.member_id, by_user_id=principal.user_id, by_name=principal.display_name,
                          terms=terms, request_ref=payload.request_ref)
    db.commit()
    return permission_out(row, include_events=True, db=db, include_terms=True)


@member_router.post("/revoke", response_model=HealthPermissionOut)
def revoke(principal: CurrentPrincipal = Depends(require_member),
           db: Session = Depends(get_db)) -> HealthPermissionOut:
    """Withdrawing never waits on anything: no verification, no terms check."""
    assert principal.member_id is not None
    try:
        row = HealthPermissionService(db).revoke(principal.member_id, by_user_id=principal.user_id,
                                                 by_name=principal.display_name,
                                                 terms_label=current_terms(db).label)
    except PermissionError_ as exc:
        _raise(exc)
    db.commit()
    return permission_out(row, include_events=True, db=db, include_terms=True)


# ---- the console's half --------------------------------------------------------

def _member_or_404(db: Session, member_id: UUID) -> Member:
    member = db.get(Member, member_id)
    if member is None or member.erasure_requested_at is not None:
        # Not a row created on the fly: an unknown id is simply not found, and
        # neither is a member who asked to be deleted.
        raise HTTPException(status_code=404, detail="That member was not found.")
    return member


def _requests(db: Session, runtime: Runtime) -> SharingRequests:
    return SharingRequests(db, NotificationService(db, runtime.email), web_base_url=runtime.settings.web_base_url,
                           now=runtime.clock)


def _console_out(db: Session, runtime: Runtime, member_id: UUID, row: MemberHealthPermission) -> HealthPermissionOut:
    requests = _requests(db, runtime)
    out = permission_out(row, include_events=True, db=db)
    allowed = requests.eligibility(member_id)
    out.can_request, out.cannot_request_reason = allowed.can_request, allowed.reason
    out.requires_reason, out.next_request_at = allowed.requires_reason, allowed.next_request_at
    user = requests.account_for(member_id)
    out.email_verified = bool(user and user.email_verified_at)
    outbox = requests.latest_delivery(row)
    if outbox is not None:
        out.delivery = DeliveryStatusOut(status=outbox.status, attempts=outbox.attempts, last_error=outbox.last_error,
                                         sent_at=aware(outbox.sent_at), next_attempt_at=aware(outbox.next_attempt_at),
                                         to_email=outbox.to_email)
    # The reference is the member's; the console never needs to hold it.
    out.open_request = None
    return out


@admin_router.get("/{member_id}/health-permission", response_model=HealthPermissionOut)
def read_permission(member_id: UUID, db: Session = Depends(get_db),
                    runtime: Runtime = Depends(get_runtime)) -> HealthPermissionOut:
    _member_or_404(db, member_id)
    row = HealthPermissionService(db).for_member(member_id)
    db.commit()
    return _console_out(db, runtime, member_id, row)


@admin_router.post("/{member_id}/health-permission/request", response_model=HealthPermissionOut)
def request_permission(member_id: UUID, payload: RequestIn | None = None,
                       principal: CurrentPrincipal = Depends(require_admin),
                       db: Session = Depends(get_db), runtime: Runtime = Depends(get_runtime)) -> HealthPermissionOut:
    """Ask the member, and email them that they were asked. The console
    cannot do more than ask."""
    _member_or_404(db, member_id)
    requests = _requests(db, runtime)
    try:
        outcome = requests.manual(member_id, by_user_id=principal.user_id, by_name=principal.display_name,
                                  reason=(payload.reason if payload else None))
    except (SharingRequestError, PermissionError_) as exc:
        db.rollback()
        _raise(exc)
    record_audit(db, principal, "health_permission.requested", "member", str(member_id),
                 {"state": outcome.permission.state, "policy_version": current_terms(db).label,
                  "with_reason": bool(payload and payload.reason)})
    db.commit()
    NotificationService(db, runtime.email).dispatch(outcome.outbox_id)
    row = HealthPermissionService(db).for_member(member_id)
    return _console_out(db, runtime, member_id, row)


@admin_router.post("/{member_id}/health-permission/resend", response_model=HealthPermissionOut)
def resend_request_email(member_id: UUID, principal: CurrentPrincipal = Depends(require_admin),
                         db: Session = Depends(get_db), runtime: Runtime = Depends(get_runtime)) -> HealthPermissionOut:
    """Try again to deliver an email that was refused. Never a second ask."""
    _member_or_404(db, member_id)
    try:
        outbox = _requests(db, runtime).retry_delivery(member_id)
    except SharingRequestError as exc:
        _raise(exc)
    record_audit(db, principal, "health_permission.request_email_retried", "member", str(member_id), {})
    db.commit()
    NotificationService(db, runtime.email).dispatch(outbox.id)
    row = HealthPermissionService(db).for_member(member_id)
    return _console_out(db, runtime, member_id, row)


# ---- the console's settings: mode, email template, terms ---------------------------------

def _version_rows(db: Session, key: str) -> list[dict]:
    return [{"version": int(r.version or 0), "published_at": aware(r.published_at), "published_by": r.published_by_name,
             "note": r.note, "hash": r.content_hash} for r in PolicyStore(db).history(key)]


def _draft(db: Session, key: str) -> dict | None:
    row = PolicyStore(db).draft(key)
    if row is None:
        return None
    return {"value": row.value, "updated_at": aware(row.updated_at), "by": row.created_by_name}


def _sample_variables(db: Session, principal: CurrentPrincipal, runtime: Runtime) -> dict[str, str]:
    return {"first_name": principal.first_name or "there", "organization_name": "Veye",
            "support_email": _support(db) or "the Veye team",
            "review_link": review_link(runtime.settings.web_base_url, "PREVIEW-ONLY-NOT-A-REAL-REQUEST"),
            "request_expiry": "until you answer it"}


def _validated(model, payload):
    try:
        return model.model_validate(payload.model_dump(mode="json"))
    except ValidationError as exc:
        messages = [str(error.get("msg", "")).replace("Value error, ", "") for error in exc.errors()]
        raise HTTPException(status_code=422, detail=" ".join(m for m in messages if m) or "That is not valid.") from exc


def _render_template(value: TemplateValue, variables: dict[str, str]) -> dict:
    rendered = templates.health_sharing_request(substitute(value.subject, variables),
                                                render_html(value.body, variables, email=True),
                                                render_text(value.body, variables), variables["review_link"], CTA_LABEL)
    return {"subject": rendered.subject, "html": rendered.html, "text": rendered.text}


@settings_router.get("")
def sharing_settings(db: Session = Depends(get_db)) -> dict:
    notification = current_notification(db)
    template, template_version = current_template(db)
    terms = current_terms(db)
    return {
        "notification": {"mode": notification.mode, "resend_interval_hours": notification.resend_interval_hours,
                         "sender_name": notification.sender_name, "version": notification.version,
                         "published_at": notification.published_at, "published_by": notification.published_by,
                         "resend_choices": list(RESEND_CHOICES), "history": _version_rows(db, NOTIFICATION_KEY),
                         "backfill": "Automatic mode asks members whose address is verified AFTER it is switched on. "
                                     "It never emails existing members in bulk."},
        "template": {"value": template.model_dump(mode="json"), "version": template_version,
                     "draft": _draft(db, TEMPLATE_KEY), "history": _version_rows(db, TEMPLATE_KEY),
                     "variables": sorted(TEMPLATE_VARIABLES), "cta_label": CTA_LABEL},
        "terms": {"value": terms.value.model_dump(mode="json"), "version": terms.version, "label": terms.label,
                  "hash": terms.hash, "draft": _draft(db, TERMS_KEY), "history": _version_rows(db, TERMS_KEY),
                  "variables": sorted(TERMS_VARIABLES),
                  "locked": {"categories": list(CATEGORIES), "companion_use": COMPANION_USE, "expiry_rule": EXPIRY_RULE,
                             "withdrawal": WITHDRAWAL, "not_covered": NOT_COVERED}},
        "status": "Engineering draft wording, pending owner and counsel approval. Whether VEYE needs a formal "
                  "authorization rather than this consent is a legal question nobody has answered yet.",
    }


@settings_router.put("/notification")
def publish_notification(payload: NotificationIn, principal: CurrentPrincipal = Depends(require_admin),
                         db: Session = Depends(get_db)) -> dict:
    value = _validated(NotificationValue, payload)
    current = current_notification(db)
    if current.version and (current.mode, current.resend_interval_hours, current.sender_name) == \
            (value.mode, value.resend_interval_hours, value.sender_name):
        raise HTTPException(status_code=409, detail="That is already the current setting.")
    try:
        row = PolicyStore(db).publish(NOTIFICATION_KEY, value.model_dump(), by=Actor(principal.user_id, principal.display_name))
    except PolicyConflict as exc:
        raise HTTPException(status_code=409, detail="Someone else changed this at the same moment. Reload and try again.") from exc
    record_audit(db, principal, "settings.health_sharing.notification_published", "policy", NOTIFICATION_KEY,
                 {"version": row.version, "mode": value.mode, "resend_interval_hours": value.resend_interval_hours})
    db.commit()
    return sharing_settings(db)


@settings_router.put("/template/draft")
def save_template_draft(payload: TemplateIn, principal: CurrentPrincipal = Depends(require_admin),
                        db: Session = Depends(get_db)) -> dict:
    value = _validated(TemplateValue, payload)
    PolicyStore(db).save_draft(TEMPLATE_KEY, value.model_dump(mode="json"), by=Actor(principal.user_id, principal.display_name))
    db.commit()
    return sharing_settings(db)


@settings_router.delete("/template/draft")
def discard_template_draft(db: Session = Depends(get_db)) -> dict:
    PolicyStore(db).discard_draft(TEMPLATE_KEY)
    db.commit()
    return sharing_settings(db)


@settings_router.post("/template/preview")
def preview_template(payload: TemplateIn, principal: CurrentPrincipal = Depends(require_admin),
                     db: Session = Depends(get_db), runtime: Runtime = Depends(get_runtime)) -> dict:
    value = _validated(TemplateValue, payload)
    return _render_template(value, _sample_variables(db, principal, runtime))


@settings_router.post("/template/test")
def send_test(payload: TemplateIn, request: Request, principal: CurrentPrincipal = Depends(require_admin),
              db: Session = Depends(get_db), runtime: Runtime = Depends(get_runtime)) -> dict:
    """To the signed-in administrator's own address only — never anyone else."""
    RateLimiter(db, runtime.settings).enforce("template_test", subject=str(principal.user_id),
                                              address=client_address(request))
    value = _validated(TemplateValue, payload)
    user = db.get(UserAccount, principal.user_id)
    rendered = _render_template(value, _sample_variables(db, principal, runtime))
    notifications = NotificationService(db, runtime.email)
    outbox = notifications.queue("health_sharing_request", to_email=user.email, subject="[Test] " + rendered["subject"],
                                 text=rendered["text"], html=rendered["html"], user=user,
                                 context={"test": True, "from_name": current_notification(db).sender_name})
    db.commit()
    sent = notifications.dispatch(outbox.id)
    return {"status": sent.status if sent else "queued", "to": user.email, "error": sent.last_error if sent else None}


@settings_router.post("/template/publish")
def publish_template(principal: CurrentPrincipal = Depends(require_admin), db: Session = Depends(get_db)) -> dict:
    draft = PolicyStore(db).draft(TEMPLATE_KEY)
    if draft is None:
        raise HTTPException(status_code=409, detail="There is no draft to publish. Save a draft first.")
    value = TemplateValue.model_validate(draft.value)
    try:
        row = PolicyStore(db).publish(TEMPLATE_KEY, value.model_dump(mode="json"), by=Actor(principal.user_id, principal.display_name))
    except PolicyConflict as exc:
        raise HTTPException(status_code=409, detail="Someone else published at the same moment. Reload and try again.") from exc
    record_audit(db, principal, "settings.health_sharing.template_published", "policy", TEMPLATE_KEY,
                 {"version": row.version, "hash": row.content_hash})
    db.commit()
    return sharing_settings(db)


@settings_router.put("/terms/draft")
def save_terms_draft(payload: TermsIn, principal: CurrentPrincipal = Depends(require_admin),
                     db: Session = Depends(get_db)) -> dict:
    value = _validated(TermsValue, payload)
    PolicyStore(db).save_draft(TERMS_KEY, value.model_dump(mode="json"), by=Actor(principal.user_id, principal.display_name))
    db.commit()
    return sharing_settings(db)


@settings_router.delete("/terms/draft")
def discard_terms_draft(db: Session = Depends(get_db)) -> dict:
    PolicyStore(db).discard_draft(TERMS_KEY)
    db.commit()
    return sharing_settings(db)


@settings_router.post("/terms/preview")
def preview_terms(payload: TermsIn, db: Session = Depends(get_db)) -> dict:
    value = _validated(TermsValue, payload)
    from app.health_permission.policy import Terms

    preview = Terms(value=value, version=current_terms(db).version + 1, published_at=None, published_by="", hash=terms_hash(value))
    rendered = preview.rendered({"organization_name": "Veye", "support_email": _support(db) or "the Veye team"})
    return {**rendered, "material_change": is_material_change(current_terms(db).value, value)}


@settings_router.post("/terms/publish")
def publish_terms(principal: CurrentPrincipal = Depends(require_admin), db: Session = Depends(get_db)) -> dict:
    draft = PolicyStore(db).draft(TERMS_KEY)
    if draft is None:
        raise HTTPException(status_code=409, detail="There is no draft to publish. Save a draft first.")
    value = TermsValue.model_validate(draft.value)
    material = is_material_change(current_terms(db).value, value)
    try:
        row = PolicyStore(db).publish(TERMS_KEY, value.model_dump(mode="json"), by=Actor(principal.user_id, principal.display_name),
                                      note="Material change: purpose or recipient changed." if material else None)
    except PolicyConflict as exc:
        raise HTTPException(status_code=409, detail="Someone else published at the same moment. Reload and try again.") from exc
    record_audit(db, principal, "settings.health_sharing.terms_published", "policy", TERMS_KEY,
                 {"version": row.version, "hash": terms_hash(value), "material_change": material})
    db.commit()
    return sharing_settings(db)
