"""AuthService: sign-up, sign-in, sign-out, email verification and password
reset on top of the development session provider and the notification
foundation. Business rules live here; the HTTP layer only maps them.

One service, two portals: `sign_in(..., portal=)` verifies the same password
the same way and then requires the access that portal needs — a member
profile for the member application, administrator access for the console.
The portal the person chose decides where they land; the account's flags
never redirect them."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy.orm import Session

from app.auth.models import AuthToken, UserAccount
from app.auth.password import hash_password, needs_rehash, verify_password
from app.auth.principal import PORTAL_ADMIN, PORTAL_MEMBER, PORTALS, ROLE_ADMIN, ROLE_MEMBER
from app.auth.provider import DevelopmentSessionAuthProvider, IssuedSession, hash_token, new_token
from app.core.config import Settings
from app.members.models import Member
from app.notifications import templates
from app.notifications.service import NotificationService

log = logging.getLogger("veye.auth")

PURPOSE_VERIFY = "verify_email"
PURPOSE_RESET = "reset_password"
# An invitation to the admin console: administrator access is provisioned by
# someone who already has it, never self-served.
PURPOSE_ADMIN_INVITE = "admin_invite"
# Confirming a new email address. The link goes to the NEW address, so the
# account only moves when the person holding that mailbox uses it.
PURPOSE_EMAIL_CHANGE = "change_email"


class AuthError(Exception):
    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


@dataclass(frozen=True)
class DeliveryStatus:
    kind: str
    status: str  # sent | failed | skipped
    detail: str | None = None


@dataclass(frozen=True)
class SignUpInput:
    first_name: str
    last_name: str
    email: str
    password: str
    phone: str | None = None
    postal_code: str | None = None


def normalise_email(value: str) -> str:
    return value.strip().lower()


class AuthService:
    def __init__(self, db: Session, provider: DevelopmentSessionAuthProvider, notifications: NotificationService,
                 settings: Settings) -> None:
        self.db = db
        self.provider = provider
        self.notifications = notifications
        self.settings = settings

    # ---- accounts -------------------------------------------------------------------
    def find_by_email(self, email: str) -> UserAccount | None:
        return self.db.query(UserAccount).filter(UserAccount.email == normalise_email(email)).one_or_none()

    def create_member_account(self, data: SignUpInput, *, synthetic: bool = False,
                              email_verified: bool = False, admin_access: bool = False) -> UserAccount:
        email = normalise_email(data.email)
        if self.find_by_email(email) is not None:
            raise AuthError(409, "An account with this email address already exists. Try signing in instead.")
        self._check_password(data.password)
        member = Member(email=email, display_name=f"{data.first_name.strip()} {data.last_name.strip()}".strip())
        self.db.add(member)
        self.db.flush()
        user = UserAccount(
            email=email, password_hash=hash_password(data.password), role=ROLE_MEMBER,
            first_name=data.first_name.strip(), last_name=data.last_name.strip(),
            phone=(data.phone or "").strip() or None, postal_code=(data.postal_code or "").strip() or None,
            member_id=member.id, is_synthetic=synthetic, admin_access=admin_access,
            email_verified_at=datetime.now(timezone.utc) if email_verified else None,
        )
        self.db.add(user)
        self.db.flush()
        return user

    def create_admin_account(self, *, first_name: str, last_name: str, email: str, password: str,
                             synthetic: bool = False) -> UserAccount:
        email = normalise_email(email)
        if self.find_by_email(email) is not None:
            raise AuthError(409, "An account with this email address already exists.")
        self._check_password(password)
        user = UserAccount(
            email=email, password_hash=hash_password(password), role=ROLE_ADMIN, admin_access=True,
            first_name=first_name, last_name=last_name, member_id=None, is_synthetic=synthetic,
            email_verified_at=datetime.now(timezone.utc),
        )
        self.db.add(user)
        self.db.flush()
        return user

    def grant_admin_access(self, user: UserAccount) -> UserAccount:
        """Administrator access is provisioned by the system, never self-served.
        The account keeps its member profile: the same person may use both."""
        user.admin_access = True
        self.db.flush()
        return user

    def sign_up(self, data: SignUpInput, *, remember: bool) -> tuple[UserAccount, IssuedSession, list[DeliveryStatus]]:
        """Member sign-up only. It creates the identity and the member profile
        and opens a MEMBER portal session; there is no admin self-registration."""
        user = self.create_member_account(data)
        deliveries = [self.send_verification(user), self.send_welcome(user)]
        issued = self.provider.issue(self.db, user, portal=PORTAL_MEMBER, remember=remember)
        return user, issued, deliveries

    def sign_in(self, email: str, password: str, *, portal: str, remember: bool) -> tuple[UserAccount, IssuedSession]:
        if portal not in PORTALS:
            raise AuthError(400, "Unknown sign-in portal.")
        user = self.find_by_email(email)
        # Same failure for an unknown address and a wrong password.
        if user is None or not user.is_active or not verify_password(user.password_hash, password):
            raise AuthError(401, "That email address and password do not match.")
        if needs_rehash(user.password_hash):
            user.password_hash = hash_password(password)
        # The password is right; now the portal's own access requirement.
        if portal == PORTAL_MEMBER and not user.member_access:
            raise AuthError(403, "This account does not have a Veye member profile. Administrators sign in through the admin console.")
        if portal == PORTAL_ADMIN and not user.admin_access:
            raise AuthError(403, "This account does not have administrator access to the Veye console.")
        issued = self.provider.issue(self.db, user, portal=portal, remember=remember)
        return user, issued

    def sign_out(self, session_id: UUID | None) -> None:
        if session_id is not None:
            self.provider.revoke(self.db, session_id)

    # ---- email verification --------------------------------------------------------
    def send_verification(self, user: UserAccount) -> DeliveryStatus:
        raw = self._issue_token(user, PURPOSE_VERIFY, timedelta(hours=self.settings.email_verification_hours))
        link = f"{self.settings.web_base_url}/verify-email?token={raw}"
        rendered = templates.email_verification(user.first_name, link, self.settings.email_verification_hours)
        return self._notify(user, "email_verification", rendered)

    def send_welcome(self, user: UserAccount) -> DeliveryStatus:
        rendered = templates.welcome(user.first_name, self.settings.web_base_url)
        return self._notify(user, "welcome", rendered)

    def verify_email(self, raw_token: str) -> UserAccount:
        token = self._consume_token(raw_token, PURPOSE_VERIFY)
        user = token.user
        if user.email_verified_at is None:
            user.email_verified_at = datetime.now(timezone.utc)
        self.db.flush()
        return user

    # ---- password reset ---------------------------------------------------------------
    def request_password_reset(self, email: str, *, portal: str = PORTAL_MEMBER) -> DeliveryStatus | None:
        """Always safe to call: returns None for an unknown address so the API
        can answer identically either way. `portal` only decides which sign-in
        screen the person is returned to afterwards — the token grants nothing
        portal-specific and the reset itself is identical."""
        if portal not in PORTALS:
            portal = PORTAL_MEMBER
        user = self.find_by_email(email)
        if user is None or not user.is_active:
            return None
        raw = self._issue_token(user, PURPOSE_RESET, timedelta(minutes=self.settings.password_reset_minutes))
        link = f"{self.settings.web_base_url}/reset-password?token={raw}"
        if portal == PORTAL_ADMIN:
            link += "&portal=admin"
        rendered = templates.password_reset(user.first_name, link, self.settings.password_reset_minutes)
        return self._notify(user, "password_reset", rendered)

    def reset_password(self, raw_token: str, new_password: str) -> UserAccount:
        self._check_password(new_password)
        token = self._consume_token(raw_token, PURPOSE_RESET)
        user = token.user
        user.password_hash = hash_password(new_password)
        # Every existing session ends: whoever held the old password is out.
        self.provider.revoke_all(self.db, user.id)
        self.db.flush()
        return user

    # ---- administrator invitations ----------------------------------------------------
    def invite_administrator(self, *, email: str, first_name: str, last_name: str,
                             invited_by: UserAccount) -> tuple[UserAccount, DeliveryStatus, bool]:
        """Create (or upgrade) an account that may use the console and email it
        a single-use activation link. Returns (account, delivery, created).

        An existing member can be invited: the same person then holds a member
        profile and administrator access, and the portal they sign in through
        still decides where they land. Nothing here grants a level of access —
        every administrator has exactly the same one."""
        email = normalise_email(email)
        first_name, last_name = first_name.strip(), last_name.strip()
        if not first_name:
            raise AuthError(422, "An administrator needs a first name.")
        existing = self.find_by_email(email)
        created = False
        if existing is None:
            # No usable password until the invitation is accepted: the account
            # cannot be signed into, only activated through the link.
            user = UserAccount(
                email=email, password_hash=hash_password(new_token()), role=ROLE_ADMIN, admin_access=True,
                first_name=first_name, last_name=last_name, member_id=None,
            )
            self.db.add(user)
            created = True
        else:
            user = existing
            if user.admin_access and user.invitation_accepted_at is not None:
                raise AuthError(409, "That person already has administrator access.")
            if not user.is_active:
                raise AuthError(409, "That account is deactivated. Reactivate it before inviting them again.")
            user.admin_access = True
        user.invited_at = datetime.now(timezone.utc)
        user.invited_by_user_id = invited_by.id
        user.invitation_accepted_at = None
        self.db.flush()
        delivery = self._send_admin_invitation(user, invited_by)
        return user, delivery, created

    def resend_admin_invitation(self, user: UserAccount, invited_by: UserAccount) -> DeliveryStatus:
        if user.invitation_accepted_at is not None:
            raise AuthError(409, "That invitation has already been accepted.")
        if not user.is_active:
            raise AuthError(409, "That account is deactivated.")
        user.invited_at = datetime.now(timezone.utc)
        self.db.flush()
        return self._send_admin_invitation(user, invited_by)

    def revoke_admin_invitation(self, user: UserAccount) -> None:
        """Withdraw an invitation nobody has accepted yet. An invited-only
        account (no member profile) is switched off as well, so a stale row
        can never become a way in."""
        if user.invitation_accepted_at is not None:
            raise AuthError(409, "That invitation has already been accepted. Deactivate the account instead.")
        self._invalidate_tokens(user, PURPOSE_ADMIN_INVITE)
        user.admin_access = False
        user.invited_at = None
        if user.member_id is None:
            user.is_active = False
            user.deactivated_at = datetime.now(timezone.utc)
        self.provider.revoke_all(self.db, user.id)
        self.db.flush()

    def invitation_for(self, raw_token: str) -> UserAccount:
        """The account an unused invitation belongs to, for the activation
        screen. Reading it consumes nothing."""
        token = self._peek_token(raw_token, PURPOSE_ADMIN_INVITE)
        return token.user

    def accept_admin_invitation(self, raw_token: str, password: str) -> UserAccount:
        self._check_password(password)
        token = self._consume_token(raw_token, PURPOSE_ADMIN_INVITE)
        user = token.user
        if not user.is_active:
            raise AuthError(409, "That account is deactivated. Ask another administrator to reactivate it.")
        user.password_hash = hash_password(password)
        user.admin_access = True
        user.invitation_accepted_at = datetime.now(timezone.utc)
        if user.email_verified_at is None:
            user.email_verified_at = datetime.now(timezone.utc)
        # Anything issued before the password existed is worthless now.
        self.provider.revoke_all(self.db, user.id)
        self.db.flush()
        return user

    def _send_admin_invitation(self, user: UserAccount, invited_by: UserAccount) -> DeliveryStatus:
        self._invalidate_tokens(user, PURPOSE_ADMIN_INVITE)
        raw = self._issue_token(user, PURPOSE_ADMIN_INVITE, timedelta(hours=self.settings.admin_invitation_hours))
        link = f"{self.settings.web_base_url}/admin/accept-invitation?token={raw}"
        rendered = templates.admin_invitation(user.first_name, link, self.settings.admin_invitation_hours,
                                              invited_by.display_name or "A Veye administrator")
        return self._notify(user, "admin_invitation", rendered)

    # ---- account state --------------------------------------------------------------------
    def set_account_active(self, user: UserAccount, *, active: bool, notify: bool = True) -> DeliveryStatus | None:
        """Switch an account on or off. Deactivating ends every live session at
        once — access is withdrawn now, not when the cookie happens to expire."""
        if user.is_active == active:
            return None
        user.is_active = active
        user.deactivated_at = None if active else datetime.now(timezone.utc)
        delivery = None
        if not active:
            self.provider.revoke_all(self.db, user.id)
            if notify:
                delivery = self._notify(user, "account_deactivated",
                                        templates.account_deactivated(user.first_name, self._support_email()))
        self.db.flush()
        return delivery

    # ---- the member's own credentials -------------------------------------------------------
    def change_password(self, user: UserAccount, *, current_password: str, new_password: str,
                        keep_session_id: UUID | None) -> int:
        """Change a password from inside the application. The person stays
        signed in where they are; every other session ends."""
        if not verify_password(user.password_hash, current_password):
            raise AuthError(403, "That current password is not right.")
        self._check_password(new_password)
        if verify_password(user.password_hash, new_password):
            raise AuthError(422, "Choose a password you have not used here before.")
        user.password_hash = hash_password(new_password)
        ended = self.provider.revoke_others(self.db, user.id, keep_session_id=keep_session_id)
        self.db.flush()
        return ended

    def request_email_change(self, user: UserAccount, *, new_email: str, password: str) -> DeliveryStatus:
        """Ask to move the account to another address. Nothing changes until
        the link sent to that address is used."""
        if not verify_password(user.password_hash, password):
            raise AuthError(403, "That password is not right.")
        email = normalise_email(new_email)
        if email == user.email:
            raise AuthError(422, "That is already the address on this account.")
        if self.find_by_email(email) is not None:
            raise AuthError(409, "That email address is already in use.")
        self._invalidate_tokens(user, PURPOSE_EMAIL_CHANGE)
        user.pending_email = email
        self.db.flush()
        raw = self._issue_token(user, PURPOSE_EMAIL_CHANGE, timedelta(hours=self.settings.email_change_hours))
        link = f"{self.settings.web_base_url}/confirm-email?token={raw}"
        rendered = templates.email_change(user.first_name, link, self.settings.email_change_hours, email)
        # Deliberately sent to the NEW address, not the current one.
        return self._notify(user, "email_change", rendered, to_email=email)

    def cancel_email_change(self, user: UserAccount) -> None:
        self._invalidate_tokens(user, PURPOSE_EMAIL_CHANGE)
        user.pending_email = None
        self.db.flush()

    def confirm_email_change(self, raw_token: str) -> UserAccount:
        token = self._peek_token(raw_token, PURPOSE_EMAIL_CHANGE)
        user = token.user
        pending = user.pending_email
        if not pending:
            raise AuthError(400, "There is no pending email change for this account.")
        if self.find_by_email(pending) is not None:
            raise AuthError(409, "That email address has been taken since the change was requested.")
        self._consume_token(raw_token, PURPOSE_EMAIL_CHANGE)
        previous = user.email
        user.email = pending
        user.pending_email = None
        user.email_verified_at = datetime.now(timezone.utc)
        if user.member is not None:
            user.member.email = pending
        # The identity on the account moved: everyone signs in again.
        self.provider.revoke_all(self.db, user.id)
        self.db.flush()
        # Only the new address was ever asked to confirm. The old one is told
        # afterwards, so an address change nobody authorised is visible to the
        # person who still holds that mailbox. A failed send must not undo a
        # change the member completed correctly, so it is recorded, not raised.
        if previous and previous.lower() != pending.lower():
            self._notify(user, "email_changed",
                         templates.email_changed_notice(user.first_name, previous, pending, self._support_email()),
                         to_email=previous)
        return user

    def _support_email(self) -> str | None:
        """The address the console maintains, for messages that go to people
        who cannot open the application — a deactivated account, or a mailbox
        that no longer signs in anywhere.

        Imported here rather than at module scope: product settings reach back
        into auth for the admin guard on their own routes."""
        try:
            from app.product_settings.routes import read_support

            return read_support(self.db).support_email or None
        except Exception:  # settings are a convenience here, never a blocker
            return None

    # ---- internals ----------------------------------------------------------------------
    def _invalidate_tokens(self, user: UserAccount, purpose: str) -> None:
        """Burn every unused token of this kind, so only the newest link works."""
        now = datetime.now(timezone.utc)
        rows = (self.db.query(AuthToken)
                .filter(AuthToken.user_id == user.id, AuthToken.purpose == purpose, AuthToken.used_at.is_(None))
                .all())
        for row in rows:
            row.used_at = now
        self.db.flush()

    def _peek_token(self, raw_token: str, purpose: str) -> AuthToken:
        """Validate a token without spending it."""
        token = self.db.query(AuthToken).filter(AuthToken.token_hash == hash_token(raw_token or "")).one_or_none()
        if token is None or token.purpose != purpose:
            raise AuthError(400, "This link is not valid. Request a new one.")
        if token.used_at is not None:
            raise AuthError(400, "This link has already been used. Request a new one.")
        expires_at = token.expires_at if token.expires_at.tzinfo else token.expires_at.replace(tzinfo=timezone.utc)
        if expires_at <= datetime.now(timezone.utc):
            raise AuthError(400, "This link has expired. Request a new one.")
        return token

    def _check_password(self, password: str) -> None:
        if len(password) < self.settings.password_min_length:
            raise AuthError(422, f"Choose a password of at least {self.settings.password_min_length} characters.")
        if len(password) > 256:
            raise AuthError(422, "That password is too long.")

    def _issue_token(self, user: UserAccount, purpose: str, lifetime: timedelta) -> str:
        raw = new_token()
        self.db.add(AuthToken(user_id=user.id, purpose=purpose, token_hash=hash_token(raw),
                              expires_at=datetime.now(timezone.utc) + lifetime))
        self.db.flush()
        return raw

    def _consume_token(self, raw_token: str, purpose: str) -> AuthToken:
        token = self.db.query(AuthToken).filter(AuthToken.token_hash == hash_token(raw_token or "")).one_or_none()
        if token is None or token.purpose != purpose:
            raise AuthError(400, "This link is not valid. Request a new one.")
        if token.used_at is not None:
            raise AuthError(400, "This link has already been used. Request a new one.")
        expires_at = token.expires_at if token.expires_at.tzinfo else token.expires_at.replace(tzinfo=timezone.utc)
        if expires_at <= datetime.now(timezone.utc):
            raise AuthError(400, "This link has expired. Request a new one.")
        token.used_at = datetime.now(timezone.utc)
        self.db.flush()
        return token

    def _notify(self, user: UserAccount, kind: str, rendered: templates.Rendered,
                *, to_email: str | None = None) -> DeliveryStatus:
        notification = self.notifications.notify(user, kind, subject=rendered.subject, text=rendered.text,
                                                 html=rendered.html, to_email=to_email)
        outbox = self.notifications.latest_outbox(notification.id)
        status = outbox.status if outbox else "failed"
        return DeliveryStatus(kind=kind, status=status, detail=outbox.last_error if outbox else None)
