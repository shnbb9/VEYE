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

from fastapi import APIRouter, Depends, HTTPException

from sqlalchemy.orm import Session

from app.auth.dependencies import get_auth_service
from app.auth.models import UserAccount
from app.auth.principal import CurrentPrincipal, require_admin
from app.auth.schemas import OkResponse, PasswordChangeRequest, SessionRow, SessionsOut
from app.auth.service import AuthError, AuthService
from app.core.runtime import Runtime, get_runtime
from app.db.session import get_db

router = APIRouter(prefix="/api/v1/admin/account", tags=["admin-account"], dependencies=[Depends(require_admin)])


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
