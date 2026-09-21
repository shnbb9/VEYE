from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from app.assessments.repository import record_health_number_attempt
from app.auth.dependencies import clear_session_cookie, get_auth_service, get_notification_service, set_session_cookie
from app.auth.models import UserAccount
from app.auth.principal import (
    PORTAL_ADMIN,
    PORTAL_MEMBER,
    CurrentPrincipal,
    get_admin_principal,
    get_current_principal,
    get_member_principal,
)
from app.auth.schemas import (
    AccountOut,
    DeliveryOut,
    ForgotPasswordRequest,
    ForgotPasswordResponse,
    NotificationPreferencesOut,
    NotificationPreferenceUpdate,
    OkResponse,
    PortalSessionsResponse,
    ResetPasswordRequest,
    SessionResponse,
    SignInRequest,
    SignUpRequest,
    SignUpResponse,
    TokenRequest,
)
from app.auth.service import AuthError, AuthService, SignUpInput
from app.members.service import photo_version
from app.core.runtime import Runtime, get_runtime
from app.db.session import get_db
from app.notifications.service import NotificationService

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


def account_out(user: UserAccount, portal: str | None = None) -> AccountOut:
    return AccountOut(
        id=user.id, email=user.email, role=user.role, first_name=user.first_name, last_name=user.last_name,
        member_id=user.member_id, member_access=user.member_access, admin_access=user.admin_access, portal=portal,
        email_verified=user.email_verified_at is not None, is_synthetic=user.is_synthetic, created_at=user.created_at,
        phone=user.phone, postal_code=user.postal_code, photo_version=photo_version(user),
    )


def _raise(exc: AuthError) -> None:
    raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.post("/sign-up", response_model=SignUpResponse, status_code=status.HTTP_201_CREATED)
def sign_up(
    payload: SignUpRequest, response: Response, db: Session = Depends(get_db),
    auth: AuthService = Depends(get_auth_service), runtime: Runtime = Depends(get_runtime),
) -> SignUpResponse:
    if payload.confirm_password is not None and payload.confirm_password != payload.password:
        raise HTTPException(status_code=422, detail="The two passwords do not match.")
    try:
        user, issued, deliveries = auth.sign_up(
            SignUpInput(first_name=payload.first_name, last_name=payload.last_name, email=payload.email,
                        password=payload.password, phone=payload.phone, postal_code=payload.postal_code),
            remember=payload.remember,
        )
    except AuthError as exc:
        _raise(exc)
    attempt_id = None
    if payload.health_number_answers is not None:
        attempt, _ = record_health_number_attempt(db, user.member_id, payload.health_number_answers)
        attempt_id = attempt.id
    db.commit()
    db.refresh(user)
    set_session_cookie(response, issued, runtime)
    return SignUpResponse(account=account_out(user, PORTAL_MEMBER), deliveries=[DeliveryOut(**d.__dict__) for d in deliveries],
                          health_number_attempt_id=attempt_id)


def _portal_sign_in(portal: str, payload: SignInRequest, response: Response, db: Session, auth: AuthService,
                    runtime: Runtime) -> SessionResponse:
    try:
        user, issued = auth.sign_in(payload.email, payload.password, portal=portal, remember=payload.remember)
    except AuthError as exc:
        _raise(exc)
    db.commit()
    set_session_cookie(response, issued, runtime)
    return SessionResponse(account=account_out(user, portal))


@router.post("/sign-in", response_model=SessionResponse)
def sign_in(
    payload: SignInRequest, response: Response, db: Session = Depends(get_db),
    auth: AuthService = Depends(get_auth_service), runtime: Runtime = Depends(get_runtime),
) -> SessionResponse:
    """MEMBER portal sign-in (/login). The account must own a member profile;
    administrator access neither helps nor redirects here."""
    return _portal_sign_in(PORTAL_MEMBER, payload, response, db, auth, runtime)


@router.post("/admin/sign-in", response_model=SessionResponse)
def admin_sign_in(
    payload: SignInRequest, response: Response, db: Session = Depends(get_db),
    auth: AuthService = Depends(get_auth_service), runtime: Runtime = Depends(get_runtime),
) -> SessionResponse:
    """ADMIN portal sign-in (/admin/login). Same password check, then
    administrator access is required. Issues the admin cookie only."""
    return _portal_sign_in(PORTAL_ADMIN, payload, response, db, auth, runtime)


@router.post("/sign-out", status_code=status.HTTP_204_NO_CONTENT)
def sign_out(
    response: Response, principal: CurrentPrincipal | None = Depends(get_member_principal), db: Session = Depends(get_db),
    auth: AuthService = Depends(get_auth_service), runtime: Runtime = Depends(get_runtime),
) -> Response:
    """Ends the MEMBER portal session only; an admin session in the same
    browser stays signed in. Signing out when already out is not an error."""
    if principal is not None:
        auth.sign_out(principal.session_id)
        db.commit()
    clear_session_cookie(response, runtime, PORTAL_MEMBER)
    response.status_code = status.HTTP_204_NO_CONTENT
    return response


@router.post("/admin/sign-out", status_code=status.HTTP_204_NO_CONTENT)
def admin_sign_out(
    response: Response, principal: CurrentPrincipal | None = Depends(get_admin_principal), db: Session = Depends(get_db),
    auth: AuthService = Depends(get_auth_service), runtime: Runtime = Depends(get_runtime),
) -> Response:
    """Ends the ADMIN portal session only; a member session stays signed in."""
    if principal is not None:
        auth.sign_out(principal.session_id)
        db.commit()
    clear_session_cookie(response, runtime, PORTAL_ADMIN)
    response.status_code = status.HTTP_204_NO_CONTENT
    return response


@router.get("/me", response_model=PortalSessionsResponse)
def me(
    member_principal: CurrentPrincipal | None = Depends(get_member_principal),
    admin_principal: CurrentPrincipal | None = Depends(get_admin_principal),
    db: Session = Depends(get_db),
) -> PortalSessionsResponse:
    """Who is signed in, per portal. Anonymous is a normal answer (null), not
    an error, so the browser's session check never logs a failed request."""
    member = admin = None
    if member_principal is not None:
        user = db.get(UserAccount, member_principal.user_id)
        member = account_out(user, PORTAL_MEMBER) if user is not None else None
    if admin_principal is not None:
        user = db.get(UserAccount, admin_principal.user_id)
        admin = account_out(user, PORTAL_ADMIN) if user is not None else None
    db.commit()  # persists last_seen_at
    return PortalSessionsResponse(member=member, admin=admin)


@router.post("/verify-email", response_model=SessionResponse)
def verify_email(payload: TokenRequest, db: Session = Depends(get_db), auth: AuthService = Depends(get_auth_service)) -> SessionResponse:
    try:
        user = auth.verify_email(payload.token)
    except AuthError as exc:
        _raise(exc)
    db.commit()
    return SessionResponse(account=account_out(user))


@router.post("/resend-verification", response_model=DeliveryOut)
def resend_verification(
    principal: CurrentPrincipal = Depends(get_current_principal), db: Session = Depends(get_db),
    auth: AuthService = Depends(get_auth_service),
) -> DeliveryOut:
    user = db.get(UserAccount, principal.user_id)
    if user is None:
        raise HTTPException(status_code=401, detail="Please sign in to continue.")
    if user.email_verified_at is not None:
        raise HTTPException(status_code=409, detail="This email address is already verified.")
    delivery = auth.send_verification(user)
    db.commit()
    return DeliveryOut(**delivery.__dict__)


@router.post("/forgot-password", response_model=ForgotPasswordResponse, status_code=status.HTTP_202_ACCEPTED)
def forgot_password(
    payload: ForgotPasswordRequest, db: Session = Depends(get_db), auth: AuthService = Depends(get_auth_service),
    runtime: Runtime = Depends(get_runtime),
) -> ForgotPasswordResponse:
    delivery = auth.request_password_reset(payload.email, portal=payload.portal)
    db.commit()
    message = "If an account exists for that address, a password-reset link has been sent."
    exposed = None
    if delivery is not None and not runtime.settings.is_production:
        exposed = DeliveryOut(**delivery.__dict__)
    return ForgotPasswordResponse(accepted=True, message=message, delivery=exposed)


@router.post("/reset-password", response_model=OkResponse)
def reset_password(payload: ResetPasswordRequest, db: Session = Depends(get_db), auth: AuthService = Depends(get_auth_service)) -> OkResponse:
    try:
        auth.reset_password(payload.token, payload.password)
    except AuthError as exc:
        _raise(exc)
    db.commit()
    return OkResponse(ok=True, message="Your password has been changed. Sign in with your new password.")


@router.get("/notification-preferences", response_model=NotificationPreferencesOut)
def notification_preferences(
    principal: CurrentPrincipal = Depends(get_current_principal),
    notifications: NotificationService = Depends(get_notification_service),
) -> NotificationPreferencesOut:
    return NotificationPreferencesOut(preferences=notifications.preferences(principal.user_id))


@router.put("/notification-preferences", response_model=NotificationPreferencesOut)
def update_notification_preference(
    payload: NotificationPreferenceUpdate, principal: CurrentPrincipal = Depends(get_current_principal),
    db: Session = Depends(get_db), notifications: NotificationService = Depends(get_notification_service),
) -> NotificationPreferencesOut:
    try:
        notifications.set_preference(principal.user_id, payload.kind, payload.email_enabled)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    db.commit()
    return NotificationPreferencesOut(preferences=notifications.preferences(principal.user_id))
