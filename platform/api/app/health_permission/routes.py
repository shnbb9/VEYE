"""Health Data Sharing Permission: the member's half and the console's half.

The asymmetry is the design. A member can grant, decline and withdraw. An
administrator can ask, and read the state they were given. There is no admin
route that sets a member's permission, and adding one would defeat the point
of having the permission at all.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.admin.audit import record_audit
from app.auth.principal import CurrentPrincipal, require_admin, require_member
from app.db.session import get_db
from app.health_permission.models import POLICY_VERSION, STATE_LABELS, MemberHealthPermission
from app.health_permission.schemas import HealthPermissionEventOut, HealthPermissionOut
from app.health_permission.service import HealthPermissionService, PermissionError_

member_router = APIRouter(prefix="/api/v1/members/me/health-permission", tags=["health-permission"])
admin_router = APIRouter(prefix="/api/v1/admin/members", tags=["admin-health-permission"],
                         dependencies=[Depends(require_admin)])

# What the member is actually agreeing to. Kept here, beside the version it is
# stamped with, so the words and the version can never drift apart.
EXPLANATION = (
    "Sharing lets the Veye team open your saved results — your Health Number, body "
    "composition, blood markers, questionnaires, moods and food diary — when they are "
    "helping you. Until you share them, nobody at Veye can see them. Your name, email "
    "and the messages you send are not covered by this and stay visible to the team so "
    "they can answer you. You can withdraw sharing at any time, and it stops at once."
)


def permission_out(row: MemberHealthPermission, *, include_events: bool) -> HealthPermissionOut:
    return HealthPermissionOut(
        state=row.state, state_label=STATE_LABELS.get(row.state, row.state),
        shares_health_data=row.shares_health_data,
        policy_version=row.policy_version or "", current_policy_version=POLICY_VERSION,
        explanation=EXPLANATION,
        requested_at=row.requested_at, requested_by_name=row.requested_by_name or "",
        decided_at=row.decided_at, revoked_at=row.revoked_at,
        events=[HealthPermissionEventOut(
            id=e.id, from_state=e.from_state, to_state=e.to_state, actor=e.actor,
            actor_name=e.actor_name, source=e.source, policy_version=e.policy_version,
            created_at=e.created_at,
        ) for e in (row.events if include_events else [])],
    )


def _raise(exc: PermissionError_) -> None:
    raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


# ---- the member's half ---------------------------------------------------------

@member_router.get("", response_model=HealthPermissionOut)
def my_permission(principal: CurrentPrincipal = Depends(require_member),
                  db: Session = Depends(get_db)) -> HealthPermissionOut:
    assert principal.member_id is not None
    row = HealthPermissionService(db).for_member(principal.member_id)
    db.commit()
    return permission_out(row, include_events=True)


@member_router.post("/grant", response_model=HealthPermissionOut)
def grant(principal: CurrentPrincipal = Depends(require_member),
          db: Session = Depends(get_db)) -> HealthPermissionOut:
    """Only this route, reached from the application by the member themselves,
    can open the records. Nothing is granted by replying to an email."""
    assert principal.member_id is not None
    row = HealthPermissionService(db).grant(principal.member_id, by_user_id=principal.user_id,
                                            by_name=principal.display_name)
    db.commit()
    return permission_out(row, include_events=True)


@member_router.post("/decline", response_model=HealthPermissionOut)
def decline(principal: CurrentPrincipal = Depends(require_member),
            db: Session = Depends(get_db)) -> HealthPermissionOut:
    assert principal.member_id is not None
    row = HealthPermissionService(db).decline(principal.member_id, by_user_id=principal.user_id,
                                              by_name=principal.display_name)
    db.commit()
    return permission_out(row, include_events=True)


@member_router.post("/revoke", response_model=HealthPermissionOut)
def revoke(principal: CurrentPrincipal = Depends(require_member),
           db: Session = Depends(get_db)) -> HealthPermissionOut:
    assert principal.member_id is not None
    try:
        row = HealthPermissionService(db).revoke(principal.member_id, by_user_id=principal.user_id,
                                                 by_name=principal.display_name)
    except PermissionError_ as exc:
        _raise(exc)
    db.commit()
    return permission_out(row, include_events=True)


# ---- the console's half --------------------------------------------------------

@admin_router.get("/{member_id}/health-permission", response_model=HealthPermissionOut)
def read_permission(member_id: UUID, db: Session = Depends(get_db)) -> HealthPermissionOut:
    row = HealthPermissionService(db).for_member(member_id)
    db.commit()
    return permission_out(row, include_events=True)


@admin_router.post("/{member_id}/health-permission/request", response_model=HealthPermissionOut)
def request_permission(member_id: UUID, principal: CurrentPrincipal = Depends(require_admin),
                       db: Session = Depends(get_db)) -> HealthPermissionOut:
    """Ask the member. The console cannot do more than ask."""
    try:
        row = HealthPermissionService(db).request(member_id, by_user_id=principal.user_id,
                                                  by_name=principal.display_name)
    except PermissionError_ as exc:
        _raise(exc)
    record_audit(db, principal, "health_permission.requested", "member", str(member_id),
                 {"state": row.state, "policy_version": POLICY_VERSION})
    db.commit()
    return permission_out(row, include_events=True)
