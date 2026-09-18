"""CurrentPrincipal: the authenticated identity every domain route works from.

Domain code never reads cookies, sessions or user rows directly. It receives a
principal and uses `principal.member_id` for member data — never a client-
supplied member identifier."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol
from uuid import UUID

from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.db.session import get_db

ROLE_MEMBER = "member"
ROLE_ADMIN = "admin"


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

    @property
    def is_admin(self) -> bool:
        return self.role == ROLE_ADMIN

    @property
    def is_member(self) -> bool:
        return self.role == ROLE_MEMBER and self.member_id is not None

    @property
    def display_name(self) -> str:
        return f"{self.first_name} {self.last_name}".strip()


class AuthProvider(Protocol):
    """How an HTTP request becomes a CurrentPrincipal. The development provider
    resolves an opaque session cookie; a future production provider (for
    example a Cognito JWT) implements the same method."""

    name: str

    def authenticate(self, request: Request, db: Session) -> CurrentPrincipal | None: ...


def _provider() -> AuthProvider:
    from app.core.runtime import get_runtime

    return get_runtime().auth_provider


def get_optional_principal(request: Request, db: Session = Depends(get_db)) -> CurrentPrincipal | None:
    return _provider().authenticate(request, db)


def get_current_principal(principal: CurrentPrincipal | None = Depends(get_optional_principal)) -> CurrentPrincipal:
    if principal is None:
        raise HTTPException(status_code=401, detail="Please sign in to continue.")
    return principal


def require_member(principal: CurrentPrincipal = Depends(get_current_principal)) -> CurrentPrincipal:
    if not principal.is_member:
        raise HTTPException(status_code=403, detail="This area is for Veye members.")
    return principal


def require_admin(principal: CurrentPrincipal = Depends(get_current_principal)) -> CurrentPrincipal:
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
