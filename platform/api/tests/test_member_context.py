"""What Sprout is allowed to know about a member.

The pipeline these tests pin down:

    raw rows -> VEYE arithmetic -> a short structured summary -> the sharing
    gate -> the model

Nothing skips a step. In particular the model never receives a row, a note, a
meal description, a date finer than a month, or anything a member typed.
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest

from app.companion.context import (
    FoodPatternSummary,
    MemberContextService,
    MoodSummary,
    UnavailableSummary,
)
from app.companion.policy import PolicyDecision
from app.db.session import SessionLocal
from app.health_permission.service import HealthPermissionService

ALL_SCOPES = ("health_number_summary", "body_composition_summary", "blood_marker_summary",
              "mood_summary", "food_pattern_summary")


def _principal(member_client):
    from app.auth.models import UserAccount
    from app.auth.provider import principal_for

    db = SessionLocal()
    try:
        user = db.query(UserAccount).filter(UserAccount.email == "aditya.demo@demo.veye.test").one()
        return principal_for(user, None, portal="member")
    finally:
        db.close()


def _decision(scopes=ALL_SCOPES):
    return PolicyDecision(outcome="answer", category=None, matched_rule=None, reason="test",
                          retrieval_scopes=(), member_data_scopes=tuple(scopes))


def _build(principal):
    db = SessionLocal()
    try:
        return MemberContextService(db).build(principal, ALL_SCOPES, _decision())
    finally:
        db.close()


def _grant(principal):
    db = SessionLocal()
    try:
        HealthPermissionService(db).grant(principal.member_id, by_user_id=principal.user_id, by_name="Member")
        db.commit()
    finally:
        db.close()


def _log_moods(member_client, moods: list[tuple[int, str]]) -> None:
    """(days_ago, mood) — written through the real route, not the table."""
    today = date.today()
    for days_ago, mood in moods:
        day = (today - timedelta(days=days_ago)).isoformat()
        answer = member_client.put("/api/v1/members/me/mood", params={"today": today.isoformat()},
                                   json={"entry_date": day, "mood": mood, "note": "private note with a name in it"})
        assert answer.status_code == 200, answer.text


# ---- the sharing gate ------------------------------------------------------

def test_without_sharing_sprout_gets_no_history_at_all(member_client):
    _log_moods(member_client, [(0, "happy"), (1, "calm")])
    context = _build(_principal(member_client))
    assert set(context.scopes) == set(ALL_SCOPES)
    for field in ("health_number", "body_composition", "blood_markers", "mood", "food_pattern"):
        summary = getattr(context, field)
        assert isinstance(summary, UnavailableSummary), f"{field} reached the model without permission"
        assert "not shared" in summary.reason
    # And the prompt says so plainly rather than silently omitting the line.
    assert all("not available" in line for line in context.lines())


def test_withdrawing_stops_it_on_the_very_next_message(member_client):
    _log_moods(member_client, [(0, "happy"), (1, "calm"), (2, "calm")])
    principal = _principal(member_client)
    _grant(principal)
    assert isinstance(_build(principal).mood, MoodSummary)

    db = SessionLocal()
    try:
        HealthPermissionService(db).revoke(principal.member_id, by_user_id=principal.user_id, by_name="Member")
        db.commit()
    finally:
        db.close()
    assert isinstance(_build(principal).mood, UnavailableSummary)


# ---- mood ------------------------------------------------------------------

def test_mood_reaches_the_model_as_counts_and_a_trend_never_as_notes(member_client):
    _log_moods(member_client, [(0, "happy"), (1, "calm"), (2, "happy"), (3, "tired"), (9, "calm")])
    principal = _principal(member_client)
    _grant(principal)
    context = _build(principal)

    mood = context.mood
    assert isinstance(mood, MoodSummary)
    assert mood.days_logged_30d == 5
    assert mood.distribution_30d == {"calm": 2, "happy": 2, "tired": 1}
    assert mood.most_common in {"calm", "happy"}
    assert mood.balance_score is not None and 0 <= mood.balance_score <= 100
    assert mood.balance_window_days == 30
    assert mood.latest_month == date.today().strftime("%Y-%m")

    # The note the member wrote never leaves the database.
    rendered = "\n".join(context.lines())
    assert "private note" not in rendered
    assert "name in it" not in rendered
    # Nor does any exact date.
    assert date.today().isoformat() not in rendered


def test_a_mood_trend_needs_enough_entries_to_mean_anything(member_client):
    _log_moods(member_client, [(0, "happy"), (1, "calm")])
    principal = _principal(member_client)
    _grant(principal)
    assert _build(principal).mood.trend == "too_few"


def test_no_moods_is_reported_as_nothing_logged_not_as_a_broken_feature(member_client):
    principal = _principal(member_client)
    _grant(principal)
    mood = _build(principal).mood
    assert isinstance(mood, UnavailableSummary)
    assert "no moods logged yet" == mood.reason
    # The old wording claimed the tracker was not connected. It is.
    assert "not connected" not in mood.reason


# ---- food ------------------------------------------------------------------

def test_food_reaches_the_model_as_a_habit_never_as_meals(member_client):
    today = date.today()
    for days_ago, meal_time, description in [
        (0, "08:00", "Porridge with blueberries"),
        (0, "13:00", "Chicken salad"),
        (1, "08:30", "Eggs on toast"),
        (4, "19:30", "Salmon and greens"),
    ]:
        day = (today - timedelta(days=days_ago)).isoformat()
        answer = member_client.post("/api/v1/members/me/food-diary",
                                    json={"entry_date": day, "meal_time": meal_time, "description": description})
        assert answer.status_code == 201, answer.text

    principal = _principal(member_client)
    _grant(principal)
    context = _build(principal)

    food = context.food_pattern
    assert isinstance(food, FoodPatternSummary)
    assert food.entries_30d == 4
    assert food.days_logged_30d == 3
    assert food.entries_per_logged_day == pytest.approx(1.3, abs=0.05)
    assert food.logging == "occasional"
    assert "breakfast" in food.common_meal_times

    # What they ate is the member's business, not the model's.
    rendered = "\n".join(context.lines())
    for meal in ("Porridge", "blueberries", "Chicken", "Eggs", "Salmon"):
        assert meal not in rendered
    # Nor an exact meal time.
    assert "08:00" not in rendered and "19:30" not in rendered


def test_nothing_logged_and_nothing_planned_says_exactly_that(member_client):
    principal = _principal(member_client)
    _grant(principal)
    food = _build(principal).food_pattern
    assert isinstance(food, UnavailableSummary)
    assert "no food diary entries or meal plans saved yet" == food.reason
    assert "not connected" not in food.reason


# ---- the structural allowlist ----------------------------------------------

def test_a_summary_cannot_carry_a_field_nobody_declared(member_client):
    """`extra="forbid"` is the real guarantee: a field that is not on the model
    cannot be put into the context at all, by anyone, later."""
    with pytest.raises(Exception):
        MoodSummary(days_logged_30d=1, distribution_30d={}, most_common=None, balance_score=None,
                    balance_entries=0, balance_window_days=30, trend="too_few", day_streak=0,
                    latest_month=None, member_email="aditya.demo@demo.veye.test")


def test_the_context_never_carries_an_identifier(member_client):
    _log_moods(member_client, [(0, "happy")])
    principal = _principal(member_client)
    _grant(principal)
    context = _build(principal)
    blob = context.model_dump_json().lower()
    for identifier in ("aditya", "demo.veye.test", str(principal.member_id), str(principal.user_id)):
        assert identifier.lower() not in blob, f"{identifier} reached the model context"


def test_only_the_scopes_the_policy_allowed_are_built(member_client):
    _log_moods(member_client, [(0, "happy")])
    principal = _principal(member_client)
    _grant(principal)
    db = SessionLocal()
    try:
        context = MemberContextService(db).build(principal, ALL_SCOPES, _decision(("mood_summary",)))
    finally:
        db.close()
    assert context.scopes == ("mood_summary",)
    assert context.mood is not None
    assert context.health_number is None and context.food_pattern is None
