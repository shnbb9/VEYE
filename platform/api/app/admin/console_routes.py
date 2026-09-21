"""Production admin console: Home overview, Members, Member 360, Assessments
and Insights — every figure a PostgreSQL aggregate of the real (local,
synthetic) data. Nothing here is invented: no revenue, no growth
percentages, no clinical conclusions. Historical calculated results are
read-only; the console shows them exactly as the member's records hold them."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.assessments.models import HealthNumberAttempt
from app.assessments.routes import history_item as health_number_item
from app.assessments.schemas import HealthNumberHistoryItem
from app.assessments.service import CALCULATION_VERSION as HEALTH_NUMBER_VERSION
from app.auth.models import AuthSession, UserAccount
from app.auth.principal import require_admin
from app.companion.models import CompanionConversation, CompanionFeedback, CompanionMessage
from app.core.runtime import Runtime, get_runtime
from app.db.session import get_db
from app.food.models import FoodDiaryEntry
from app.food.routes import MealOut, meal_out
from app.guided_flows.models import GuidedFlow, MemberGuidedFlowSession
from app.members.models import Member
from app.members.service import MemberProfileService, ProfileError, photo_version
from app.mood.models import MoodEntry
from app.mood.schemas import MoodEntryOut, MoodStats
from app.mood.service import compute_stats, entry_out as mood_entry_out
from app.requests.models import STATUS_IN_PROGRESS, STATUS_NEW, MemberRequest
from app.requests.schemas import RequestOut
from app.requests.service import request_out
from app.progress.blood_markers.models import BloodMarkerAttempt
from app.progress.blood_markers.routes import history_item as blood_markers_item
from app.progress.blood_markers.schemas import BloodMarkersHistoryItem
from app.progress.blood_markers.service import BLOOD_MARKERS_CALCULATION_VERSION
from app.progress.body_composition.models import BodyCompositionAttempt
from app.progress.body_composition.routes import history_item as body_composition_item
from app.progress.body_composition.schemas import BodyCompositionHistoryItem
from app.progress.body_composition.service import BODY_COMPOSITION_CALCULATION_VERSION
from app.progress.health_assessment.models import HealthAssessmentAttempt
from app.progress.health_assessment.routes import history_item as health_assessment_item
from app.progress.health_assessment.schemas import HealthAssessmentHistoryItem
from app.progress.health_assessment.service import HEALTH_ASSESSMENT_CALCULATION_VERSION
from app.progress.simple_quiz.models import SimpleQuizAttempt
from app.progress.simple_quiz.routes import history_item as simple_quiz_item
from app.progress.simple_quiz.schemas import SimpleQuizHistoryItem
from app.progress.simple_quiz.service import SIMPLE_QUIZ_CALCULATION_VERSION

router = APIRouter(prefix="/api/v1/admin", tags=["admin-console"], dependencies=[Depends(require_admin)])

# The five instruments, their tables and pinned calculation versions. The
# calculation logic itself is system managed: nothing here edits a weight.
INSTRUMENTS = {
    "health_number": ("Health Number", HealthNumberAttempt, HEALTH_NUMBER_VERSION,
                      "12 questions; 1–10, lower is better; four bands. Onboarding and the dedicated My Progress assessment."),
    "body_composition": ("Body Composition", BodyCompositionAttempt, BODY_COMPOSITION_CALCULATION_VERSION,
                         "Standard BMI plus the client's body-fat tables (female constants, male lookup). Unsupported combinations report not available."),
    "blood_markers": ("Blood Markers", BloodMarkerAttempt, BLOOD_MARKERS_CALCULATION_VERSION,
                      "TG/HDL, HOMA-IR, AA/EPA and HbA1c with goal flags; supplement suggestion by the client's table."),
    "health_assessment": ("Health Assessment", HealthAssessmentAttempt, HEALTH_ASSESSMENT_CALCULATION_VERSION,
                          "11 questions scoring 1–3; total 11–33, lower is better; six bands; EPA/DHA suggestion by score."),
    "simple_quiz": ("Simple Quiz", SimpleQuizAttempt, SIMPLE_QUIZ_CALCULATION_VERSION,
                    "8 yes/no questions; a dated count. Never creates or changes a Health Number."),
}
InstrumentKey = Literal["health_number", "body_composition", "blood_markers", "health_assessment", "simple_quiz"]


# ---------------------------------------------------------------- schemas
class TrackerCounts(BaseModel):
    health_number: int
    body_composition: int
    blood_markers: int
    health_assessment: int
    simple_quiz: int


class RecentMember(BaseModel):
    member_id: UUID
    name: str
    email: str
    joined_at: datetime
    email_verified: bool
    is_synthetic: bool


class ActivityRow(BaseModel):
    at: datetime
    member_id: UUID
    member_name: str
    kind: str          # health_number | body_composition | blood_markers | health_assessment | simple_quiz | companion | guided_flow
    summary: str


class OverviewOut(BaseModel):
    members_total: int
    members_verified: int
    members_new_last_7_days: int
    members_new_last_30_days: int
    members_active_last_7_days: int
    completions: TrackerCounts                 # attempts saved (all time)
    members_completed: TrackerCounts           # distinct members with at least one attempt
    guided_sessions_total: int
    guided_sessions_in_progress: int
    guided_sessions_completed: int
    companion_conversations_total: int
    companion_conversations_last_7_days: int
    companion_feedback_unreviewed: int
    requests_open: int
    requests_new: int
    requests_in_progress: int
    mood_entries_total: int
    food_diary_entries_total: int
    recent_members: list[RecentMember]
    recent_activity: list[ActivityRow]
    generated_at: datetime


class MemberRow(BaseModel):
    member_id: UUID
    account_id: UUID
    name: str
    email: str
    initials: str
    joined_at: datetime
    email_verified: bool
    is_active: bool
    is_synthetic: bool
    admin_access: bool
    health_number: float | None
    health_number_status: str | None
    health_number_at: datetime | None
    trackers_completed: int
    last_active_at: datetime | None
    onboarding: str  # Complete | Not started
    has_photo: bool = False
    photo_version: str | None = None


class MembersPage(BaseModel):
    rows: list[MemberRow]
    total: int
    page: int
    page_size: int


class GuidedSessionOut(BaseModel):
    flow_key: str
    flow_title: str
    flow_version: int
    status: str
    current_node: str
    started_at: datetime
    updated_at: datetime
    completed_at: datetime | None


class ConversationRow(BaseModel):
    id: UUID
    started_at: datetime
    last_message_at: datetime
    message_count: int
    flagged: bool
    reviewed_at: datetime | None


class Member360Out(BaseModel):
    profile: MemberRow
    phone: str | None
    postal_code: str | None
    health_number: list[HealthNumberHistoryItem]
    body_composition: list[BodyCompositionHistoryItem]
    blood_markers: list[BloodMarkersHistoryItem]
    health_assessment: list[HealthAssessmentHistoryItem]
    simple_quiz: list[SimpleQuizHistoryItem]
    guided_sessions: list[GuidedSessionOut]
    conversations: list[ConversationRow]
    mood_entries: list[MoodEntryOut]
    mood_stats: MoodStats
    food_diary: list[MealOut]
    food_diary_days: int
    requests: list[RequestOut]
    not_connected: list[str]


class InstrumentOut(BaseModel):
    key: str
    name: str
    description: str
    calculation_version: str
    calculation_owner: str
    attempts_total: int
    members_scored: int
    last_completed_at: datetime | None


class AttemptRow(BaseModel):
    attempt_id: UUID
    member_id: UUID
    member_name: str
    member_email: str
    completed_at: datetime
    calculation_version: str
    result: str
    detail: dict


class AttemptsPage(BaseModel):
    instrument: InstrumentOut
    rows: list[AttemptRow]
    total: int
    page: int
    page_size: int


class MonthCount(BaseModel):
    month: str  # YYYY-MM
    count: int


class GuidedFlowInsight(BaseModel):
    flow_key: str
    flow_title: str
    started: int
    in_progress: int
    paused: int
    completed: int
    skipped: int


class InsightsOut(BaseModel):
    members_total: int
    members_by_month: list[MonthCount]
    attempts: TrackerCounts
    members_completed: TrackerCounts
    attempts_by_month: dict[str, list[MonthCount]]
    guided_flows: list[GuidedFlowInsight]
    companion_conversations: int
    companion_messages: int
    companion_feedback_helpful: int
    companion_feedback_not_helpful: int
    requests_by_kind: dict[str, int]
    requests_by_status: dict[str, int]
    requests_by_month: list[MonthCount]
    mood_entries: int
    mood_members: int
    food_diary_entries: int
    food_diary_members: int
    generated_at: datetime


# ---------------------------------------------------------------- helpers
def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)


def _count(db: Session, model) -> int:
    return db.query(func.count(model.id)).scalar() or 0


def _distinct_members(db: Session, model) -> int:
    return db.query(func.count(func.distinct(model.member_id))).scalar() or 0


def _tracker_counts(db: Session, distinct: bool) -> TrackerCounts:
    fn = _distinct_members if distinct else _count
    return TrackerCounts(
        health_number=fn(db, HealthNumberAttempt), body_composition=fn(db, BodyCompositionAttempt),
        blood_markers=fn(db, BloodMarkerAttempt), health_assessment=fn(db, HealthAssessmentAttempt),
        simple_quiz=fn(db, SimpleQuizAttempt),
    )


def _member_accounts(db: Session) -> list[tuple[Member, UserAccount]]:
    rows = (db.query(Member, UserAccount).join(UserAccount, UserAccount.member_id == Member.id)
            .order_by(Member.created_at.desc()).all())
    return [(member, user) for member, user in rows]


def _initials(user: UserAccount) -> str:
    return f"{(user.first_name or ' ')[0]}{(user.last_name or ' ')[0]}".strip().upper() or "M"


def _latest_per_member(db: Session, model, column="completed_at") -> dict[UUID, datetime]:
    rows = db.query(model.member_id, func.max(getattr(model, column))).group_by(model.member_id).all()
    return {member_id: _aware(at) for member_id, at in rows}


def _member_rows(db: Session) -> list[MemberRow]:
    latest_hn: dict[UUID, HealthNumberAttempt] = {}
    for attempt in db.query(HealthNumberAttempt).order_by(HealthNumberAttempt.completed_at.desc()).all():
        latest_hn.setdefault(attempt.member_id, attempt)
    tracker_latest = [_latest_per_member(db, model) for model in
                      (HealthNumberAttempt, BodyCompositionAttempt, BloodMarkerAttempt, HealthAssessmentAttempt, SimpleQuizAttempt)]
    conversations = _latest_per_member(db, CompanionConversation, "last_message_at")
    sessions = {user_id: _aware(at) for user_id, at in
                db.query(AuthSession.user_id, func.max(AuthSession.last_seen_at)).group_by(AuthSession.user_id).all()}

    rows: list[MemberRow] = []
    for member, user in _member_accounts(db):
        hn = latest_hn.get(member.id)
        candidates = [d.get(member.id) for d in tracker_latest] + [conversations.get(member.id), sessions.get(user.id)]
        candidates = [c for c in candidates if c is not None]
        rows.append(MemberRow(
            member_id=member.id, account_id=user.id, name=user.display_name, email=user.email, initials=_initials(user),
            joined_at=_aware(member.created_at), email_verified=user.email_verified_at is not None, is_active=user.is_active,
            is_synthetic=user.is_synthetic, admin_access=user.admin_access,
            health_number=float(hn.displayed_score) if hn else None, health_number_status=hn.status if hn else None,
            health_number_at=_aware(hn.completed_at) if hn else None,
            trackers_completed=sum(1 for d in tracker_latest if member.id in d),
            last_active_at=max(candidates) if candidates else None,
            onboarding="Complete" if hn else "Not started",
            has_photo=bool(user.photo_object_key), photo_version=photo_version(user),
        ))
    return rows


def _member_or_404(db: Session, member_id: UUID) -> tuple[Member, UserAccount]:
    member = db.get(Member, member_id)
    user = db.query(UserAccount).filter(UserAccount.member_id == member_id).one_or_none() if member else None
    if member is None or user is None:
        raise HTTPException(status_code=404, detail="That member was not found.")
    return member, user


def _month(value: datetime) -> str:
    value = _aware(value)
    return f"{value.year:04d}-{value.month:02d}"


def _by_month(values: list[datetime], months: int = 12) -> list[MonthCount]:
    now = _now()
    keys = []
    year, month = now.year, now.month
    for _ in range(months):
        keys.append(f"{year:04d}-{month:02d}")
        month -= 1
        if month == 0:
            month, year = 12, year - 1
    keys.reverse()
    counts = {key: 0 for key in keys}
    for value in values:
        key = _month(value)
        if key in counts:
            counts[key] += 1
    return [MonthCount(month=key, count=counts[key]) for key in keys]


def _attempt_result(kind: str, attempt) -> tuple[str, dict]:
    if kind == "health_number":
        return f"{attempt.displayed_score} · {attempt.status}", {"bucket": attempt.bucket, "category": attempt.category}
    if kind == "body_composition":
        bmi = f"BMI {attempt.bmi}" if attempt.bmi is not None else "BMI —"
        fat = f"{attempt.body_fat_percent}% body fat" if attempt.body_fat_percent is not None else "body fat not available"
        return f"{bmi} · {fat}", {"sex": attempt.sex, "unavailable_reason": attempt.unavailable_reason}
    if kind == "blood_markers":
        flags = attempt.results.get("in_range", {})
        known = [v for v in flags.values() if v is not None]
        return f"{sum(1 for v in known if v)} of {len(known)} in range", {"in_range": flags, "recommendation": attempt.results.get("recommendation")}
    if kind == "health_assessment":
        return f"{attempt.total} / 33 · {attempt.status}", {"bucket": attempt.bucket, "epa_dha_dose": attempt.epa_dha_dose}
    return f"{attempt.no_count} No / {attempt.yes_count} Yes", {"yes_count": attempt.yes_count, "no_count": attempt.no_count}


# ---------------------------------------------------------------- routes
@router.get("/overview", response_model=OverviewOut)
def overview(db: Session = Depends(get_db)) -> OverviewOut:
    now = _now()
    week = now - timedelta(days=7)
    month = now - timedelta(days=30)
    rows = _member_rows(db)
    names = {row.member_id: row.name for row in rows}

    activity: list[ActivityRow] = []
    for kind, model in (("health_number", HealthNumberAttempt), ("body_composition", BodyCompositionAttempt),
                        ("blood_markers", BloodMarkerAttempt), ("health_assessment", HealthAssessmentAttempt),
                        ("simple_quiz", SimpleQuizAttempt)):
        for attempt in db.query(model).order_by(model.completed_at.desc()).limit(12).all():
            result, _ = _attempt_result(kind, attempt)
            activity.append(ActivityRow(at=_aware(attempt.completed_at), member_id=attempt.member_id,
                                        member_name=names.get(attempt.member_id, "Member"), kind=kind, summary=result))
    for conversation in db.query(CompanionConversation).order_by(CompanionConversation.last_message_at.desc()).limit(12).all():
        activity.append(ActivityRow(at=_aware(conversation.last_message_at), member_id=conversation.member_id,
                                    member_name=names.get(conversation.member_id, "Member"), kind="companion",
                                    summary=f"Sprout conversation · {conversation.message_count} messages"))
    titles = {flow.key: flow.title for flow in db.query(GuidedFlow).all()}
    for session in db.query(MemberGuidedFlowSession).order_by(MemberGuidedFlowSession.updated_at.desc()).limit(12).all():
        activity.append(ActivityRow(at=_aware(session.updated_at), member_id=session.member_id,
                                    member_name=names.get(session.member_id, "Member"), kind="guided_flow",
                                    summary=f"{titles.get(session.flow_key, session.flow_key)} · {session.status.replace('_', ' ')}"))
    for req in db.query(MemberRequest).order_by(MemberRequest.created_at.desc()).limit(12).all():
        activity.append(ActivityRow(at=_aware(req.created_at), member_id=req.member_id or UUID(int=0),
                                    member_name=req.name or names.get(req.member_id, "Visitor"), kind="request",
                                    summary=f"{request_out(req).kind_label} · {req.subject or req.message[:60]}"))
    activity.sort(key=lambda row: row.at, reverse=True)

    return OverviewOut(
        members_total=len(rows), members_verified=sum(1 for r in rows if r.email_verified),
        members_new_last_7_days=sum(1 for r in rows if r.joined_at >= week),
        members_new_last_30_days=sum(1 for r in rows if r.joined_at >= month),
        members_active_last_7_days=sum(1 for r in rows if r.last_active_at and r.last_active_at >= week),
        completions=_tracker_counts(db, distinct=False), members_completed=_tracker_counts(db, distinct=True),
        guided_sessions_total=_count(db, MemberGuidedFlowSession),
        guided_sessions_in_progress=db.query(func.count(MemberGuidedFlowSession.id)).filter(MemberGuidedFlowSession.status.in_(("in_progress", "paused"))).scalar() or 0,
        guided_sessions_completed=db.query(func.count(MemberGuidedFlowSession.id)).filter(MemberGuidedFlowSession.status == "completed").scalar() or 0,
        companion_conversations_total=_count(db, CompanionConversation),
        companion_conversations_last_7_days=db.query(func.count(CompanionConversation.id)).filter(CompanionConversation.last_message_at >= week).scalar() or 0,
        companion_feedback_unreviewed=db.query(func.count(CompanionFeedback.id)).filter(CompanionFeedback.reviewed_at.is_(None)).scalar() or 0,
        requests_open=db.query(func.count(MemberRequest.id)).filter(MemberRequest.status.in_((STATUS_NEW, STATUS_IN_PROGRESS))).scalar() or 0,
        requests_new=db.query(func.count(MemberRequest.id)).filter(MemberRequest.status == STATUS_NEW).scalar() or 0,
        requests_in_progress=db.query(func.count(MemberRequest.id)).filter(MemberRequest.status == STATUS_IN_PROGRESS).scalar() or 0,
        mood_entries_total=_count(db, MoodEntry), food_diary_entries_total=_count(db, FoodDiaryEntry),
        recent_members=[RecentMember(member_id=r.member_id, name=r.name, email=r.email, joined_at=r.joined_at,
                                     email_verified=r.email_verified, is_synthetic=r.is_synthetic) for r in rows[:6]],
        recent_activity=activity[:15], generated_at=now,
    )


@router.get("/members", response_model=MembersPage)
def members(
    q: str = Query(default="", max_length=120),
    status: Literal["any", "active", "inactive", "unverified"] = Query(default="any"),
    onboarding: Literal["any", "complete", "not_started"] = Query(default="any"),
    active: Literal["any", "week", "month", "longer", "never"] = Query(default="any"),
    sort: Literal["name", "joined", "health_number", "last_active"] = Query(default="name"),
    direction: Literal["asc", "desc"] = Query(default="asc"),
    page: int = Query(default=1, ge=1), page_size: int = Query(default=25, ge=1, le=100),
    db: Session = Depends(get_db),
) -> MembersPage:
    rows = _member_rows(db)
    needle = q.strip().lower()
    now = _now()
    if needle:
        rows = [r for r in rows if needle in r.name.lower() or needle in r.email.lower() or needle in str(r.member_id)]
    if status == "active":
        rows = [r for r in rows if r.is_active]
    elif status == "inactive":
        rows = [r for r in rows if not r.is_active]
    elif status == "unverified":
        rows = [r for r in rows if not r.email_verified]
    if onboarding == "complete":
        rows = [r for r in rows if r.onboarding == "Complete"]
    elif onboarding == "not_started":
        rows = [r for r in rows if r.onboarding != "Complete"]
    if active == "week":
        rows = [r for r in rows if r.last_active_at and r.last_active_at >= now - timedelta(days=7)]
    elif active == "month":
        rows = [r for r in rows if r.last_active_at and r.last_active_at >= now - timedelta(days=30)]
    elif active == "longer":
        rows = [r for r in rows if r.last_active_at and r.last_active_at < now - timedelta(days=30)]
    elif active == "never":
        rows = [r for r in rows if r.last_active_at is None]

    far_past = datetime(1970, 1, 1, tzinfo=timezone.utc)
    keys = {
        "name": lambda r: r.name.lower(),
        "joined": lambda r: r.joined_at,
        "health_number": lambda r: (r.health_number is None, r.health_number or 0.0),
        "last_active": lambda r: r.last_active_at or far_past,
    }
    rows.sort(key=keys[sort], reverse=(direction == "desc"))
    total = len(rows)
    start = (page - 1) * page_size
    return MembersPage(rows=rows[start:start + page_size], total=total, page=page, page_size=page_size)


@router.get("/members/{member_id}", response_model=Member360Out)
def member_360(member_id: UUID, db: Session = Depends(get_db)) -> Member360Out:
    member, user = _member_or_404(db, member_id)
    profile = next((r for r in _member_rows(db) if r.member_id == member_id), None)
    if profile is None:
        raise HTTPException(status_code=404, detail="That member was not found.")
    titles = {flow.key: flow.title for flow in db.query(GuidedFlow).all()}
    sessions = (db.query(MemberGuidedFlowSession).filter(MemberGuidedFlowSession.member_id == member_id)
                .order_by(MemberGuidedFlowSession.updated_at.desc()).all())
    conversations = (db.query(CompanionConversation).filter(CompanionConversation.member_id == member_id)
                     .order_by(CompanionConversation.last_message_at.desc()).limit(20).all())

    def history(model, item):
        return [item(a) for a in db.query(model).filter(model.member_id == member_id)
                .order_by(model.completed_at.desc(), model.created_at.desc()).all()]

    moods = db.query(MoodEntry).filter(MoodEntry.member_id == member_id).order_by(MoodEntry.entry_date.desc()).all()
    meals = (db.query(FoodDiaryEntry).filter(FoodDiaryEntry.member_id == member_id)
             .order_by(FoodDiaryEntry.entry_date.desc(), FoodDiaryEntry.meal_time.desc()).limit(60).all())
    diary_days = db.query(func.count(func.distinct(FoodDiaryEntry.entry_date))).filter(FoodDiaryEntry.member_id == member_id).scalar() or 0
    requests = db.query(MemberRequest).filter(MemberRequest.member_id == member_id).order_by(MemberRequest.created_at.desc()).all()

    return Member360Out(
        profile=profile, phone=user.phone, postal_code=user.postal_code,
        health_number=history(HealthNumberAttempt, health_number_item),
        body_composition=history(BodyCompositionAttempt, body_composition_item),
        blood_markers=history(BloodMarkerAttempt, blood_markers_item),
        health_assessment=history(HealthAssessmentAttempt, health_assessment_item),
        simple_quiz=history(SimpleQuizAttempt, simple_quiz_item),
        guided_sessions=[GuidedSessionOut(flow_key=s.flow_key, flow_title=titles.get(s.flow_key, s.flow_key), flow_version=s.flow_version,
                                          status=s.status, current_node=s.current_node, started_at=_aware(s.started_at),
                                          updated_at=_aware(s.updated_at), completed_at=_aware(s.completed_at)) for s in sessions],
        conversations=[ConversationRow(id=c.id, started_at=_aware(c.started_at), last_message_at=_aware(c.last_message_at),
                                       message_count=c.message_count, flagged=c.flagged, reviewed_at=_aware(c.reviewed_at)) for c in conversations],
        mood_entries=[mood_entry_out(m) for m in moods], mood_stats=compute_stats(moods, today=_now().date()),
        food_diary=[meal_out(m) for m in meals], food_diary_days=diary_days,
        requests=[request_out(r) for r in requests],
        not_connected=["Food Choices", "Meal Planning", "Mindfulness", "Activity Tracker (Exercise, Meditation)"],
    )


@router.get("/members/{member_id}/photo")
def member_photo(member_id: UUID, db: Session = Depends(get_db), runtime: Runtime = Depends(get_runtime)) -> Response:
    # The member's profile photo for the console: the same bytes the member sees.
    _, user = _member_or_404(db, member_id)
    try:
        data, content_type = MemberProfileService(db, runtime.media_store).read_photo(user)
    except ProfileError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    return Response(content=data, media_type=content_type, headers={"Cache-Control": "private, max-age=0, must-revalidate"})


def _instrument_out(db: Session, key: str) -> InstrumentOut:
    name, model, version, description = INSTRUMENTS[key]
    last = db.query(func.max(model.completed_at)).scalar()
    return InstrumentOut(key=key, name=name, description=description, calculation_version=version,
                         calculation_owner="System managed", attempts_total=_count(db, model),
                         members_scored=_distinct_members(db, model), last_completed_at=_aware(last))


@router.get("/assessments", response_model=list[InstrumentOut])
def assessments(db: Session = Depends(get_db)) -> list[InstrumentOut]:
    return [_instrument_out(db, key) for key in INSTRUMENTS]


@router.get("/assessments/{key}/attempts", response_model=AttemptsPage)
def assessment_attempts(
    key: InstrumentKey, q: str = Query(default="", max_length=120),
    page: int = Query(default=1, ge=1), page_size: int = Query(default=25, ge=1, le=100),
    db: Session = Depends(get_db),
) -> AttemptsPage:
    name, model, version, _ = INSTRUMENTS[key]
    accounts = {member.id: user for member, user in _member_accounts(db)}
    attempts = db.query(model).order_by(model.completed_at.desc(), model.created_at.desc()).all()
    needle = q.strip().lower()
    rows: list[AttemptRow] = []
    for attempt in attempts:
        user = accounts.get(attempt.member_id)
        member_name = user.display_name if user else "Member"
        member_email = user.email if user else ""
        if needle and needle not in member_name.lower() and needle not in member_email.lower():
            continue
        result, detail = _attempt_result(key, attempt)
        rows.append(AttemptRow(attempt_id=attempt.id, member_id=attempt.member_id, member_name=member_name, member_email=member_email,
                               completed_at=_aware(attempt.completed_at), calculation_version=attempt.calculation_version,
                               result=result, detail=detail))
    total = len(rows)
    start = (page - 1) * page_size
    return AttemptsPage(instrument=_instrument_out(db, key), rows=rows[start:start + page_size], total=total, page=page, page_size=page_size)


@router.get("/insights", response_model=InsightsOut)
def insights(db: Session = Depends(get_db)) -> InsightsOut:
    members = db.query(Member.created_at).all()
    attempts_by_month = {}
    for key, (_, model, _, _) in INSTRUMENTS.items():
        attempts_by_month[key] = _by_month([at for (at,) in db.query(model.completed_at).all()])
    titles = {flow.key: flow.title for flow in db.query(GuidedFlow).all()}
    sessions = db.query(MemberGuidedFlowSession).all()
    flows = []
    for flow_key in sorted({s.flow_key for s in sessions} | set(titles)):
        mine = [s for s in sessions if s.flow_key == flow_key]
        flows.append(GuidedFlowInsight(
            flow_key=flow_key, flow_title=titles.get(flow_key, flow_key), started=len(mine),
            in_progress=sum(1 for s in mine if s.status == "in_progress"), paused=sum(1 for s in mine if s.status == "paused"),
            completed=sum(1 for s in mine if s.status == "completed"), skipped=sum(1 for s in mine if s.status == "skipped"),
        ))
    return InsightsOut(
        members_total=len(members), members_by_month=_by_month([at for (at,) in members]),
        attempts=_tracker_counts(db, distinct=False), members_completed=_tracker_counts(db, distinct=True),
        attempts_by_month=attempts_by_month, guided_flows=flows,
        companion_conversations=_count(db, CompanionConversation), companion_messages=_count(db, CompanionMessage),
        companion_feedback_helpful=db.query(func.count(CompanionFeedback.id)).filter(CompanionFeedback.rating == "helpful").scalar() or 0,
        companion_feedback_not_helpful=db.query(func.count(CompanionFeedback.id)).filter(CompanionFeedback.rating == "not_helpful").scalar() or 0,
        requests_by_kind={kind: count for kind, count in db.query(MemberRequest.kind, func.count(MemberRequest.id)).group_by(MemberRequest.kind).all()},
        requests_by_status={status: count for status, count in db.query(MemberRequest.status, func.count(MemberRequest.id)).group_by(MemberRequest.status).all()},
        requests_by_month=_by_month([at for (at,) in db.query(MemberRequest.created_at).all()]),
        mood_entries=_count(db, MoodEntry), mood_members=_distinct_members(db, MoodEntry),
        food_diary_entries=_count(db, FoodDiaryEntry), food_diary_members=_distinct_members(db, FoodDiaryEntry),
        generated_at=_now(),
    )
