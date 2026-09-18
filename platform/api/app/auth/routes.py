from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from app.assessments.repository import record_health_number_attempt
from app.auth.dependencies import clear_session_cookie, get_auth_service, get_notification_service, set_session_cookie
from app.auth.models import UserAccount
from app.auth.principal import CurrentPrincipal, get_current_principal, get_optional_principal
from app.auth.schemas import (
    AccountOut,
    DeliveryOut,
    ForgotPasswordRequest,
    ForgotPasswordResponse,
    NotificationPreferencesOut,
    NotificationPreferenceUpdate,
    OkResponse,
    OptionalSessionResponse,
    ResetPasswordRequest,
    SessionResponse,
    SignInRequest,
    SignUpRequest,
    SignUpResponse,
    TokenRequest,
)
from app.auth.service import AuthError, AuthService, SignUpInput
from app.core.runtime import Runtime, get_runtime
from app.db.session import get_db
from app.notifications.service import NotificationService

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


def account_out(user: UserAccount) -> AccountOut:
    return AccountOut(
        id=user.id, email=user.email, role=user.role, first_name=user.first_name, last_name=user.last_name,
        member_id=user.member_id, email_verified=user.email_verified_at is not None, is_synthetic=user.is_synthetic,
        created_at=user.created_at,
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
    return SignUpResponse(account=account_out(user), deliveries=[DeliveryOut(**d.__dict__) for d in deliveries],
                          health_number_attempt_id=attempt_id)


@router.post("/sign-in", response_model=SessionResponse)
def sign_in(
    payload: SignInRequest, response: Response, db: Session = Depends(get_db),
    auth: AuthService = Depends(get_auth_service), runtime: Runtime = Depends(get_runtime),
) -> SessionResponse:
    try:
        user, issued = auth.sign_in(payload.email, payload.password, remember=payload.remember)
    except AuthError as exc:
        _raise(exc)
    db.commit()
    set_session_cookie(response, issued, runtime)
    return SessionResponse(account=account_out(user))


@router.post("/sign-out", status_code=status.HTTP_204_NO_CONTENT)
def sign_out(
    response: Response, principal: CurrentPrincipal = Depends(get_current_principal), db: Session = Depends(get_db),
    auth: AuthService = Depends(get_auth_service), runtime: Runtime = Depends(get_runtime),
) -> Response:
    auth.sign_out(principal.session_id)
    db.commit()
    clear_session_cookie(response, runtime)
    response.status_code = status.HTTP_204_NO_CONTENT
    return response


@router.get("/me", response_model=OptionalSessionResponse)
def me(principal: CurrentPrincipal | None = Depends(get_optional_principal), db: Session = Depends(get_db)) -> OptionalSessionResponse:
    """Who is signed in. Anonymous is a normal answer (account: null), not an
    error, so the browser's session check never logs a failed request."""
    if principal is None:
        return OptionalSessionResponse(account=None)
    user = db.get(UserAccount, principal.user_id)
    if user is None:
        return OptionalSessionResponse(account=None)
    db.commit()  # persists last_seen_at
    return OptionalSessionResponse(account=account_out(user))


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
    delivery = auth.request_password_reset(payload.email)
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
