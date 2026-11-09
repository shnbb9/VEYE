"""The rules around Health Data Sharing Permission.

Two of them matter more than the rest:

  * only the member grants, declines or withdraws. An administrator can ask,
    and that is all they can do. There is no route by which the console sets
    a member's permission for them, and none should ever be added.
  * withdrawal takes effect on the next request. The state is read at the
    moment the data is assembled, never cached into a session or a token, so
    "revoke" is immediate rather than eventual.
"""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy.orm import Session

from app.health_permission.models import (
    POLICY_VERSION,
    SOURCE_ADMIN_CONSOLE,
    SOURCE_MEMBER_APP,
    STATE_DECLINED,
    STATE_GRANTED,
    STATE_NOT_REQUESTED,
    STATE_REQUESTED,
    STATE_REVOKED,
    MemberHealthPermission,
    MemberHealthPermissionEvent,
)


class PermissionError_(Exception):
    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


class HealthPermissionService:
    def __init__(self, db: Session) -> None:
        self.db = db

    # ---- reading -------------------------------------------------------------
    def for_member(self, member_id: UUID) -> MemberHealthPermission:
        """The member's permission row, created in the default state if this is
        the first time anyone has asked. Creating it is not a decision: the
        default is `not_requested`, because silence is never consent."""
        row = (self.db.query(MemberHealthPermission)
               .filter(MemberHealthPermission.member_id == member_id).one_or_none())
        if row is None:
            row = MemberHealthPermission(member_id=member_id, state=STATE_NOT_REQUESTED)
            self.db.add(row)
            self.db.flush()
        return row

    def shares_health_data(self, member_id: UUID) -> bool:
        """The single question every protected read asks. Deliberately a fresh
        database read each time — a withdrawal has to bite immediately, and a
        value cached anywhere is a value that outlives the member's decision."""
        row = (self.db.query(MemberHealthPermission)
               .filter(MemberHealthPermission.member_id == member_id).one_or_none())
        return bool(row and row.shares_health_data)

    def states_for(self, member_ids: list[UUID]) -> dict[UUID, str]:
        """Bulk read for list screens, so a page of members costs one query."""
        if not member_ids:
            return {}
        rows = (self.db.query(MemberHealthPermission)
                .filter(MemberHealthPermission.member_id.in_(member_ids)).all())
        found = {row.member_id: row.state for row in rows}
        return {member_id: found.get(member_id, STATE_NOT_REQUESTED) for member_id in member_ids}

    # ---- transitions ---------------------------------------------------------
    def request(self, member_id: UUID, *, by_user_id: UUID | None, by_name: str) -> MemberHealthPermission:
        """An administrator asks. This is the console's whole power here."""
        row = self.for_member(member_id)
        if row.state == STATE_GRANTED:
            raise PermissionError_(409, "This member already shares their health records.")
        now = datetime.now(timezone.utc)
        self._record(row, STATE_REQUESTED, actor="administrator", actor_user_id=by_user_id,
                     actor_name=by_name, source=SOURCE_ADMIN_CONSOLE)
        row.requested_at = now
        row.requested_by_user_id = by_user_id
        row.requested_by_name = by_name
        self.db.flush()
        return row

    def grant(self, member_id: UUID, *, by_user_id: UUID, by_name: str) -> MemberHealthPermission:
        row = self.for_member(member_id)
        if row.state == STATE_GRANTED:
            return row
        self._record(row, STATE_GRANTED, actor="member", actor_user_id=by_user_id,
                     actor_name=by_name, source=SOURCE_MEMBER_APP)
        row.decided_at = datetime.now(timezone.utc)
        row.revoked_at = None
        row.policy_version = POLICY_VERSION
        self.db.flush()
        return row

    def decline(self, member_id: UUID, *, by_user_id: UUID, by_name: str) -> MemberHealthPermission:
        row = self.for_member(member_id)
        self._record(row, STATE_DECLINED, actor="member", actor_user_id=by_user_id,
                     actor_name=by_name, source=SOURCE_MEMBER_APP)
        row.decided_at = datetime.now(timezone.utc)
        row.policy_version = POLICY_VERSION
        self.db.flush()
        return row

    def revoke(self, member_id: UUID, *, by_user_id: UUID, by_name: str) -> MemberHealthPermission:
        """Withdraw a permission already given. Nothing is deleted — the record
        of having granted stays, because it is the evidence that the team was
        once entitled to look."""
        row = self.for_member(member_id)
        if row.state != STATE_GRANTED:
            raise PermissionError_(409, "There is nothing to withdraw.")
        self._record(row, STATE_REVOKED, actor="member", actor_user_id=by_user_id,
                     actor_name=by_name, source=SOURCE_MEMBER_APP)
        row.revoked_at = datetime.now(timezone.utc)
        row.policy_version = POLICY_VERSION
        self.db.flush()
        return row

    # ---- internals -----------------------------------------------------------
    def _record(self, row: MemberHealthPermission, to_state: str, *, actor: str,
                actor_user_id: UUID | None, actor_name: str, source: str) -> None:
        self.db.add(MemberHealthPermissionEvent(
            permission_id=row.id, member_id=row.member_id, from_state=row.state, to_state=to_state,
            actor=actor, actor_user_id=actor_user_id, actor_name=actor_name, source=source,
            policy_version=POLICY_VERSION,
        ))
        row.state = to_state
