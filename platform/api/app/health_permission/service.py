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

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.health_permission.models import (
    POLICY_VERSION,
    SHARING_STATES,
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
        return self._row(member_id)

    def _row(self, member_id: UUID, *, lock: bool = False) -> MemberHealthPermission:
        """`lock` for a transition: two decisions at once happen one after the
        other instead of both acting on the state they read first."""
        query = self.db.query(MemberHealthPermission).filter(MemberHealthPermission.member_id == member_id)
        if lock:
            query = query.populate_existing().with_for_update()
        row = query.one_or_none()
        if row is None:
            try:
                with self.db.begin_nested():
                    self.db.add(MemberHealthPermission(member_id=member_id, state=STATE_NOT_REQUESTED))
            except IntegrityError:
                pass  # another request created it
            row = query.one()
        return row

    def current(self, member_id: UUID) -> MemberHealthPermission | None:
        """The row if it exists, without creating one (reads that must not
        write, such as an eligibility check)."""
        return (self.db.query(MemberHealthPermission)
                .filter(MemberHealthPermission.member_id == member_id).one_or_none())

    def shares_health_data(self, member_id: UUID) -> bool:
        """The single question every protected read asks. Deliberately a fresh
        database read each time — a withdrawal has to bite immediately, and a
        value cached anywhere is a value that outlives the member's decision.
        Columns, not rows: a row this session loaded earlier would answer with
        what it held then."""
        # A member who asked to be deleted shares nothing from that moment,
        # even before the purge has removed the permission row; nor does an
        # archived one, who cannot sign in to withdraw.
        from app.members.models import Member

        state = (self.db.query(MemberHealthPermission.state)
                 .join(Member, Member.id == MemberHealthPermission.member_id)
                 .filter(MemberHealthPermission.member_id == member_id,
                         Member.erasure_requested_at.is_(None), Member.archived_at.is_(None)).scalar())
        return state in SHARING_STATES

    def sharing_member_ids(self) -> set[UUID]:
        """Everyone whose records the console may show, in one query: the same
        rule as `shares_health_data`, for screens that list many members."""
        from app.members.models import Member

        rows = (self.db.query(MemberHealthPermission.member_id)
                .join(Member, Member.id == MemberHealthPermission.member_id)
                .filter(MemberHealthPermission.state.in_(SHARING_STATES), Member.archived_at.is_(None),
                        Member.erasure_requested_at.is_(None)).all())
        return {row[0] for row in rows}

    def states_for(self, member_ids: list[UUID]) -> dict[UUID, str]:
        """Bulk read for list screens, so a page of members costs one query."""
        if not member_ids:
            return {}
        rows = (self.db.query(MemberHealthPermission)
                .filter(MemberHealthPermission.member_id.in_(member_ids)).all())
        found = {row.member_id: row.state for row in rows}
        return {member_id: found.get(member_id, STATE_NOT_REQUESTED) for member_id in member_ids}

    # ---- transitions ---------------------------------------------------------
    def request(self, member_id: UUID, *, by_user_id: UUID | None, by_name: str, actor: str = "administrator",
                source: str = SOURCE_ADMIN_CONSOLE, note: str | None = None,
                request_ref: str | None = None) -> MemberHealthPermission:
        """An administrator asks (or, with automatic mode, Veye asks after a
        verified sign-up). This is the console's whole power here."""
        row = self._row(member_id, lock=True)
        if row.state == STATE_GRANTED:
            raise PermissionError_(409, "This member already shares their health records.")
        now = datetime.now(timezone.utc)
        self._record(row, STATE_REQUESTED, actor=actor, actor_user_id=by_user_id,
                     actor_name=by_name, source=source, note=note, request_ref=request_ref)
        row.requested_at = now
        row.requested_by_user_id = by_user_id
        row.requested_by_name = by_name
        row.request_ref = request_ref
        self.db.flush()
        return row

    def grant(self, member_id: UUID, *, by_user_id: UUID, by_name: str, terms=None,
              request_ref: str | None = None) -> MemberHealthPermission:
        """`terms` is the version the member was shown (policy.Terms); its
        label, hash and snapshot are kept on the event, so the evidence says
        exactly what was agreed to."""
        row = self._row(member_id, lock=True)
        if row.state == STATE_GRANTED:
            return row
        self._record(row, STATE_GRANTED, actor="member", actor_user_id=by_user_id,
                     actor_name=by_name, source=SOURCE_MEMBER_APP, terms=terms, request_ref=request_ref)
        row.decided_at = datetime.now(timezone.utc)
        row.revoked_at = None
        row.policy_version = terms.label if terms is not None else POLICY_VERSION
        row.request_ref = None
        self.db.flush()
        return row

    def decline(self, member_id: UUID, *, by_user_id: UUID, by_name: str, terms=None,
                request_ref: str | None = None) -> MemberHealthPermission:
        row = self._row(member_id, lock=True)
        self._record(row, STATE_DECLINED, actor="member", actor_user_id=by_user_id,
                     actor_name=by_name, source=SOURCE_MEMBER_APP, terms=terms, request_ref=request_ref)
        row.decided_at = datetime.now(timezone.utc)
        row.policy_version = terms.label if terms is not None else POLICY_VERSION
        row.request_ref = None
        self.db.flush()
        return row

    def revoke(self, member_id: UUID, *, by_user_id: UUID, by_name: str,
               terms_label: str | None = None) -> MemberHealthPermission:
        """Withdraw a permission already given. Nothing is deleted — the record
        of having granted stays, because it is the evidence that the team was
        once entitled to look.

        A withdrawal is not a decision on any terms, so the row keeps the
        version the member last decided under. It used to be stamped with the
        built-in v0 label, which — once an administrator had published terms
        — told every member who withdrew that they had "decided against an
        earlier version of the terms". The event names the terms in force
        when it happened (`terms_label`), for the evidence."""
        row = self._row(member_id, lock=True)
        if row.state != STATE_GRANTED:
            raise PermissionError_(409, "There is nothing to withdraw.")
        self._record(row, STATE_REVOKED, actor="member", actor_user_id=by_user_id,
                     actor_name=by_name, source=SOURCE_MEMBER_APP, label=terms_label)
        row.revoked_at = datetime.now(timezone.utc)
        self.db.flush()
        return row

    # ---- internals -----------------------------------------------------------
    def _record(self, row: MemberHealthPermission, to_state: str, *, actor: str,
                actor_user_id: UUID | None, actor_name: str, source: str, note: str | None = None,
                terms=None, request_ref: str | None = None, label: str | None = None) -> None:
        snapshot = terms.snapshot() if terms is not None else {}
        self.db.add(MemberHealthPermissionEvent(
            permission_id=row.id, member_id=row.member_id, from_state=row.state, to_state=to_state,
            actor=actor, actor_user_id=actor_user_id, actor_name=actor_name, source=source,
            policy_version=terms.label if terms is not None else (label or POLICY_VERSION), note=note,
            terms_version=terms.version if terms is not None else None,
            terms_hash=terms.hash if terms is not None else None,
            scope=snapshot.get("categories"), purpose=snapshot.get("purpose"),
            recipient=snapshot.get("recipient"), expiry_rule=snapshot.get("expiry_rule"),
            request_ref=request_ref,
        ))
        row.state = to_state
