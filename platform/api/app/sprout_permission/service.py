"""The rules around Sprout personalization.

  * only the member switches it on or off. The console has no route for it and
    none should be added.
  * it is read at the moment a prompt is built, never cached, and read again
    once the model has answered. Switching off waits for an answer already
    being saved, so once "off" has returned nothing written from the member's
    health information can still arrive.
"""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.companion.models import MemberPersonalTip
from app.members.models import Member
from app.sprout_permission.models import (
    SOURCE_MEMBER_APP,
    STATE_OFF,
    STATE_ON,
    STATE_TURNED_OFF,
    MemberSproutPermission,
    MemberSproutPermissionEvent,
)
from app.sprout_permission.terms import SproutTerms


class SproutPermissionService:
    def __init__(self, db: Session) -> None:
        self.db = db

    # ---- reading -------------------------------------------------------------
    def current(self, member_id: UUID) -> MemberSproutPermission | None:
        """The row if there is one. Reading writes nothing: a member who never
        switched it on is simply off."""
        return (self.db.query(MemberSproutPermission)
                .filter(MemberSproutPermission.member_id == member_id).one_or_none())

    def personalizes(self, member_id: UUID, *, hold: bool = False, under: str | None = None) -> bool:
        """May Sprout use this member's health information, right now?

        The column rather than the row, so the answer is never the copy this
        session read earlier. A member who asked to be deleted, or was archived
        and cannot sign in to switch it off, gives nothing.

        `under` asks whether it was given to these words and no earlier ones.

        `hold` keeps the answer true until this transaction ends (a shared
        lock): switching off then waits for it, and nothing can be stored after
        the member has been told it is off."""
        query = (self.db.query(MemberSproutPermission.state)
                 .join(Member, Member.id == MemberSproutPermission.member_id)
                 .filter(MemberSproutPermission.member_id == member_id,
                         Member.erasure_requested_at.is_(None), Member.archived_at.is_(None)))
        if under is not None:
            query = query.filter(MemberSproutPermission.policy_version == under)
        if hold:
            query = query.with_for_update(read=True, of=MemberSproutPermission)
        return query.scalar() == STATE_ON

    # ---- transitions ---------------------------------------------------------
    def grant(self, member_id: UUID, *, by_user_id: UUID, by_name: str, terms: SproutTerms) -> MemberSproutPermission:
        row = self._locked(member_id, create=True)
        assert row is not None
        if row.state == STATE_ON and row.policy_version == terms.label:
            return row  # a second click, or a second tab: the first answer stands
        self._record(row, STATE_ON, by_user_id=by_user_id, by_name=by_name, terms=terms)
        row.authorized_at = datetime.now(timezone.utc)
        row.revoked_at = None
        row.policy_version = terms.label
        self.db.flush()
        return row

    def revoke(self, member_id: UUID, *, by_user_id: UUID, by_name: str) -> MemberSproutPermission | None:
        """Switch it off. Never conditional (no verification, no terms), and
        doing it twice is not an error. What was kept from the member's health
        information goes with it."""
        row = self._locked(member_id, create=False)
        if row is not None and row.state == STATE_ON:
            self._record(row, STATE_TURNED_OFF, by_user_id=by_user_id, by_name=by_name, label=row.policy_version)
            row.revoked_at = datetime.now(timezone.utc)
        self.forget_kept(member_id)
        self.db.flush()
        return row

    def forget_kept(self, member_id: UUID) -> None:
        """The Personal tip is the one sentence kept outside the member's own
        records that was written from them."""
        self.db.query(MemberPersonalTip).filter(MemberPersonalTip.member_id == member_id).delete(synchronize_session=False)

    # ---- internals -----------------------------------------------------------
    def _locked(self, member_id: UUID, *, create: bool) -> MemberSproutPermission | None:
        """The row, locked and as it is now, so two changes at once happen one
        after the other instead of both acting on what they read first."""
        query = (self.db.query(MemberSproutPermission).filter(MemberSproutPermission.member_id == member_id)
                 .populate_existing().with_for_update())
        row = query.one_or_none()
        if row is None and create:
            try:
                with self.db.begin_nested():
                    self.db.add(MemberSproutPermission(member_id=member_id, state=STATE_OFF))
            except IntegrityError:
                pass  # another tab created it
            row = query.one()
        return row

    def _record(self, row: MemberSproutPermission, to_state: str, *, by_user_id: UUID, by_name: str,
                terms: SproutTerms | None = None, label: str = "") -> None:
        snapshot = terms.snapshot() if terms is not None else {}
        self.db.add(MemberSproutPermissionEvent(
            permission_id=row.id, member_id=row.member_id, from_state=row.state, to_state=to_state,
            actor_user_id=by_user_id, actor_name=by_name, source=SOURCE_MEMBER_APP,
            policy_version=terms.label if terms is not None else label,
            terms_version=terms.version if terms is not None else None,
            terms_hash=terms.hash if terms is not None else None,
            scope=snapshot.get("scope"), purpose=snapshot.get("purpose"), recipient=snapshot.get("recipient"),
            expiry_rule=snapshot.get("expiry_rule")))
        row.state = to_state
