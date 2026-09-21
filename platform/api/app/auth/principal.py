"""CurrentPrincipal: the authenticated identity every domain route works from.

Domain code never reads cookies, sessions or user rows directly. It receives a
principal and uses `principal.member_id` for member data — never a client-
supplied member identifier.

VEYE has two portals — the member application and the admin console — and one
account system underneath. A principal always says which portal session it
came from (`portal`), and a route asks for the portal it belongs to
(`require_member` / `require_admin`). Access is two independent facts on the
account (a member profile, administrator access), never a single role that
decides where a sign-in lands."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol
from uuid import UUID

from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.db.session import get_db

ROLE_MEMBER = "member"
ROLE_ADMIN = "admin"

PORTAL_MEMBER = "member"
PORTAL_ADMIN = "admin"
PORTALS = (PORTAL_MEMBER, PORTAL_ADMIN)


@dataclass(frozen=True)
class CurrentPrincipal:
    user_id: UUID
    role: str
    email: str
    first_name: str
    last_name: str
    member_id: UUID | None
    email_verified: bool
    session_id: UUID | None
    is_synthetic: bool = False
    admin_access: bool = False
    portal: str | None = None

    @property
    def is_admin(self) -> bool:
        """The account may use the admin console (an access fact, not a portal)."""
        return self.admin_access

    @property
    def is_member(self) -> bool:
        """The account owns a member profile (an access fact, not a portal)."""
        return self.member_id is not None

    @property
    def display_name(self) -> str:
        return f"{self.first_name} {self.last_name}".strip()


class AuthProvider(Protocol):
    """How an HTTP request becomes a CurrentPrincipal for ONE portal. The
    development provider resolves that portal's opaque session cookie; a
    future production provider implements the same method."""

    name: str

    def authenticate(self, request: Request, db: Session, portal: str) -> CurrentPrincipal | None: ...


def _provider() -> AuthProvider:
    from app.core.runtime import get_runtime

    return get_runtime().auth_provider


def get_member_principal(request: Request, db: Session = Depends(get_db)) -> CurrentPrincipal | None:
    """The member-portal session on this request, if any."""
    return _provider().authenticate(request, db, PORTAL_MEMBER)


def get_admin_principal(request: Request, db: Session = Depends(get_db)) -> CurrentPrincipal | None:
    """The admin-portal session on this request, if any."""
    return _provider().authenticate(request, db, PORTAL_ADMIN)


# The member portal is the ordinary application; routes that are not
# portal-specific (notification preferences, resend verification) belong to it.
get_optional_principal = get_member_principal


def get_current_principal(principal: CurrentPrincipal | None = Depends(get_member_principal)) -> CurrentPrincipal:
    if principal is None:
        raise HTTPException(status_code=401, detail="Please sign in to continue.")
    return principal


def require_member(principal: CurrentPrincipal | None = Depends(get_member_principal)) -> CurrentPrincipal:
    if principal is None:
        raise HTTPException(status_code=401, detail="Please sign in to continue.")
    if not principal.is_member:
        raise HTTPException(status_code=403, detail="This area is for Veye members.")
    return principal


def require_admin(principal: CurrentPrincipal | None = Depends(get_admin_principal)) -> CurrentPrincipal:
    if principal is None:
        raise HTTPException(status_code=401, detail="Please sign in to the admin console to continue.")
    if not principal.is_admin:
        raise HTTPException(status_code=403, detail="This area is for Veye administrators.")
    return principal


def resolve_member_route(member_ref: str, principal: CurrentPrincipal) -> UUID:
    """The only member reference a browser may use is `me`. Anything else — a
    UUID, an alias, another member — is unavailable (404) so nothing can be
    enumerated."""
    if member_ref == "me" and principal.is_member and principal.member_id is not None:
        return principal.member_id
    raise HTTPException(status_code=404, detail="Only your own member record is available.")
