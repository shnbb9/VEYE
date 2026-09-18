"""Synthetic LOCAL demonstration accounts.

Everything here is invented. The passwords are documented in the README on
purpose: they exist only so a developer can sign in to the local stack. They
must never be used in production configuration, and the seed refuses to run
against a production environment.

Cara Hogue is the administrator fixture and owns no member record or health
history. The two members carry different, server-calculated histories."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.assessments.repository import record_health_number_attempt
from app.assessments.schemas import HealthNumberAnswers
from app.auth.models import UserAccount
from app.auth.service import AuthService, SignUpInput
from app.core.config import settings
from app.core.runtime import get_runtime
from app.db.session import SessionLocal
from app.notifications.email import NoEmailProvider
from app.notifications.service import NotificationService
from app.progress.blood_markers.repository import record_blood_markers_attempt
from app.progress.blood_markers.schemas import BloodMarkersInput
from app.progress.body_composition.repository import record_body_composition_attempt
from app.progress.body_composition.schemas import BodyCompositionInput


@dataclass(frozen=True)
class DemoAccount:
    first_name: str
    last_name: str
    email: str
    password: str
    role: str


ADMIN = DemoAccount("Cara", "Hogue", "cara.hogue@demo.veye.test", "CaraAdmin!2026-local", "admin")
ADITYA = DemoAccount("Aditya", "Demo", "aditya.demo@demo.veye.test", "AdityaDemo!2026-local", "member")
MAYA = DemoAccount("Maya", "Demo", "maya.demo@demo.veye.test", "MayaDemo!2026-local", "member")
DEMO_ACCOUNTS = (ADMIN, ADITYA, MAYA)


def _guard() -> None:
    if settings.is_production:
        raise RuntimeError("The synthetic demo seed must not run against a production environment.")


def _service(db: Session) -> AuthService:
    # Seeding never sends email: accounts are created verified, silently.
    return AuthService(db, get_runtime().auth_provider, NotificationService(db, NoEmailProvider()), settings)


def _days_ago(days: int, hour: int = 9) -> datetime:
    return (datetime.now(timezone.utc) - timedelta(days=days)).replace(hour=hour, minute=0, second=0, microsecond=0)


def ensure_admin(db: Session | None = None) -> UserAccount:
    _guard()
    own = db is None
    db = db or SessionLocal()
    try:
        user = _service(db).find_by_email(ADMIN.email)
        if user is None:
            user = _service(db).create_admin_account(
                first_name=ADMIN.first_name, last_name=ADMIN.last_name, email=ADMIN.email, password=ADMIN.password, synthetic=True,
            )
            db.commit()
        return user
    finally:
        if own:
            db.close()


def _ensure_member(db: Session, account: DemoAccount) -> tuple[UserAccount, bool]:
    service = _service(db)
    user = service.find_by_email(account.email)
    if user is not None:
        return user, False
    user = service.create_member_account(
        SignUpInput(first_name=account.first_name, last_name=account.last_name, email=account.email, password=account.password),
        synthetic=True, email_verified=True,
    )
    return user, True


def _aditya_history(db: Session, member_id) -> None:
    # Two Health Number attempts: an earlier, higher number, then improvement.
    record_health_number_attempt(db, member_id, HealthNumberAnswers(
        goals=["Lose Body Fat"], plans=["No other plans"], activity="Light (I work, I walk some)", meditate="no",
        tired="yes", gainWeight="yes", abdomenWeight="yes", sleepEnough="no", sleepWell="yes", sleepHours=6,
        diet="No preference", source="Friends or Family",
    ), completed_at=_days_ago(45))
    record_health_number_attempt(db, member_id, HealthNumberAnswers(
        goals=["Lose Body Fat", "Live a Healthier Lifestyle"], plans=["No other plans"],
        activity="Moderate (I exercise 1-3 times a week)", meditate="yes", tired="no", gainWeight="no",
        abdomenWeight="yes", sleepEnough="yes", sleepWell="yes", sleepHours=7, diet="No preference", source="Friends or Family",
    ), completed_at=_days_ago(10))
    record_body_composition_attempt(db, member_id, BodyCompositionInput(sex="Man", weight=178, height=70, waist=34, wrist=7),
                                    completed_at=_days_ago(30))
    record_body_composition_attempt(db, member_id, BodyCompositionInput(sex="Man", weight=172, height=70, waist=33, wrist=7),
                                    completed_at=_days_ago(6))
    record_blood_markers_attempt(db, member_id, BloodMarkersInput(tg=150, hdl=45, insulin=9, glucose=92, aa=12, epa=3, hba1c=5.5),
                                 completed_at=_days_ago(40))
    record_blood_markers_attempt(db, member_id, BloodMarkersInput(tg=95, hdl=60, insulin=5, glucose=85, aa=9, epa=4, hba1c=5.0),
                                 completed_at=_days_ago(8))


def _maya_history(db: Session, member_id) -> None:
    record_health_number_attempt(db, member_id, HealthNumberAnswers(
        goals=["Prevent Future Disease"], plans=["The Mediterranean Diet"], activity="Heavy (I exercise 3x+ times per week)",
        meditate="yes", tired="no", gainWeight="no", abdomenWeight="no", sleepEnough="yes", sleepWell="no", sleepHours=7.5,
        diet="Fish and no meat", source="Instagram",
    ), completed_at=_days_ago(20))
    record_body_composition_attempt(db, member_id, BodyCompositionInput(sex="Woman", weight=140, height=64, abdomen=30, hips=38),
                                    completed_at=_days_ago(12))
    # A reported AA/EPA ratio and an HbA1c the guidance does not define → review state.
    record_blood_markers_attempt(db, member_id, BloodMarkersInput(tg=80, hdl=70, insulin=4, glucose=82, aa_epa=2.0, hba1c=4.7),
                                 completed_at=_days_ago(5))


def seed_users(db: Session | None = None) -> dict[str, str]:
    """Idempotent: creates whichever demo accounts are missing and their histories."""
    _guard()
    own = db is None
    db = db or SessionLocal()
    outcome: dict[str, str] = {}
    try:
        ensure_admin(db)
        outcome[ADMIN.email] = "admin"
        for account, history in ((ADITYA, _aditya_history), (MAYA, _maya_history)):
            user, created = _ensure_member(db, account)
            if created:
                history(db, user.member_id)
            outcome[account.email] = "created" if created else "exists"
        db.commit()
        return outcome
    finally:
        if own:
            db.close()
