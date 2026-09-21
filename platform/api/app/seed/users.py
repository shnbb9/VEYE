"""Synthetic LOCAL demonstration accounts.

Everything here is invented. The passwords are documented in the README on
purpose: they exist only so a developer can sign in to the local stack. They
must never be used in production configuration, and the seed refuses to run
against a production environment.

Cara Hogue is the administrator fixture and owns no member record or health
history. The two members carry different, server-calculated histories.
Jordan Dual is the dual-access QA identity — a member profile AND
administrator access on one account — used only to prove that the portal a
person signs in through decides where they land. It is not Cara.
Priya Ops is a second administrator-only identity: two console accounts with
the SAME simple administrator capability (no roles), so multi-admin QA never
needs RBAC."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.assessments.repository import health_number_history, record_health_number_attempt
from app.assessments.schemas import HealthNumberAnswers
from app.auth.models import UserAccount
from app.auth.service import AuthService, SignUpInput
from app.core.config import settings
from app.core.runtime import get_runtime
from app.db.session import SessionLocal
from app.notifications.email import NoEmailProvider
from app.notifications.service import NotificationService
from app.progress.blood_markers.repository import blood_markers_history, record_blood_markers_attempt
from app.progress.blood_markers.schemas import BloodMarkersInput
from app.progress.body_composition.repository import body_composition_history, record_body_composition_attempt
from app.progress.body_composition.schemas import BodyCompositionInput
from app.progress.health_assessment.repository import health_assessment_history, record_health_assessment_attempt
from app.progress.health_assessment.schemas import HealthAssessmentInput
from app.progress.simple_quiz.repository import record_simple_quiz_attempt, simple_quiz_history
from app.progress.simple_quiz.schemas import SimpleQuizInput
from app.food.models import FoodDiaryEntry
from app.mood.models import MoodEntry
from app.requests.models import KIND_BETA, KIND_CONTACT, KIND_HELP, SOURCE_MEMBER, SOURCE_PUBLIC, STATUS_IN_PROGRESS, STATUS_NEW, STATUS_RESOLVED, MemberRequest


@dataclass(frozen=True)
class DemoAccount:
    first_name: str
    last_name: str
    email: str
    password: str
    role: str


ADMIN = DemoAccount("Cara", "Hogue", "cara.hogue@demo.veye.test", "CaraAdmin!2026-local", "admin")
ADMIN_TWO = DemoAccount("Priya", "Ops", "priya.ops@demo.veye.test", "PriyaOps!2026-local", "admin")
ADITYA = DemoAccount("Aditya", "Demo", "aditya.demo@demo.veye.test", "AdityaDemo!2026-local", "member")
MAYA = DemoAccount("Maya", "Demo", "maya.demo@demo.veye.test", "MayaDemo!2026-local", "member")
DUAL = DemoAccount("Jordan", "Dual", "jordan.dual@demo.veye.test", "JordanDual!2026-local", "member+admin")
DEMO_ACCOUNTS = (ADMIN, ADMIN_TWO, ADITYA, MAYA, DUAL)


def _guard() -> None:
    if settings.is_production:
        raise RuntimeError("The synthetic demo seed must not run against a production environment.")


def _service(db: Session) -> AuthService:
    # Seeding never sends email: accounts are created verified, silently.
    return AuthService(db, get_runtime().auth_provider, NotificationService(db, NoEmailProvider()), settings)


def _days_ago(days: int, hour: int = 9) -> datetime:
    return (datetime.now(timezone.utc) - timedelta(days=days)).replace(hour=hour, minute=0, second=0, microsecond=0)


def ensure_admin(db: Session | None = None, account: DemoAccount = ADMIN) -> UserAccount:
    _guard()
    own = db is None
    db = db or SessionLocal()
    try:
        user = _service(db).find_by_email(account.email)
        if user is None:
            user = _service(db).create_admin_account(
                first_name=account.first_name, last_name=account.last_name, email=account.email, password=account.password, synthetic=True,
            )
            db.commit()
        return user
    finally:
        if own:
            db.close()


def _ensure_member(db: Session, account: DemoAccount, *, admin_access: bool = False) -> tuple[UserAccount, bool]:
    service = _service(db)
    user = service.find_by_email(account.email)
    if user is not None:
        return user, False
    user = service.create_member_account(
        SignUpInput(first_name=account.first_name, last_name=account.last_name, email=account.email, password=account.password),
        synthetic=True, email_verified=True, admin_access=admin_access,
    )
    return user, True


def _assessment(**overrides) -> HealthAssessmentInput:
    answers = {
        "daily_performance": 1, "appetite_for_carbohydrates": 1, "appetite_suppression_between_meals": 1,
        "stool_density": 1, "sleep_quality": 1, "grogginess_upon_waking": 1, "sense_of_well_being": 1,
        "mental_concentration": 1, "fatigue": 1, "skin_quality": 1, "headaches": 1,
    }
    answers.update(overrides)
    return HealthAssessmentInput(answers=answers)


def _quiz(yes_keys: tuple[str, ...]) -> SimpleQuizInput:
    keys = ("sleepy_after_meals", "need_coffee", "crave_sweets", "overweight_10lbs", "exercise_no_tone",
            "chronic_disease", "lose_focus", "painful_arthritis")
    return SimpleQuizInput(answers={key: ("yes" if key in yes_keys else "no") for key in keys})


# Each seeded member's history is declared per tracker so the seed can BACKFILL
# a tracker that a member created by an older seed has never used (for example
# the Health Assessment and Simple Quiz, connected on 19 Sep 2026). A tracker
# that already holds rows for the member is left exactly as it is.
TRACKERS = {
    "health_number": (record_health_number_attempt, health_number_history),
    "body_composition": (record_body_composition_attempt, body_composition_history),
    "blood_markers": (record_blood_markers_attempt, blood_markers_history),
    "health_assessment": (record_health_assessment_attempt, health_assessment_history),
    "simple_quiz": (record_simple_quiz_attempt, simple_quiz_history),
}


def _aditya_history() -> dict[str, list[tuple[object, int]]]:
    return {
        # Two Health Number attempts: an earlier, higher number, then improvement.
        "health_number": [
            (HealthNumberAnswers(
                goals=["Lose Body Fat"], plans=["No other plans"], activity="Light (I work, I walk some)", meditate="no",
                tired="yes", gainWeight="yes", abdomenWeight="yes", sleepEnough="no", sleepWell="yes", sleepHours=6,
                diet="No preference", source="Friends or Family"), 45),
            (HealthNumberAnswers(
                goals=["Lose Body Fat", "Live a Healthier Lifestyle"], plans=["No other plans"],
                activity="Moderate (I exercise 1-3 times a week)", meditate="yes", tired="no", gainWeight="no",
                abdomenWeight="yes", sleepEnough="yes", sleepWell="yes", sleepHours=7, diet="No preference", source="Friends or Family"), 10),
        ],
        "body_composition": [
            (BodyCompositionInput(sex="Man", weight=178, height=70, waist=34, wrist=7), 30),
            (BodyCompositionInput(sex="Man", weight=172, height=70, waist=33, wrist=7), 6),
        ],
        "blood_markers": [
            (BloodMarkersInput(tg=150, hdl=45, insulin=9, glucose=92, aa=12, epa=3, hba1c=5.5), 40),
            (BloodMarkersInput(tg=95, hdl=60, insulin=5, glucose=85, aa=9, epa=4, hba1c=5.0), 8),
        ],
        # Health Assessment: moderate inflammation (22) improving to low (14).
        "health_assessment": [
            (_assessment(daily_performance=2, appetite_for_carbohydrates=3, appetite_suppression_between_meals=2, stool_density=2,
                         sleep_quality=2, grogginess_upon_waking=2, sense_of_well_being=2, mental_concentration=2, fatigue=3,
                         skin_quality=1, headaches=1), 35),
            (_assessment(appetite_for_carbohydrates=2, appetite_suppression_between_meals=2, grogginess_upon_waking=1, fatigue=2,
                         sleep_quality=1, daily_performance=1), 7),
        ],
        # Simple Quiz: 5 Yes then 2 Yes — fewer Yes answers means improvement.
        "simple_quiz": [
            (_quiz(("sleepy_after_meals", "need_coffee", "crave_sweets", "overweight_10lbs", "lose_focus")), 38),
            (_quiz(("need_coffee", "overweight_10lbs")), 9),
        ],
    }


def _maya_history() -> dict[str, list[tuple[object, int]]]:
    return {
        "health_number": [
            (HealthNumberAnswers(
                goals=["Prevent Future Disease"], plans=["The Mediterranean Diet"], activity="Heavy (I exercise 3x+ times per week)",
                meditate="yes", tired="no", gainWeight="no", abdomenWeight="no", sleepEnough="yes", sleepWell="no", sleepHours=7.5,
                diet="Fish and no meat", source="Instagram"), 20),
        ],
        "body_composition": [(BodyCompositionInput(sex="Woman", weight=140, height=64, abdomen=30, hips=38), 12)],
        # A reported AA/EPA ratio and an HbA1c the guidance does not define → review state.
        "blood_markers": [(BloodMarkersInput(tg=80, hdl=70, insulin=4, glucose=82, aa_epa=2.0, hba1c=4.7), 5)],
        # Maya has taken the Simple Quiz once and never the Health Assessment.
        "simple_quiz": [(_quiz(("crave_sweets",)), 4)],
    }


def _dual_history() -> dict[str, list[tuple[object, int]]]:
    # A sparse member record: one Health Number only, so the dual-access
    # identity exercises the "nothing else saved yet" states in both portals.
    return {
        "health_number": [
            (HealthNumberAnswers(
                goals=["Live a Healthier Lifestyle"], plans=["No other plans"], activity="Moderate (I exercise 1-3 times a week)",
                meditate="no", tired="no", gainWeight="no", abdomenWeight="no", sleepEnough="yes", sleepWell="yes", sleepHours=7,
                diet="No preference", source="Friends or Family"), 3),
        ],
    }


def _apply_history(db: Session, member_id, history: dict[str, list[tuple[object, int]]]) -> list[str]:
    """Adds each tracker's rows only when that tracker is empty for the member."""
    added: list[str] = []
    for tracker, entries in history.items():
        record, load = TRACKERS[tracker]
        if load(db, member_id):
            continue
        for payload, days in entries:
            record(db, member_id, payload, completed_at=_days_ago(days))
        added.append(tracker)
    return added


# ---- non-clinical journal data (Mood Tracker, Food Diary) and inbox samples ----
# Aditya: a fortnight of moods (a mixed but improving picture) and two logged
# days of meals. Maya: a couple of moods only. All invented, all synthetic.
ADITYA_MOODS = [(13, "tired"), (12, "stressed"), (11, "neutral"), (10, "tired"), (9, "calm"), (8, "happy"), (7, "neutral"),
                (6, "calm"), (5, "happy"), (4, "excited"), (3, "calm"), (2, "happy"), (1, "calm")]
MAYA_MOODS = [(2, "neutral"), (1, "happy")]
ADITYA_MEALS = [
    (1, "07:40", "Greek yoghurt with walnuts and blueberries", ["Hungry", "Relaxed"], ""),
    (1, "12:30", "Grilled chicken salad with avocado", ["Hungry", "Rushed"], "Ate at the desk"),
    (1, "19:10", "Baked salmon, broccoli and quinoa", ["Relaxed"], ""),
    (3, "08:00", "Two eggs and spinach", ["Not hungry", "Tired"], ""),
    (3, "13:00", "Lentil soup and a side salad", ["Hungry"], ""),
]
DEMO_REQUESTS = [
    # (kind, source, member account or None, name, email, subject, message, status, days ago)
    (KIND_HELP, SOURCE_PUBLIC, None, "Robert Williams", "robert.williams@demo.veye.test", "Where can I update a blood marker?",
     "I entered my triglycerides last week and the lab has corrected the value. Where do I change it?", STATUS_NEW, 1),
    (KIND_CONTACT, SOURCE_MEMBER, "maya", "", "", "Question about my assessment history",
     "Is my first Health Number kept when I retake the assessment? I want to compare them side by side.", STATUS_NEW, 0),
    (KIND_BETA, SOURCE_MEMBER, "aditya", "", "", "Beta application", "", STATUS_IN_PROGRESS, 4),
    (KIND_HELP, SOURCE_PUBLIC, None, "Lena Ortiz", "lena.ortiz@demo.veye.test", "Meal plan question",
     "Will the meal planning section suggest recipes for a pescatarian diet?", STATUS_RESOLVED, 12),
]


def _seed_journal(db: Session, member_id, moods: list[tuple[int, str]], meals: list[tuple[int, str, str, list[str], str]]) -> list[str]:
    added: list[str] = []
    if moods and not db.query(MoodEntry).filter(MoodEntry.member_id == member_id).first():
        for days, mood in moods:
            db.add(MoodEntry(member_id=member_id, entry_date=_days_ago(days).date(), mood=mood, note=""))
        added.append("mood")
    if meals and not db.query(FoodDiaryEntry).filter(FoodDiaryEntry.member_id == member_id).first():
        for days, at, what, feelings, notes in meals:
            db.add(FoodDiaryEntry(member_id=member_id, entry_date=_days_ago(days).date(), meal_time=at, description=what,
                                  feelings=feelings, notes=notes))
        added.append("food_diary")
    db.flush()
    return added


def _seed_requests(db: Session, members: dict[str, UserAccount]) -> int:
    if db.query(MemberRequest).first() is not None:
        return 0
    count = 0
    for kind, source, who, name, email, subject, message, status, days in DEMO_REQUESTS:
        user = members.get(who) if who else None
        row = MemberRequest(kind=kind, source=source, member_id=user.member_id if user else None,
                            name=user.display_name if user else name, email=user.email if user else email,
                            subject=subject, message=message, status=status, created_at=_days_ago(days, hour=10),
                            updated_at=_days_ago(days, hour=10))
        if status != STATUS_NEW:
            row.handled_by = ADMIN.first_name + " " + ADMIN.last_name
            row.handled_at = _days_ago(max(days - 1, 0), hour=15)
        if status == STATUS_RESOLVED:
            row.resolution_note = "Answered by email: Meal Planning arrives with the HOW TO release; Food Choices will hold the preference."
        db.add(row)
        count += 1
    db.flush()
    return count


def seed_users(db: Session | None = None) -> dict[str, str]:
    """Idempotent: creates whichever demo accounts are missing and their histories."""
    _guard()
    own = db is None
    db = db or SessionLocal()
    outcome: dict[str, str] = {}
    try:
        ensure_admin(db)
        outcome[ADMIN.email] = "admin"
        ensure_admin(db, ADMIN_TWO)
        outcome[ADMIN_TWO.email] = "admin"
        members: dict[str, UserAccount] = {}
        for account, history, key in ((ADITYA, _aditya_history, "aditya"), (MAYA, _maya_history, "maya"), (DUAL, _dual_history, "dual")):
            user, created = _ensure_member(db, account, admin_access=account is DUAL)
            if not created and account is DUAL and not user.admin_access:
                _service(db).grant_admin_access(user)  # older seeds predate dual access
            backfilled = _apply_history(db, user.member_id, history())
            if key == "aditya":
                backfilled += _seed_journal(db, user.member_id, ADITYA_MOODS, ADITYA_MEALS)
            elif key == "maya":
                backfilled += _seed_journal(db, user.member_id, MAYA_MOODS, [])
            members[key] = user
            outcome[account.email] = "created" if created else ("backfilled " + ", ".join(backfilled) if backfilled else "exists")
        requests = _seed_requests(db, members)
        outcome["requests"] = f"{requests} sample requests" if requests else "exists"
        db.commit()
        return outcome
    finally:
        if own:
            db.close()
