from fastapi import Depends, Response
from sqlalchemy.orm import Session

from app.auth.provider import IssuedSession
from app.auth.service import AuthService
from app.core.runtime import Runtime, get_runtime
from app.db.session import get_db
from app.notifications.service import NotificationService


def get_notification_service(db: Session = Depends(get_db), runtime: Runtime = Depends(get_runtime)) -> NotificationService:
    return NotificationService(db, runtime.email)


def get_auth_service(
    db: Session = Depends(get_db),
    runtime: Runtime = Depends(get_runtime),
    notifications: NotificationService = Depends(get_notification_service),
) -> AuthService:
    return AuthService(db, runtime.auth_provider, notifications, runtime.settings)


def set_session_cookie(response: Response, issued: IssuedSession, runtime: Runtime) -> None:
    response.set_cookie(
        key=runtime.settings.session_cookie_name, value=issued.cookie_value,
        max_age=issued.max_age_seconds if issued.session.remember else None,
        httponly=True, samesite="lax", secure=runtime.settings.session_cookie_secure, path="/",
    )


def clear_session_cookie(response: Response, runtime: Runtime) -> None:
    response.delete_cookie(key=runtime.settings.session_cookie_name, path="/",
                           httponly=True, samesite="lax", secure=runtime.settings.session_cookie_secure)
