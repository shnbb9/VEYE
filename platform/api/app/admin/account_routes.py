"""The administrator's OWN account: the console half of what a member can
already do in Settings → Sign-in details.

Separate from `administrators_routes.py`, which is about *other* people's
access. Nothing here can touch another account, and nothing here grants
anything: an administrator may change their own password and end their own
sessions, exactly as a member may.

The routes live behind `require_admin`, so the session being kept is the
console session that made the request — a member session in the same browser
is untouched, as the two-portal rule requires.
"""

from __future__ import annotations

from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, Response, UploadFile, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from app.admin.audit import record_audit
from app.auth.dependencies import get_auth_service
from app.auth.models import UserAccount
from app.auth.password import verify_password
from app.auth.principal import PORTAL_ADMIN, CurrentPrincipal, require_admin
from app.auth.schemas import AccountOut, OkResponse, PasswordChangeRequest, SessionRow, SessionsOut
from app.auth.service import AuthError, AuthService
from app.core.rate_limit import RateLimiter, client_address
from app.core.runtime import Runtime, get_runtime
from app.db.session import get_db
from app.members.models import Member
from app.members.service import MemberProfileService, ProfileError

router = APIRouter(prefix="/api/v1/admin/account", tags=["admin-account"], dependencies=[Depends(require_admin)])
# Other administrators' pictures, read-only, for the Administrators list.
peers_router = APIRouter(prefix="/api/v1/admin/administrators", tags=["admin-account"],
                         dependencies=[Depends(require_admin)])


def _user(db: Session, principal: CurrentPrincipal) -> UserAccount:
    user = db.get(UserAccount, principal.user_id)
    if user is None:
        raise HTTPException(status_code=401, detail="Please sign in to the admin console again.")
    return user


@router.post("/password", response_model=OkResponse)
def change_my_password(payload: PasswordChangeRequest, principal: CurrentPrincipal = Depends(require_admin),
                       db: Session = Depends(get_db), auth: AuthService = Depends(get_auth_service)) -> OkResponse:
    """Change the console password from inside the console. This session
    survives; every other session of the account ends — including a member
    session the same person holds, because the password is shared."""
    user = _user(db, principal)
    try:
        ended = auth.change_password(user, current_password=payload.current_password,
                                     new_password=payload.new_password, keep_session_id=principal.session_id)
    except AuthError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    db.commit()
    message = "Your password has been changed."
    if ended:
        message += f" {ended} other signed-in {'session was' if ended == 1 else 'sessions were'} ended."
    return OkResponse(ok=True, message=message)


@router.get("/sessions", response_model=SessionsOut)
def my_sessions(principal: CurrentPrincipal = Depends(require_admin), db: Session = Depends(get_db),
                runtime: Runtime = Depends(get_runtime)) -> SessionsOut:
    rows = runtime.auth_provider.live_sessions(db, principal.user_id)
    db.commit()
    return SessionsOut(
        rows=[SessionRow(id=s.id, portal=s.portal, created_at=s.created_at, last_seen_at=s.last_seen_at,
                         expires_at=s.expires_at, remember=s.remember, current=s.id == principal.session_id)
              for s in rows],
        current_session_id=principal.session_id,
    )


@router.post("/sessions/revoke-others", response_model=OkResponse)
def sign_out_everywhere_else(principal: CurrentPrincipal = Depends(require_admin), db: Session = Depends(get_db),
                             runtime: Runtime = Depends(get_runtime)) -> OkResponse:
    ended = runtime.auth_provider.revoke_others(db, principal.user_id, keep_session_id=principal.session_id)
    db.commit()
    if not ended:
        return OkResponse(ok=True, message="This is the only place you are signed in.")
    return OkResponse(ok=True, message=f"{ended} other {'session was' if ended == 1 else 'sessions were'} signed out.")


# ---- the administrator's own picture (architecture V2 §5.3) -------------------------
# One picture per sign-in account, the same fields the member application
# uses, so a person with both kinds of access has one avatar in both portals.
# These routes act only on the signed-in console account: there is no route by
# which one administrator changes another's picture.

def _photos(db: Session, runtime: Runtime) -> MemberProfileService:
    return MemberProfileService(db, runtime.media_store, photo_max_bytes=runtime.settings.profile_photo_max_bytes)


def _photo_response(data: bytes, content_type: str) -> Response:
    return Response(content=data, media_type=content_type,
                    headers={"Cache-Control": "private, max-age=0, must-revalidate", "X-Content-Type-Options": "nosniff"})


@router.get("/photo")
def my_photo(size: Literal["full", "thumb"] = "full", principal: CurrentPrincipal = Depends(require_admin),
             db: Session = Depends(get_db), runtime: Runtime = Depends(get_runtime)) -> Response:
    user = _user(db, principal)
    try:
        data, content_type = _photos(db, runtime).read_photo(user, size)
    except ProfileError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    return _photo_response(data, content_type)


@router.post("/photo", response_model=AccountOut, status_code=status.HTTP_201_CREATED)
async def upload_my_photo(request: Request, file: UploadFile = File(...), principal: CurrentPrincipal = Depends(require_admin),
                          db: Session = Depends(get_db), runtime: Runtime = Depends(get_runtime)) -> AccountOut:
    from app.auth.routes import account_out

    RateLimiter(db, runtime.settings).enforce("photo_upload", subject=str(principal.user_id), address=client_address(request))
    user = _user(db, principal)
    service = _photos(db, runtime)
    data = await file.read(service.photo_max_bytes + 1)
    try:
        service.set_photo(user, data, file.content_type)
    except ProfileError as exc:
        db.commit()  # keep the rate-limit hit
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    record_audit(db, principal, "account.photo_changed", "user_account", str(user.id), {})
    db.commit()
    return account_out(user, PORTAL_ADMIN)


@router.delete("/photo", response_model=AccountOut)
def remove_my_photo(principal: CurrentPrincipal = Depends(require_admin), db: Session = Depends(get_db),
                    runtime: Runtime = Depends(get_runtime)) -> AccountOut:
    from app.auth.routes import account_out

    user = _user(db, principal)
    _photos(db, runtime).remove_photo(user)
    record_audit(db, principal, "account.photo_removed", "user_account", str(user.id), {})
    db.commit()
    return account_out(user, PORTAL_ADMIN)


@peers_router.get("/{user_id}/photo")
def administrator_photo(user_id: UUID, size: Literal["full", "thumb"] = "thumb", db: Session = Depends(get_db),
                        runtime: Runtime = Depends(get_runtime)) -> Response:
    """Another administrator's picture, for the Administrators list. Only an
    account that holds console access is served here — never a member's."""
    user = db.get(UserAccount, user_id)
    if user is None or not user.admin_access:
        raise HTTPException(status_code=404, detail="No such administrator.")
    try:
        data, content_type = _photos(db, runtime).read_photo(user, size)
    except ProfileError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    return _photo_response(data, content_type)


# ---- an administrator's OWN member profile (architecture V2 §5.2) -----------------------

class MemberProfileIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    password: str = Field(min_length=1, max_length=256)
    # The explanation was read: this creates PERSONAL health data, and it is
    # not a way to see anyone else's.
    understood: Literal[True]


class MemberProfileOut(BaseModel):
    member_id: UUID
    created: bool
    message: str


@router.post("/member-profile", response_model=MemberProfileOut)
def create_my_member_profile(payload: MemberProfileIn, request: Request, response: Response,
                             principal: CurrentPrincipal = Depends(require_admin), db: Session = Depends(get_db),
                             runtime: Runtime = Depends(get_runtime)) -> MemberProfileOut:
    """Give this console account its own member profile — the same account,
    password and administrator access, one more fact on it. The member
    application still needs its own sign-in at /login, and shows only this
    person's own data. Nothing here can create or open anyone else's.

    Re-authentication is the current password. Idempotent: a second call (a
    double click, a retry) returns the profile the first one made."""
    RateLimiter(db, runtime.settings).enforce("reauthenticate", subject=str(principal.user_id),
                                              address=client_address(request))
    user = _user(db, principal)
    if not verify_password(user.password_hash, payload.password):
        db.commit()  # keep the rate-limit hit
        raise HTTPException(status_code=403, detail="That password is not right.")
    if not user.is_active:
        raise HTTPException(status_code=409, detail="This account is deactivated.")
    if user.email_verified_at is None:
        raise HTTPException(status_code=409, detail="Verify this account's email address first.")
    if user.member_id is not None:
        db.commit()
        return MemberProfileOut(member_id=user.member_id, created=False,
                                message="You already have a member profile. Sign in at /login to use it.")
    member = Member(email=user.email, display_name=user.display_name)
    db.add(member)
    db.flush()
    # The conditional update is the guard: of two concurrent calls, only one
    # links a profile; the other's new row is rolled back.
    linked = (db.query(UserAccount).filter(UserAccount.id == user.id, UserAccount.member_id.is_(None))
              .update({"member_id": member.id}, synchronize_session=False))
    if linked != 1:
        db.rollback()
        db.refresh(user)
        return MemberProfileOut(member_id=user.member_id, created=False,
                                message="You already have a member profile. Sign in at /login to use it.")
    record_audit(db, principal, "account.member_profile_created", "user_account", str(user.id),
                 {"member_id": str(member.id)})
    db.commit()
    response.status_code = status.HTTP_201_CREATED
    return MemberProfileOut(member_id=member.id, created=True,
                            message="Your member profile is ready. Sign in at /login with this same email and "
                                    "password to use the member application.")
