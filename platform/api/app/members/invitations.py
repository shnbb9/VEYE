"""Member invitations: an administrator types an address, the person holding
that mailbox decides (Cara's 15 Nov feedback; V4 §3).

What an invitation is NOT is most of the design:

  * not an account. Nothing is created when it is sent, and no administrator
    ever chooses a password;
  * not proof of anything until the emailed link is used. Using it proves the
    mailbox, so the account it makes starts verified;
  * not permission. Health sharing stays `not_requested`;
  * not a second identity. An address that already has an account — a member,
    or an administrator without a member profile — is never duplicated.

One open invitation per address, held by the database as well as here. The raw
token travels only in the email; the row keeps its hash.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Mapped, Session, mapped_column

from app.auth.models import UserAccount
from app.auth.password import hash_password, verify_password
from app.auth.principal import PORTAL_MEMBER, ROLE_MEMBER
from app.auth.provider import IssuedSession, hash_token, new_token
from app.auth.service import AuthError, AuthService, normalise_email
from app.db.base import Base
from app.members.models import Member
from app.notifications import templates
from app.notifications.models import NotificationOutbox
from app.notifications.service import NotificationService

PENDING, ACCEPTED, EXPIRED, REVOKED = "pending", "accepted", "expired", "revoked"
STATUS_LABELS = {PENDING: "Pending", ACCEPTED: "Accepted", EXPIRED: "Expired", REVOKED: "Withdrawn"}
# How the person will finish, decided when the link is opened.
MODE_NEW, MODE_ADMIN, MODE_EXISTING, MODE_MEMBER = "new_account", "add_profile", "confirm_existing", "already_member"
NOT_VALID = "This invitation link is not valid any more. Ask the Veye team for a new one."
USED = "This invitation has already been used. Sign in to your Veye account."
WAITING = "That address already has an invitation waiting. Send it again from Invitations."


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def aware(value: datetime | None) -> datetime | None:
    if value is None or value.tzinfo is not None:
        return value
    return value.replace(tzinfo=timezone.utc)


_OPEN = text("accepted_at IS NULL AND revoked_at IS NULL")


class MemberInvitation(Base):
    __tablename__ = "member_invitations"
    __table_args__ = (
        Index("uq_member_invitations_open_email", "email", unique=True, sqlite_where=_OPEN, postgresql_where=_OPEN),
        Index("ix_member_invitations_created_at", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(320), nullable=False)
    first_name: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    last_name: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    invited_by_user_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    invited_by_name: Mapped[str] = mapped_column(String(160), nullable=False, default="")
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    sent_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    outbox_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    member_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("members.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow, onupdate=_utcnow)

    def status(self, now: datetime) -> str:
        if self.accepted_at is not None:
            return ACCEPTED
        if self.revoked_at is not None:
            return REVOKED
        return EXPIRED if aware(self.expires_at) <= now else PENDING


@dataclass(frozen=True)
class Accepted:
    user: UserAccount
    session: IssuedSession | None
    mode: str


class MemberInvitationService:
    def __init__(self, db: Session, auth: AuthService, notifications: NotificationService) -> None:
        self.db = db
        self.auth = auth
        self.notifications = notifications
        self.lifetime = timedelta(hours=auth.settings.member_invitation_hours)

    # ---- console --------------------------------------------------------------
    def invite(self, *, email: str, first_name: str, last_name: str, by: UserAccount) -> MemberInvitation:
        address = normalise_email(email)
        self._refuse_if_pointless(address)
        now = _utcnow()
        existing = self._open(address)
        if existing is not None:
            if existing.status(now) == PENDING:
                raise AuthError(409, WAITING)
            existing.revoked_at = now  # expired: make room for a fresh one
            self.db.flush()
        row = MemberInvitation(email=address, first_name=first_name.strip(), last_name=last_name.strip(),
                               token_hash=hash_token(new_token()), invited_by_user_id=by.id,
                               invited_by_name=by.display_name or by.email, expires_at=now + self.lifetime)
        try:
            with self.db.begin_nested():
                self.db.add(row)
        except IntegrityError as exc:
            # Two administrators pressed the button together: one invitation.
            raise AuthError(409, WAITING) from exc
        self._send(row, by)
        return row

    def resend(self, row: MemberInvitation, by: UserAccount) -> MemberInvitation:
        if row.accepted_at is not None:
            raise AuthError(409, "That invitation has already been accepted.")
        if row.revoked_at is not None:
            raise AuthError(409, "That invitation was withdrawn. Invite them again instead.")
        self._refuse_if_pointless(row.email)
        self._send(row, by)
        return row

    def revoke(self, row: MemberInvitation) -> MemberInvitation:
        changed = (self.db.query(MemberInvitation)
                   .filter(MemberInvitation.id == row.id, MemberInvitation.accepted_at.is_(None),
                           MemberInvitation.revoked_at.is_(None))
                   .update({"revoked_at": _utcnow(), "updated_at": _utcnow()}, synchronize_session=False))
        self.db.refresh(row)
        if changed != 1:
            raise AuthError(409, "That invitation is not waiting any more.")
        return row

    def _refuse_if_pointless(self, address: str) -> None:
        user = self.auth.find_by_email(address)
        if user is None:
            return
        if user.member is not None and user.member.archived_at is not None:
            raise AuthError(409, "That person is an archived member. Restore them instead of inviting them again.")
        if not user.is_active:
            raise AuthError(409, "That account is deactivated. Reactivate it before inviting them.")
        if user.member_id is not None and user.email_verified_at is not None:
            raise AuthError(409, "That person is already a member.")

    def _open(self, address: str) -> MemberInvitation | None:
        return (self.db.query(MemberInvitation)
                .filter(MemberInvitation.email == address, MemberInvitation.accepted_at.is_(None),
                        MemberInvitation.revoked_at.is_(None)).one_or_none())

    def _send(self, row: MemberInvitation, by: UserAccount) -> None:
        """A fresh link every time: the one before it stops working. Queued
        here, dispatched by the route after its commit."""
        raw, now = new_token(), _utcnow()
        row.token_hash = hash_token(raw)
        row.expires_at = now + self.lifetime
        row.sent_count = (row.sent_count or 0) + 1
        row.last_sent_at = now
        rendered = templates.member_invitation(
            row.first_name, f"{self.auth.settings.web_base_url}/accept-invitation?token={raw}",
            self.auth.settings.member_invitation_hours, by.display_name or "The Veye team")
        outbox = self.notifications.queue("member_invitation", to_email=row.email, subject=rendered.subject,
                                          text=rendered.text, html=rendered.html,
                                          context={"member_invitation_id": str(row.id)},
                                          idempotency_key=f"member-invitation:{row.id}:{row.sent_count}")
        row.outbox_id = outbox.id
        self.db.flush()

    def delivery(self, row: MemberInvitation) -> NotificationOutbox | None:
        return self.db.get(NotificationOutbox, row.outbox_id) if row.outbox_id else None

    # ---- the person invited -----------------------------------------------------
    def peek(self, raw_token: str) -> MemberInvitation:
        row = (self.db.query(MemberInvitation)
               .filter(MemberInvitation.token_hash == hash_token(raw_token or "")).one_or_none())
        if row is None:
            raise AuthError(400, NOT_VALID)
        status = row.status(_utcnow())
        if status == ACCEPTED:
            raise AuthError(400, USED)
        if status != PENDING:
            raise AuthError(400, NOT_VALID)
        return row

    def mode(self, row: MemberInvitation) -> str:
        user = self.auth.find_by_email(row.email)
        if user is None:
            return MODE_NEW
        if not user.is_active or (user.member is not None and user.member.archived_at is not None):
            raise AuthError(409, "This account is switched off. Write to the Veye team for help.")
        if user.member_id is None:
            return MODE_ADMIN
        return MODE_MEMBER if user.email_verified_at is not None else MODE_EXISTING

    def accept(self, raw_token: str, *, first_name: str, last_name: str, password: str, remember: bool) -> Accepted:
        row = self.peek(raw_token)
        mode = self.mode(row)
        user = self.auth.find_by_email(row.email)
        if mode == MODE_NEW and not first_name.strip():
            raise AuthError(422, "Please tell us your first name.")
        if mode == MODE_ADMIN and not verify_password(user.password_hash, password):
            # Same account, same password: the console account proves itself.
            raise AuthError(403, "That password is not right for this account.")
        if mode in (MODE_NEW, MODE_EXISTING):
            self.auth.check_password(password)
        now = _utcnow()
        # Of two tabs (or a double click), one wins; the other is told plainly.
        won = (self.db.query(MemberInvitation)
               .filter(MemberInvitation.id == row.id, MemberInvitation.accepted_at.is_(None),
                       MemberInvitation.revoked_at.is_(None), MemberInvitation.token_hash == hash_token(raw_token))
               .update({"accepted_at": now, "updated_at": now}, synchronize_session=False))
        if won != 1:
            raise AuthError(400, USED)

        if mode == MODE_NEW:
            member = Member(email=row.email, display_name=f"{first_name.strip()} {last_name.strip()}".strip())
            user = UserAccount(email=row.email, password_hash=hash_password(password), role=ROLE_MEMBER,
                               first_name=first_name.strip(), last_name=last_name.strip(), email_verified_at=now)
            try:
                with self.db.begin_nested():
                    self.db.add(member)
                    self.db.flush()
                    user.member_id = member.id
                    self.db.add(user)
            except IntegrityError as exc:
                raise AuthError(409, "An account with this email address was just created. Try signing in.") from exc
        elif mode == MODE_ADMIN:
            member = Member(email=user.email, display_name=user.display_name)
            self.db.add(member)
            self.db.flush()
            user.member_id = member.id
            if user.email_verified_at is None:
                user.email_verified_at = now
        elif mode == MODE_EXISTING:
            # Registered but never proven. The mailbox is proven now, so this
            # person sets the password and anyone else is signed out.
            user.password_hash = hash_password(password)
            user.email_verified_at = now
            self.auth.provider.revoke_all(self.db, user.id)
        self.db.flush()
        self.db.refresh(row)
        row.member_id = user.member_id
        issued = None
        if mode != MODE_MEMBER:
            issued = self.auth.provider.issue(self.db, user, portal=PORTAL_MEMBER, remember=remember)
        self.db.flush()
        return Accepted(user=user, session=issued, mode=mode)
