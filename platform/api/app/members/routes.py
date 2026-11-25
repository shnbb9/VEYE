"""Member account routes (member portal): edit the profile, set / read /
remove the profile photo, export the member's own data. Every route acts on
the signed-in member only."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, Response, UploadFile, status
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app.auth.dependencies import get_auth_service
from app.auth.models import UserAccount
from app.auth.principal import PORTAL_MEMBER, CurrentPrincipal, require_member
from app.auth.routes import account_out
from app.auth.schemas import (
    AccountOut,
    DeliveryOut,
    EmailChangeRequest,
    OkResponse,
    PasswordChangeRequest,
    ProfileUpdate,
    SessionRow,
    SessionsOut,
)
from app.auth.service import AuthError, AuthService
from app.core.rate_limit import RateLimiter, client_address
from app.core.runtime import Runtime, get_runtime
from app.db.session import get_db
from app.members.photo_crop import CropIn, form_crop
from app.members.service import MemberProfileService, ProfileError
from app.storage.media_changes import committed_with

router = APIRouter(prefix="/api/v1/members/me", tags=["member-account"])


def _service(db: Session = Depends(get_db), runtime: Runtime = Depends(get_runtime)) -> MemberProfileService:
    return MemberProfileService(db, runtime.media_store, photo_max_bytes=runtime.settings.profile_photo_max_bytes)


def _user(db: Session, principal: CurrentPrincipal) -> UserAccount:
    user = db.get(UserAccount, principal.user_id)
    if user is None:
        raise HTTPException(status_code=401, detail="Please sign in again.")
    return user


def _raise(exc: ProfileError) -> None:
    raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.put("/profile", response_model=AccountOut)
def update_profile(payload: ProfileUpdate, principal: CurrentPrincipal = Depends(require_member), db: Session = Depends(get_db),
                   service: MemberProfileService = Depends(_service)) -> AccountOut:
    user = _user(db, principal)
    try:
        service.update_profile(user, first_name=payload.first_name, last_name=payload.last_name, phone=payload.phone,
                               postal_code=payload.postal_code)
    except ProfileError as exc:
        _raise(exc)
    db.commit()
    return account_out(user, PORTAL_MEMBER)


@router.post("/photo", response_model=AccountOut, status_code=status.HTTP_201_CREATED)
def upload_photo(request: Request, file: UploadFile = File(...), crop_x: int | None = Form(None), crop_y: int | None = Form(None),
                 crop_size: int | None = Form(None), principal: CurrentPrincipal = Depends(require_member),
                 db: Session = Depends(get_db), runtime: Runtime = Depends(get_runtime),
                 service: MemberProfileService = Depends(_service)) -> AccountOut:
    """A new picture, and optionally the square chosen in the crop frame
    (pixels of the upright original). The original is kept for re-cropping."""
    # A plain `def`: decoding and storing a picture is blocking work, and in an
    # `async def` every other request on this instance would wait for it.
    crop = form_crop(crop_x, crop_y, crop_size)
    RateLimiter(db, runtime.settings).enforce("photo_upload", subject=str(principal.user_id), address=client_address(request))
    db.commit()  # the hit stands whatever happens to the picture
    user = _user(db, principal)
    # Read at most one byte over the limit so an oversized upload is refused
    # without buffering an arbitrarily large body.
    data = file.file.read(service.photo_max_bytes + 1)
    try:
        with committed_with(db, service.changes):
            service.set_photo(user, data, file.content_type, crop)
    except ProfileError as exc:
        _raise(exc)
    return account_out(user, PORTAL_MEMBER)


@router.put("/photo/crop", response_model=AccountOut)
def recrop_photo(payload: CropIn, request: Request, principal: CurrentPrincipal = Depends(require_member),
                 db: Session = Depends(get_db), runtime: Runtime = Depends(get_runtime),
                 service: MemberProfileService = Depends(_service)) -> AccountOut:
    """Cut the avatar again from the picture already kept — no new upload."""
    RateLimiter(db, runtime.settings).enforce("photo_upload", subject=str(principal.user_id), address=client_address(request))
    db.commit()
    user = _user(db, principal)
    try:
        with committed_with(db, service.changes):
            service.recrop_photo(user, payload.crop())
    except ProfileError as exc:
        _raise(exc)
    return account_out(user, PORTAL_MEMBER)


@router.delete("/photo", response_model=AccountOut)
def remove_photo(principal: CurrentPrincipal = Depends(require_member), db: Session = Depends(get_db),
                 service: MemberProfileService = Depends(_service)) -> AccountOut:
    user = _user(db, principal)
    with committed_with(db, service.changes):
        service.remove_photo(user)
    return account_out(user, PORTAL_MEMBER)


@router.get("/photo")
def my_photo(size: str = "full", principal: CurrentPrincipal = Depends(require_member), db: Session = Depends(get_db),
             service: MemberProfileService = Depends(_service)) -> Response:
    """`original` is the picture the crop editor works on — the owner's own,
    and only through this route."""
    user = _user(db, principal)
    variant: Literal["full", "thumb", "original"] = "thumb" if size == "thumb" else "original" if size == "original" else "full"
    try:
        data, content_type = service.read_photo(user, variant)
    except ProfileError as exc:
        _raise(exc)
    return Response(content=data, media_type=content_type, headers={"Cache-Control": "private, max-age=0, must-revalidate"})


@router.get("/export")
def export_my_data(principal: CurrentPrincipal = Depends(require_member), db: Session = Depends(get_db),
                   service: MemberProfileService = Depends(_service)) -> JSONResponse:
    user = _user(db, principal)
    payload = service.export(user)
    filename = f"veye-my-data-{user.created_at.strftime('%Y%m%d')}.json"
    return JSONResponse(content=payload, headers={"Content-Disposition": f'attachment; filename="{filename}"'})


# ---- account security (the member's own credentials and sessions) --------------
# These are deliberately member-portal routes: the person proves who they are
# with their current password, and nothing here can be done to another account.

@router.post("/password", response_model=OkResponse)
def change_my_password(payload: PasswordChangeRequest, principal: CurrentPrincipal = Depends(require_member),
                       db: Session = Depends(get_db), auth: AuthService = Depends(get_auth_service)) -> OkResponse:
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
def my_sessions(principal: CurrentPrincipal = Depends(require_member), db: Session = Depends(get_db),
                runtime: Runtime = Depends(get_runtime)) -> SessionsOut:
    """Where this account is signed in right now — both portals, because a
    dual-access person should see the console session too."""
    rows = runtime.auth_provider.live_sessions(db, principal.user_id)
    db.commit()  # live_sessions touches nothing, but last_seen_at may be pending
    return SessionsOut(
        rows=[SessionRow(id=s.id, portal=s.portal, created_at=s.created_at, last_seen_at=s.last_seen_at,
                         expires_at=s.expires_at, remember=s.remember, current=s.id == principal.session_id)
              for s in rows],
        current_session_id=principal.session_id,
    )


@router.post("/sessions/revoke-others", response_model=OkResponse)
def sign_out_everywhere_else(principal: CurrentPrincipal = Depends(require_member), db: Session = Depends(get_db),
                             runtime: Runtime = Depends(get_runtime)) -> OkResponse:
    ended = runtime.auth_provider.revoke_others(db, principal.user_id, keep_session_id=principal.session_id)
    db.commit()
    if not ended:
        return OkResponse(ok=True, message="This is the only place you are signed in.")
    return OkResponse(ok=True, message=f"{ended} other {'session was' if ended == 1 else 'sessions were'} signed out.")


@router.post("/email", response_model=DeliveryOut, status_code=status.HTTP_202_ACCEPTED)
def request_email_change(payload: EmailChangeRequest, principal: CurrentPrincipal = Depends(require_member),
                         db: Session = Depends(get_db), auth: AuthService = Depends(get_auth_service)) -> DeliveryOut:
    """Ask to move this account to another address. The confirmation link goes
    to the NEW address and nothing changes until it is used."""
    user = _user(db, principal)
    try:
        delivery = auth.request_email_change(user, new_email=str(payload.new_email), password=payload.password)
    except AuthError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    db.commit()
    return DeliveryOut(kind=delivery.kind, status=delivery.status, detail=delivery.detail)


@router.delete("/email", response_model=OkResponse)
def cancel_email_change(principal: CurrentPrincipal = Depends(require_member), db: Session = Depends(get_db),
                        auth: AuthService = Depends(get_auth_service)) -> OkResponse:
    user = _user(db, principal)
    auth.cancel_email_change(user)
    db.commit()
    return OkResponse(ok=True, message="The email change has been cancelled.")
