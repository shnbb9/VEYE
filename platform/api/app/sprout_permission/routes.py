"""Sprout personalization, the member's side. There is no console side."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from app.auth.principal import CurrentPrincipal, require_member
from app.db.session import get_db
from app.health_permission.policy import covered_sprout
from app.health_permission.service import HealthPermissionService
from app.sprout_permission.models import STATE_LABELS, STATE_OFF, STATE_ON, MemberSproutPermission
from app.sprout_permission.service import SproutPermissionService
from app.sprout_permission.terms import current_terms

router = APIRouter(prefix="/api/v1/members/me/sprout-permission", tags=["sprout-permission"])


class SproutTermsOut(BaseModel):
    version: int
    label: str
    hash: str
    title: str
    purpose: str
    recipient: str
    information: list[str]
    never: str
    separate: str
    outside_ai: str
    withdrawal: str
    without: str
    expiry_rule: str


class SproutPermissionEventOut(BaseModel):
    id: UUID
    from_state: str
    to_state: str
    policy_version: str
    terms_version: int | None
    created_at: datetime


class SproutPermissionOut(BaseModel):
    state: str
    state_label: str
    personalizes: bool
    authorized_at: datetime | None
    revoked_at: datetime | None
    policy_version: str
    terms: SproutTermsOut
    email_verified: bool
    events: list[SproutPermissionEventOut]
    # They share with the team under words that covered Sprout too, and have
    # not decided about Sprout since: the screen says what changed.
    was_combined: bool = False


class GrantIn(BaseModel):
    """The words the member was shown. A yes to words that have since changed
    is refused rather than credited to the new ones."""

    model_config = ConfigDict(extra="forbid")
    terms_version: int = Field(ge=0)
    terms_hash: str = Field(min_length=64, max_length=64)


def permission_out(row: MemberSproutPermission | None, *, email_verified: bool) -> SproutPermissionOut:
    state = row.state if row is not None else STATE_OFF
    return SproutPermissionOut(
        state=state, state_label=STATE_LABELS.get(state, state), personalizes=state == STATE_ON,
        authorized_at=row.authorized_at if row is not None else None,
        revoked_at=row.revoked_at if row is not None else None,
        policy_version=row.policy_version if row is not None else "",
        terms=SproutTermsOut(**current_terms().as_dict()), email_verified=email_verified,
        events=[SproutPermissionEventOut(id=e.id, from_state=e.from_state, to_state=e.to_state,
                                         policy_version=e.policy_version, terms_version=e.terms_version,
                                         created_at=e.created_at)
                for e in (row.events if row is not None else [])],
    )


@router.get("", response_model=SproutPermissionOut)
def my_sprout_permission(principal: CurrentPrincipal = Depends(require_member),
                         db: Session = Depends(get_db)) -> SproutPermissionOut:
    assert principal.member_id is not None
    out = permission_out(SproutPermissionService(db).current(principal.member_id),
                         email_verified=principal.email_verified)
    team = HealthPermissionService(db).current(principal.member_id)
    out.was_combined = out.state == STATE_OFF and team is not None and team.shares_health_data and covered_sprout(team.policy_version)
    return out


@router.post("/grant", response_model=SproutPermissionOut)
def grant(payload: GrantIn, principal: CurrentPrincipal = Depends(require_member),
          db: Session = Depends(get_db)) -> SproutPermissionOut:
    assert principal.member_id is not None
    if not principal.email_verified:
        raise HTTPException(status_code=409, detail="Verify your email address first. We sent you a link when you "
                                                    "signed up, and you can send it again from Settings.")
    terms = current_terms()
    if payload.terms_version != terms.version or payload.terms_hash != terms.hash:
        raise HTTPException(status_code=409, detail="The words changed while you were reading them. Please read "
                                                    "them again before deciding.")
    row = SproutPermissionService(db).grant(principal.member_id, by_user_id=principal.user_id,
                                            by_name=principal.display_name, terms=terms)
    db.commit()
    db.refresh(row)
    return permission_out(row, email_verified=principal.email_verified)


@router.post("/revoke", response_model=SproutPermissionOut)
def revoke(principal: CurrentPrincipal = Depends(require_member), db: Session = Depends(get_db)) -> SproutPermissionOut:
    """Never waits on anything: no verification, no terms check."""
    assert principal.member_id is not None
    row = SproutPermissionService(db).revoke(principal.member_id, by_user_id=principal.user_id,
                                             by_name=principal.display_name)
    db.commit()
    if row is not None:
        db.refresh(row)
    return permission_out(row, email_verified=principal.email_verified)
