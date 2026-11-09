"""MemberContextService: the only Companion-facing route to member data.

It returns short structured summaries for the scopes the policy decision
allows — never a whole record, never a direct identifier. The summary models
use `extra="forbid"`, so a field that is not declared here cannot exist in the
context at all (the structural allowlist)."""

from __future__ import annotations

from collections import Counter
from datetime import date, datetime, timedelta
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from app.assessments.repository import health_number_history
from app.auth.principal import CurrentPrincipal
from app.companion.personalization import MEMBER_FIRST_NAME_TOKEN
from app.companion.policy import MEMBER_DATA_SCOPES, PolicyDecision
from app.progress.blood_markers.repository import blood_markers_history
from app.progress.body_composition.repository import body_composition_history


class _Summary(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class HealthNumberSummary(_Summary):
    displayed_score: float
    status: str
    category: str
    completed_month: str
    attempts: int
    trend: Literal["improved", "higher", "unchanged", "first"]


class BodyCompositionSummary(_Summary):
    bmi: float | None
    body_fat_percent: int | None
    body_fat_available: bool
    completed_month: str
    attempts: int


class BloodMarkerSummary(_Summary):
    in_range: dict[str, bool | None]
    classification: dict[str, str | None]
    recommendation_state: str
    completed_month: str
    attempts: int


class MoodSummary(_Summary):
    """How the member has been feeling, as counts and a trend — never a note.

    A mood note is free text the member wrote and may contain anything,
    including a name, so it does not go near a model. The distribution is
    capped at the moods that actually occur and carries no dates finer than a
    month."""

    days_logged_30d: int
    distribution_30d: dict[str, int]
    most_common: str | None
    balance_score: int | None          # 0-100, the client's formula
    balance_entries: int
    balance_window_days: int
    trend: Literal["steadier", "lower", "unchanged", "too_few"]
    day_streak: int
    latest_month: str | None


class FoodPatternSummary(_Summary):
    """How consistently the member logs and plans — not what they ate.

    Meal descriptions are free text and never leave the database. What is
    useful to Sprout is the shape of the habit: how many days, how regularly,
    which meals tend to be recorded, and whether a plan is in play."""

    entries_30d: int
    days_logged_30d: int
    days_saved_30d: int
    entries_per_logged_day: float | None
    common_meal_times: list[str]
    logging: Literal["most_days", "some_days", "occasional", "none"]
    meal_plans_saved: int
    plan_assigned_within_7d: bool


class UnavailableSummary(_Summary):
    available: Literal[False] = False
    reason: str


class MemberContext(_Summary):
    """Everything the prompt may know about the member. Note what is absent:
    no name, email, phone, birth date, address, account or member id."""

    scopes: tuple[str, ...]
    personalization_token: str = MEMBER_FIRST_NAME_TOKEN
    health_number: HealthNumberSummary | UnavailableSummary | None = None
    body_composition: BodyCompositionSummary | UnavailableSummary | None = None
    blood_markers: BloodMarkerSummary | UnavailableSummary | None = None
    mood: MoodSummary | UnavailableSummary | None = None
    food_pattern: FoodPatternSummary | UnavailableSummary | None = None

    def lines(self) -> list[str]:
        """Prompt rendering: one line per scope, no identifiers."""
        out: list[str] = []
        if self.health_number is not None:
            hn = self.health_number
            if isinstance(hn, HealthNumberSummary):
                trend = {"improved": "improved since the previous result", "higher": "higher than the previous result",
                         "unchanged": "unchanged from the previous result", "first": "first result"}[hn.trend]
                out.append(f"- health_number: {hn.displayed_score:.1f} ({hn.status}; {hn.category} pattern; {trend}; "
                           f"{hn.attempts} result(s); latest {hn.completed_month}). Lower is better on the 1-10 scale.")
            else:
                out.append(f"- health_number: not available ({hn.reason})")
        if self.body_composition is not None:
            bc = self.body_composition
            if isinstance(bc, BodyCompositionSummary):
                fat = f"body fat {bc.body_fat_percent}%" if bc.body_fat_available else "body fat not available for those measurements"
                bmi = f"BMI {bc.bmi}" if bc.bmi is not None else "BMI not available"
                out.append(f"- body_composition: {bmi}; {fat}; {bc.attempts} result(s); latest {bc.completed_month}.")
            else:
                out.append(f"- body_composition: not available ({bc.reason})")
        if self.blood_markers is not None:
            bm = self.blood_markers
            if isinstance(bm, BloodMarkerSummary):
                flags = ", ".join(f"{k} {'in range' if v else 'out of range' if v is False else 'not entered'}" for k, v in bm.in_range.items())
                out.append(f"- blood_markers: {flags}; suggestion state {bm.recommendation_state}; {bm.attempts} result(s); latest {bm.completed_month}.")
            else:
                out.append(f"- blood_markers: not available ({bm.reason})")
        if self.mood is not None:
            md = self.mood
            if isinstance(md, MoodSummary):
                spread = ", ".join(f"{mood} x{count}" for mood, count in md.distribution_30d.items())
                trend = {"steadier": "steadier than the previous 30 days", "lower": "lower than the previous 30 days",
                         "unchanged": "about the same as the previous 30 days",
                         "too_few": "too few entries to compare with the previous 30 days"}[md.trend]
                balance = f"balance {md.balance_score}/100 over {md.balance_entries} day(s)" if md.balance_score is not None else "balance not available"
                out.append(f"- mood: {md.days_logged_30d} day(s) logged in the last 30 ({spread}); most often {md.most_common}; "
                           f"{balance}; {trend}; current streak {md.day_streak} day(s). "
                           "These are the member's own entries, not a diagnosis.")
            else:
                out.append(f"- mood: not available ({md.reason})")
        if self.food_pattern is not None:
            fp = self.food_pattern
            if isinstance(fp, FoodPatternSummary):
                habit = {"most_days": "logs on most days", "some_days": "logs on some days",
                         "occasional": "logs occasionally", "none": "has not logged recently"}[fp.logging]
                times = ", ".join(fp.common_meal_times) if fp.common_meal_times else "no pattern yet"
                plan = "a meal plan is assigned to a day this week" if fp.plan_assigned_within_7d else "no meal plan assigned this week"
                out.append(f"- food_pattern: {habit} ({fp.days_logged_30d} day(s), {fp.entries_30d} entries in the last 30, "
                           f"{fp.days_saved_30d} day(s) marked complete); usually records {times}; "
                           f"{fp.meal_plans_saved} saved meal plan(s); {plan}. "
                           "What they ate is not included, only how consistently they record it.")
            else:
                out.append(f"- food_pattern: not available ({fp.reason})")
        return out


def _month(value: datetime) -> str:
    return value.strftime("%Y-%m")


class MemberContextService:
    def __init__(self, db: Session) -> None:
        self.db = db

    def build(self, principal: CurrentPrincipal, requested_scopes: list[str] | tuple[str, ...], decision: PolicyDecision) -> MemberContext:
        if not principal.is_member or principal.member_id is None:
            return MemberContext(scopes=())
        allowed = [s for s in requested_scopes if s in decision.member_data_scopes and s in MEMBER_DATA_SCOPES]
        context: dict = {"scopes": tuple(allowed)}
        member_id = principal.member_id

        # The same records reaching a language model is the same disclosure as
        # the Veye team opening them, so it answers to the same decision. A
        # member who has not shared gets a Sprout that works without their
        # history rather than one that quietly uses it. Read per build, never
        # cached, so withdrawing takes effect on the next message.
        from app.health_permission.service import HealthPermissionService

        if not HealthPermissionService(self.db).shares_health_data(member_id):
            withheld = UnavailableSummary(
                reason="the member has not shared their health records, so Sprout answers without them")
            for scope, field in (("health_number_summary", "health_number"),
                                 ("body_composition_summary", "body_composition"),
                                 ("blood_marker_summary", "blood_markers"),
                                 ("mood_summary", "mood"),
                                 ("food_pattern_summary", "food_pattern")):
                if scope in allowed:
                    context[field] = withheld
            return MemberContext(**context)
        if "health_number_summary" in allowed:
            history = health_number_history(self.db, member_id)
            if history:
                latest = history[0]
                previous = history[1] if len(history) > 1 else None
                if previous is None:
                    trend = "first"
                elif float(latest.displayed_score) < float(previous.displayed_score):
                    trend = "improved"
                elif float(latest.displayed_score) > float(previous.displayed_score):
                    trend = "higher"
                else:
                    trend = "unchanged"
                context["health_number"] = HealthNumberSummary(
                    displayed_score=float(latest.displayed_score), status=latest.status, category=latest.category,
                    completed_month=_month(latest.completed_at), attempts=len(history), trend=trend,
                )
            else:
                context["health_number"] = UnavailableSummary(reason="no Health Number saved yet")
        if "body_composition_summary" in allowed:
            history = body_composition_history(self.db, member_id)
            if history:
                latest = history[0]
                context["body_composition"] = BodyCompositionSummary(
                    bmi=float(latest.bmi) if latest.bmi is not None else None, body_fat_percent=latest.body_fat_percent,
                    body_fat_available=latest.body_fat_percent is not None, completed_month=_month(latest.completed_at),
                    attempts=len(history),
                )
            else:
                context["body_composition"] = UnavailableSummary(reason="no Body Composition saved yet")
        if "blood_marker_summary" in allowed:
            history = blood_markers_history(self.db, member_id)
            if history:
                latest = history[0]
                context["blood_markers"] = BloodMarkerSummary(
                    in_range=dict(latest.results.get("in_range", {})), classification=dict(latest.results.get("classification", {})),
                    recommendation_state=str(latest.results.get("recommendation", {}).get("state", "none")),
                    completed_month=_month(latest.completed_at), attempts=len(history),
                )
            else:
                context["blood_markers"] = UnavailableSummary(reason="no Blood Test Markers saved yet")
        if "mood_summary" in allowed:
            context["mood"] = self._mood_summary(member_id)
        if "food_pattern_summary" in allowed:
            context["food_pattern"] = self._food_pattern_summary(member_id)
        return MemberContext(**context)

    # ---- deterministic aggregation -------------------------------------------
    # Raw rows -> VEYE arithmetic -> a short structured summary -> the model.
    # The model never sees a row, a date finer than a month, or any free text
    # the member typed.

    def _mood_summary(self, member_id: UUID):
        from app.mood.models import MoodEntry
        from app.mood.service import compute_stats

        entries = (self.db.query(MoodEntry).filter(MoodEntry.member_id == member_id)
                   .order_by(MoodEntry.entry_date.desc()).all())
        if not entries:
            return UnavailableSummary(reason="no moods logged yet")
        today = date.today()
        cutoff = today - timedelta(days=29)
        window = [e for e in entries if cutoff <= e.entry_date <= today]
        stats = compute_stats(entries, today=today)

        # Trend: this 30-day balance against the 30 before it. Described as
        # steadier or lower, never as better or worse — a mood is not a score
        # and Veye does not grade it.
        earlier_cut = cutoff - timedelta(days=30)
        earlier = [e for e in entries if earlier_cut <= e.entry_date < cutoff]
        trend = "too_few"
        if len(window) >= 3 and len(earlier) >= 3:
            now_balance = _balance(window)
            was_balance = _balance(earlier)
            if now_balance is not None and was_balance is not None:
                trend = "steadier" if now_balance > was_balance + 4 else "lower" if now_balance < was_balance - 4 else "unchanged"

        counts = Counter(e.mood for e in window)
        return MoodSummary(
            days_logged_30d=len(window),
            distribution_30d=dict(sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))),
            most_common=counts.most_common(1)[0][0] if counts else None,
            balance_score=stats.balance_score, balance_entries=stats.balance_entries,
            balance_window_days=stats.balance_window_days, trend=trend,
            day_streak=stats.day_streak,
            latest_month=entries[0].entry_date.strftime("%Y-%m"),
        )

    def _food_pattern_summary(self, member_id: UUID):
        from app.food.models import FoodDiaryDay, FoodDiaryEntry

        today = date.today()
        cutoff = today - timedelta(days=29)
        entries = (self.db.query(FoodDiaryEntry)
                   .filter(FoodDiaryEntry.member_id == member_id,
                           FoodDiaryEntry.entry_date >= cutoff, FoodDiaryEntry.entry_date <= today).all())
        saved = (self.db.query(FoodDiaryDay)
                 .filter(FoodDiaryDay.member_id == member_id,
                         FoodDiaryDay.entry_date >= cutoff, FoodDiaryDay.entry_date <= today).count())
        plans, assigned = _meal_plan_counts(self.db, member_id, today)
        if not entries and not plans:
            return UnavailableSummary(reason="no food diary entries or meal plans saved yet")

        days = {e.entry_date for e in entries}
        buckets = Counter(_meal_bucket(e.meal_time) for e in entries)
        logged = len(days)
        logging = ("most_days" if logged >= 20 else "some_days" if logged >= 8
                   else "occasional" if logged >= 1 else "none")
        return FoodPatternSummary(
            entries_30d=len(entries), days_logged_30d=logged, days_saved_30d=saved,
            entries_per_logged_day=round(len(entries) / logged, 1) if logged else None,
            common_meal_times=[name for name, _ in buckets.most_common(3)],
            logging=logging, meal_plans_saved=plans, plan_assigned_within_7d=assigned,
        )


def _balance(entries) -> int | None:
    """The client's Balance formula over an arbitrary window."""
    from app.mood.service import MOOD_BALANCE

    scores = [MOOD_BALANCE[e.mood] for e in entries]
    return round(sum(scores) / len(scores)) if scores else None


def _meal_bucket(meal_time) -> str:
    """A meal time rounded to the part of day. The exact minute is of no use to
    a model and is one more thing that does not need to leave the database."""
    hour = getattr(meal_time, "hour", None)
    if hour is None:
        try:
            hour = int(str(meal_time).split(":")[0])
        except (ValueError, IndexError):
            return "unknown"
    if hour < 11:
        return "breakfast"
    if hour < 15:
        return "lunch"
    if hour < 18:
        return "afternoon"
    return "evening"


def _meal_plan_counts(db: Session, member_id: UUID, today: date) -> tuple[int, bool]:
    from app.meal_plans.models import MealPlanDay

    rows = db.query(MealPlanDay).filter(MealPlanDay.member_id == member_id).all()
    soon = any(r.assigned_date is not None and today <= r.assigned_date <= today + timedelta(days=7) for r in rows)
    return len(rows), soon
