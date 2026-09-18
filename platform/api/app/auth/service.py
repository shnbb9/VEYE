"""AuthService: sign-up, sign-in, sign-out, email verification and password
reset on top of the development session provider and the notification
foundation. Business rules live here; the HTTP layer only maps them."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy.orm import Session

from app.auth.models import AuthToken, UserAccount
from app.auth.password import hash_password, needs_rehash, verify_password
from app.auth.principal import ROLE_ADMIN, ROLE_MEMBER
from app.auth.provider import DevelopmentSessionAuthProvider, IssuedSession, hash_token, new_token
from app.core.config import Settings
from app.members.models import Member
from app.notifications import templates
from app.notifications.service import NotificationService

PURPOSE_VERIFY = "verify_email"
PURPOSE_RESET = "reset_password"


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
                              email_verified: bool = False) -> UserAccount:
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
            member_id=member.id, is_synthetic=synthetic,
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
            email=email, password_hash=hash_password(password), role=ROLE_ADMIN,
            first_name=first_name, last_name=last_name, member_id=None, is_synthetic=synthetic,
            email_verified_at=datetime.now(timezone.utc),
        )
        self.db.add(user)
        self.db.flush()
        return user

    def sign_up(self, data: SignUpInput, *, remember: bool) -> tuple[UserAccount, IssuedSession, list[DeliveryStatus]]:
        user = self.create_member_account(data)
        deliveries = [self.send_verification(user), self.send_welcome(user)]
        issued = self.provider.issue(self.db, user, remember=remember)
        return user, issued, deliveries

    def sign_in(self, email: str, password: str, *, remember: bool) -> tuple[UserAccount, IssuedSession]:
        user = self.find_by_email(email)
        # Same failure for an unknown address and a wrong password.
        if user is None or not user.is_active or not verify_password(user.password_hash, password):
            raise AuthError(401, "That email address and password do not match.")
        if needs_rehash(user.password_hash):
            user.password_hash = hash_password(password)
        issued = self.provider.issue(self.db, user, remember=remember)
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
    def request_password_reset(self, email: str) -> DeliveryStatus | None:
        """Always safe to call: returns None for an unknown address so the API
        can answer identically either way."""
        user = self.find_by_email(email)
        if user is None or not user.is_active:
            return None
        raw = self._issue_token(user, PURPOSE_RESET, timedelta(minutes=self.settings.password_reset_minutes))
        link = f"{self.settings.web_base_url}/reset-password?token={raw}"
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

    # ---- internals ----------------------------------------------------------------------
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

    def _notify(self, user: UserAccount, kind: str, rendered: templates.Rendered) -> DeliveryStatus:
        notification = self.notifications.notify(user, kind, subject=rendered.subject, text=rendered.text, html=rendered.html)
        outbox = self.notifications.latest_outbox(notification.id)
        status = outbox.status if outbox else "failed"
        return DeliveryStatus(kind=kind, status=status, detail=outbox.last_error if outbox else None)
