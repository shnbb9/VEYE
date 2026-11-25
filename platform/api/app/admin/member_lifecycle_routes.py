"""Archiving a member, and bringing them back (V4 §1.6).

Archiving is the ordinary administrative "they have left": the member leaves
the active directory and the member application closes to them at once. It
deletes nothing, changes no password and touches no administrator access, so
a person who holds both keeps the console. It is not a deactivation (the
sign-in account) and never an erasure, which stays the member's own request or
its governed equivalent.

While archived, their health records are withheld from the console whatever
they had decided — they cannot sign in to withdraw. Restoring makes their own
decision apply again exactly as they left it; it never grants or revives one."""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from app.admin.audit import record_audit
from app.auth.models import UserAccount
from app.auth.principal import PORTAL_MEMBER, CurrentPrincipal, require_admin
from app.core.runtime import Runtime, get_runtime
from app.db.session import get_db
from app.members.models import Member

router = APIRouter(prefix="/api/v1/admin/members", tags=["admin-console"], dependencies=[Depends(require_admin)])


class ArchiveIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reason: str = Field(default="", max_length=300)


class ArchiveOut(BaseModel):
    archived_at: datetime | None
    archived_by: str | None
    archive_reason: str | None
    message: str


def _target(db: Session, member_id: UUID) -> tuple[Member, UserAccount]:
    member = db.get(Member, member_id)
    user = db.query(UserAccount).filter(UserAccount.member_id == member_id).one_or_none() if member else None
    if member is None or user is None or member.erasure_requested_at is not None:
        raise HTTPException(status_code=404, detail="That member was not found.")
    return member, user


def _out(member: Member, message: str) -> ArchiveOut:
    return ArchiveOut(archived_at=member.archived_at, archived_by=member.archived_by,
                      archive_reason=member.archive_reason, message=message)


@router.post("/{member_id}/archive", response_model=ArchiveOut)
def archive_member(member_id: UUID, payload: ArchiveIn, principal: CurrentPrincipal = Depends(require_admin),
                   db: Session = Depends(get_db), runtime: Runtime = Depends(get_runtime)) -> ArchiveOut:
    member, user = _target(db, member_id)
    if member.archived_at is not None:
        raise HTTPException(status_code=409, detail="That member is already archived.")
    member.archived_at = datetime.now(timezone.utc)
    member.archived_by = principal.display_name
    member.archive_reason = " ".join(payload.reason.split()) or None
    runtime.auth_provider.revoke_all(db, user.id, portal=PORTAL_MEMBER)
    record_audit(db, principal, "member.archived", "member", str(member.id), {"reason": member.archive_reason or ""})
    db.commit()
    return _out(member, "The member is archived and signed out of the member application.")


@router.post("/{member_id}/restore", response_model=ArchiveOut)
def restore_member(member_id: UUID, principal: CurrentPrincipal = Depends(require_admin),
                   db: Session = Depends(get_db)) -> ArchiveOut:
    member, _ = _target(db, member_id)
    if member.archived_at is None:
        raise HTTPException(status_code=409, detail="That member is not archived.")
    member.archived_at = member.archived_by = member.archive_reason = None
    record_audit(db, principal, "member.restored", "member", str(member.id), {})
    db.commit()
    return _out(member, "The member is active again. They can sign in as before.")
