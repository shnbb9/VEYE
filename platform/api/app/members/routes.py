"""Member account routes (member portal): edit the profile, set / read /
remove the profile photo, export the member's own data. Every route acts on
the signed-in member only."""

from __future__ import annotations

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile, status
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app.auth.models import UserAccount
from app.auth.principal import PORTAL_MEMBER, CurrentPrincipal, require_member
from app.auth.routes import account_out
from app.auth.schemas import AccountOut, ProfileUpdate
from app.core.runtime import Runtime, get_runtime
from app.db.session import get_db
from app.members.service import MemberProfileService, ProfileError

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
async def upload_photo(file: UploadFile = File(...), principal: CurrentPrincipal = Depends(require_member),
                       db: Session = Depends(get_db), service: MemberProfileService = Depends(_service)) -> AccountOut:
    user = _user(db, principal)
    # Read at most one byte over the limit so an oversized upload is refused
    # without buffering an arbitrarily large body.
    data = await file.read(service.photo_max_bytes + 1)
    try:
        service.set_photo(user, data, file.content_type)
    except ProfileError as exc:
        _raise(exc)
    db.commit()
    return account_out(user, PORTAL_MEMBER)


@router.delete("/photo", response_model=AccountOut)
def remove_photo(principal: CurrentPrincipal = Depends(require_member), db: Session = Depends(get_db),
                 service: MemberProfileService = Depends(_service)) -> AccountOut:
    user = _user(db, principal)
    service.remove_photo(user)
    db.commit()
    return account_out(user, PORTAL_MEMBER)


@router.get("/photo")
def my_photo(principal: CurrentPrincipal = Depends(require_member), db: Session = Depends(get_db),
             service: MemberProfileService = Depends(_service)) -> Response:
    user = _user(db, principal)
    try:
        data, content_type = service.read_photo(user)
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
