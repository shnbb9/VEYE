"""The dashboard's Personal tip.

Everything here runs against the deterministic mock provider. The tip is the
one place a language model writes something a member reads unprompted, so the
tests are mostly about what it must refuse to show.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pytest

from app.companion.models import MemberPersonalTip
from app.companion.personal_tip import (
    FALLBACK,
    FALLBACK_NO_TIP,
    FALLBACK_NOT_SHARED,
    MAX_CHARS,
    TIP_VERSION,
    PersonalTipService,
    is_safe,
)
from app.companion.providers.llm import LLMResponse
from app.core.runtime import configure_runtime, get_runtime
from app.db.session import SessionLocal

TIP = "/api/v1/companion/personal-tip"
GRANT = "/api/v1/members/me/health-permission/grant"


class Scripted:
    """A provider that says exactly what a test tells it to, and counts calls."""

    name = "scripted"

    def __init__(self, text: str = "You have logged your meals on most days this month, which is a solid habit."):
        self.text = text
        self.calls = 0
        self.raises: Exception | None = None

    def complete(self, request):
        self.calls += 1
        if self.raises is not None:
            raise self.raises
        return LLMResponse(text=self.text, provider=self.name, model="scripted", finish_reason="stop")

    def describe(self):
        return {"provider": self.name}


@pytest.fixture
def scripted():
    before = get_runtime().llm
    provider = Scripted()
    configure_runtime(llm=provider)
    yield provider
    configure_runtime(llm=before)


def _with_history(member_client):
    """Enough of the member's own record for a tip to be about something."""
    today = date.today()
    for offset in range(0, 6):
        day = (today - timedelta(days=offset)).isoformat()
        member_client.put("/api/v1/members/me/mood", params={"today": today.isoformat()},
                          json={"entry_date": day, "mood": "calm"})
        member_client.post("/api/v1/members/me/food-diary",
                           json={"entry_date": day, "meal_time": "08:00", "description": "Porridge"})
    assert member_client.post(GRANT).status_code == 200


# ---- when there is nothing to say -------------------------------------------

def test_a_member_with_no_history_gets_the_fallback_not_an_invention(member_client, scripted):
    assert member_client.post(GRANT).status_code == 200
    body = member_client.get(TIP).json()
    assert body["generated"] is False
    assert body["source"] == "fallback"
    assert body["text"] == FALLBACK
    # Nothing was asked of the model, because there was nothing to ask about.
    assert scripted.calls == 0


def test_without_sharing_the_tip_says_so_rather_than_using_the_records(member_client, scripted):
    _with_history(member_client)
    assert member_client.post("/api/v1/members/me/health-permission/revoke").status_code == 200
    body = member_client.get(TIP).json()
    assert body["generated"] is False
    assert "Share your results" in body["text"]
    assert scripted.calls == 0


# ---- caching ------------------------------------------------------------------

def test_a_dashboard_refresh_never_costs_a_model_call(member_client, scripted):
    _with_history(member_client)
    first = member_client.get(TIP).json()
    assert first["generated"] is True and scripted.calls == 1

    for _ in range(5):
        again = member_client.get(TIP).json()
        assert again["text"] == first["text"]
    assert scripted.calls == 1, "the tip was regenerated on a plain refresh"


def test_the_tip_is_rewritten_when_the_members_own_data_moves(member_client, scripted):
    _with_history(member_client)
    assert member_client.get(TIP).json()["generated"] is True
    assert scripted.calls == 1

    scripted.text = "Your mood entries have been steady for a fortnight."
    today = date.today()
    member_client.put("/api/v1/members/me/mood", params={"today": today.isoformat()},
                      json={"entry_date": (today - timedelta(days=10)).isoformat(), "mood": "happy"})

    refreshed = member_client.get(TIP).json()
    assert scripted.calls == 2
    assert refreshed["text"] == "Your mood entries have been steady for a fortnight."


def test_an_old_tip_is_rewritten_even_when_nothing_changed(member_client, scripted):
    _with_history(member_client)
    assert member_client.get(TIP).json()["generated"] is True
    assert scripted.calls == 1

    db = SessionLocal()
    try:
        row = db.query(MemberPersonalTip).one()
        row.generated_at = datetime.now(timezone.utc) - timedelta(days=30)
        db.commit()
    finally:
        db.close()

    scripted.text = "You have kept a diary most days this month."
    assert member_client.get(TIP).json()["text"] == "You have kept a diary most days this month."
    assert scripted.calls == 2


def test_a_new_tip_version_replaces_an_old_tip(member_client, scripted):
    _with_history(member_client)
    member_client.get(TIP)
    db = SessionLocal()
    try:
        row = db.query(MemberPersonalTip).one()
        row.tip_version = "personal-tip-ancient"
        db.commit()
    finally:
        db.close()
    scripted.text = "Rewritten under the current rules."
    assert member_client.get(TIP).json()["text"] == "Rewritten under the current rules."


# ---- what it must refuse to show ---------------------------------------------

@pytest.mark.parametrize("unsafe", [
    "You may have a vitamin D deficiency — consider a supplement.",
    # The number sits against the unit, so a word list with `mg\b` in it cannot
    # see this. The first version of the filter let it straight through.
    "Take 1000mg of EPA daily to improve this.",
    "Try 5000 IU of vitamin D each morning.",
    "Aim for 2.5 g of omega-3.",
    "These entries suggest early symptoms of a metabolic disorder.",
    "Your cholesterol pattern looks concerning; see a doctor.",
    "This should treat the issue within a month.",
])
def test_a_tip_that_strays_into_advice_is_dropped_not_shown(member_client, scripted, unsafe):
    _with_history(member_client)
    scripted.text = unsafe
    body = member_client.get(TIP).json()
    assert body["generated"] is False, f"unsafe tip was shown: {unsafe}"
    assert body["text"] == FALLBACK_NO_TIP
    assert not is_safe(unsafe)


def test_the_safety_filter_lets_an_ordinary_observation_through():
    assert is_safe("You have logged your meals on most days this month.")
    assert is_safe("Your mood entries have been steadier than the month before.")


def test_a_model_that_has_nothing_to_say_produces_no_tip(member_client, scripted):
    _with_history(member_client)
    scripted.text = "NOTHING_TO_SAY"
    body = member_client.get(TIP).json()
    assert body["generated"] is False
    assert body["text"] == FALLBACK_NO_TIP


def test_an_overlong_tip_is_cut_rather_than_shown_whole(member_client, scripted):
    _with_history(member_client)
    scripted.text = "You have been logging very consistently " * 20
    body = member_client.get(TIP).json()
    assert body["generated"] is True
    assert len(body["text"]) <= MAX_CHARS + 1
    assert body["text"].endswith("…")


def test_a_provider_failure_never_breaks_the_dashboard(member_client, scripted):
    _with_history(member_client)
    scripted.raises = RuntimeError("provider down")
    body = member_client.get(TIP).json()
    assert body["generated"] is False
    assert body["text"] == FALLBACK_NO_TIP


def test_a_failure_keeps_the_tip_the_member_already_had(member_client, scripted):
    """A good tip is not replaced by a fallback because today's attempt failed."""
    _with_history(member_client)
    good = member_client.get(TIP).json()["text"]
    assert good

    db = SessionLocal()
    try:
        db.query(MemberPersonalTip).one().context_fingerprint = "stale"
        db.commit()
    finally:
        db.close()
    scripted.raises = RuntimeError("provider down")
    body = member_client.get(TIP).json()
    assert body["text"] == good
    assert body["generated"] is True


# ---- what the model is given ---------------------------------------------------

def test_the_prompt_carries_summaries_and_no_identifier_or_diary_text(member_client, scripted):
    _with_history(member_client)
    member_client.get(TIP)
    assert scripted.calls == 1

    # The provider recorded nothing itself, so rebuild what it was handed.
    from app.auth.models import UserAccount
    from app.auth.provider import principal_for

    db = SessionLocal()
    try:
        user = db.query(UserAccount).filter(UserAccount.email == "aditya.demo@demo.veye.test").one()
        principal = principal_for(user, None, portal="member")
        context = PersonalTipService(db, scripted)._context(principal)
    finally:
        db.close()
    rendered = "\n".join(context.lines())
    assert "mood" in rendered and "food_pattern" in rendered
    for forbidden in ("Porridge", "aditya", "demo.veye.test", "08:00"):
        assert forbidden.lower() not in rendered.lower()


def test_the_tip_is_never_a_calculation(member_client, scripted):
    """Health Number, Balance and body fat are VEYE arithmetic. The tip has no
    business restating them, and the route does not expose them."""
    _with_history(member_client)
    body = member_client.get(TIP).json()
    assert set(body) == {"text", "generated", "generated_at", "source", "tip_version"}
    assert body["tip_version"] == TIP_VERSION


def test_the_tip_belongs_to_one_member(member_client, scripted):
    from fastapi.testclient import TestClient

    from app.main import app
    from tests.conftest import sign_up

    _with_history(member_client)
    mine = member_client.get(TIP).json()["text"]

    other = TestClient(app)
    assert sign_up(other, email="tipless@demo.veye.test", first_name="Tipless").status_code == 201
    assert other.post(GRANT).status_code == 200
    theirs = other.get(TIP).json()
    assert theirs["generated"] is False
    assert theirs["text"] != mine


def test_an_unauthenticated_caller_gets_no_tip(client):
    assert client.get(TIP).status_code == 401


@pytest.mark.parametrize("not_a_tip, why", [
    ("Hey {{MEMBER_FIRST_NAME}}, here is what I can share. Would you like to look at this together?",
     "the offline mock's conversational refusal, token and all"),
    ("Hi there, you have been logging consistently.", "a greeting"),
    ("Have you thought about logging more often?", "a question"),
])
def test_a_provider_that_ignores_the_prompt_does_not_reach_the_dashboard(member_client, scripted, not_a_tip, why):
    """A chat reply is a fine chat reply and a nonsense personal tip. The shape
    check is what stops a half-connected model looking like personalisation."""
    _with_history(member_client)
    scripted.text = not_a_tip
    body = member_client.get(TIP).json()
    assert body["generated"] is False, f"shown despite {why}"
    assert "{{" not in body["text"]


def test_the_fallback_matches_the_reason_rather_than_guessing(member_client, scripted):
    from app.companion.personal_tip import FALLBACK, FALLBACK_NO_TIP, FALLBACK_NOT_SHARED

    # No history at all.
    assert member_client.post(GRANT).status_code == 200
    assert member_client.get(TIP).json()["text"] == FALLBACK

    # History, but the provider produced nothing usable. Telling a member with
    # months of entries to come back when they have some would be wrong.
    _with_history(member_client)
    scripted.text = "NOTHING_TO_SAY"
    assert member_client.get(TIP).json()["text"] == FALLBACK_NO_TIP

    # History, but not shared.
    assert member_client.post("/api/v1/members/me/health-permission/revoke").status_code == 200
    assert member_client.get(TIP).json()["text"] == FALLBACK_NOT_SHARED


def test_a_tip_stored_before_a_rule_existed_is_not_served_forever(member_client, scripted):
    """The rules apply on the way out as well as on the way in. Tightening
    them has to take effect for tips already in the database, not only for the
    next one generated — otherwise a matching fingerprint keeps the old one
    alive indefinitely, which is exactly what happened on the local stack."""
    _with_history(member_client)
    assert member_client.get(TIP).json()["generated"] is True

    db = SessionLocal()
    try:
        row = db.query(MemberPersonalTip).one()
        # What the offline mock used to put there, fingerprint and all intact.
        row.text = "Hey {{MEMBER_FIRST_NAME}}, I do not have an approved Veye source. Shall we look together?"
        db.commit()
        fingerprint_before = row.context_fingerprint
    finally:
        db.close()

    scripted.text = "You have kept your diary on most days this month."
    body = member_client.get(TIP).json()
    assert body["text"] == "You have kept your diary on most days this month."
    assert "{{" not in body["text"]
    assert fingerprint_before  # it matched, and was regenerated anyway


def test_an_unacceptable_cached_tip_is_not_kept_when_generation_also_fails(member_client, scripted):
    _with_history(member_client)
    member_client.get(TIP)
    db = SessionLocal()
    try:
        db.query(MemberPersonalTip).one().text = "Take 1000mg of EPA daily."
        db.commit()
    finally:
        db.close()
    scripted.raises = RuntimeError("provider down")
    body = member_client.get(TIP).json()
    assert body["generated"] is False
    assert "1000mg" not in body["text"]
