"""The member's own words, looked for everywhere Sprout's turn leaves a mark.

`test_companion_pipeline.py` proves the context carries no direct identifier,
and that the summary models forbid undeclared fields. This is the other half of
CLAUDE.md's rule — "no mood note, no meal description, no exact time" — and it
is asserted the only way that cannot be argued with: the member writes text
nothing else would produce, **grants** the sharing permission so the summaries
really build, asks questions whose topics open the mood and food scopes, and
the canaries are looked for in

  * the context object the service builds,
  * the "## MEMBER CONTEXT" lines the system prompt is assembled from,
  * the telemetry payload captured with capture_content on,
  * the reply the member is shown, and
  * the rows the console's Conversations screen reads.

The structural allowlist makes this true by construction today. A field added
later that carried free text would still satisfy `extra="forbid"`, and this is
what would notice.

Each summary is asserted to be the REAL one rather than an `UnavailableSummary`:
`context.mood is not None` is true for both, and a test that accepted the
unavailable form would be checking an object with nothing in it.
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest

from app.companion.context import FoodPatternSummary, MemberContextService, MoodSummary
from app.companion.policy import PolicyEngine
from app.core.runtime import configure_runtime, get_runtime
from app.db.session import SessionLocal
from app.observability.telemetry import InMemoryTraceExporter, TelemetryRecorder

MOOD_NOTE_CANARY = "qqzzx-mood-note-canary"
MEAL_CANARY = "qqzzx-meal-description-canary"
EXACT_TIME = "08:47"           # a minute nobody would bucket to
CANARIES = (MOOD_NOTE_CANARY, MEAL_CANARY, EXACT_TIME)

# One question per scope: the policy classifies a turn to a topic, and asking
# about both at once opens only the first. The scope each one opens is asserted
# rather than assumed, so a change in classification makes this fail loudly
# instead of quietly checking an empty context.
MOOD_QUESTION = "How has my mood been this month?"
FOOD_QUESTION = "What should I eat today?"


@pytest.fixture
def memory_traces():
    """Telemetry into memory with content capture on — the worst case for
    leakage, and the only way to see what was really sent."""
    exporter = InMemoryTraceExporter()
    runtime = get_runtime()
    configure_runtime(telemetry=TelemetryRecorder(
        [*runtime.telemetry.exporters, exporter], pseudonym_key="test-pepper",
        environment="test", capture_content=True))
    return exporter


def _member_who_wrote_private_text_and_shares(member_client, admin_client):
    """Three days of mood notes and diary entries, with the permission granted
    so the summaries are built rather than withheld."""
    today = date.today()
    for offset in range(3):
        day = (today - timedelta(days=offset)).isoformat()
        mood = member_client.put("/api/v1/members/me/mood", params={"today": today.isoformat()},
                                 json={"entry_date": day, "mood": "calm", "note": MOOD_NOTE_CANARY})
        assert mood.status_code == 200, mood.text
        diary = member_client.post("/api/v1/members/me/food-diary",
                                   json={"entry_date": day, "meal_time": EXACT_TIME, "description": MEAL_CANARY})
        assert diary.status_code == 201, diary.text

    member_id = member_client.get("/api/v1/auth/me").json()["member"]["member_id"]
    asked = admin_client.post(f"/api/v1/admin/members/{member_id}/health-permission/request", json={})
    assert asked.status_code in (200, 201), asked.text
    granted = member_client.post("/api/v1/members/me/health-permission/grant", json={})
    assert granted.status_code in (200, 201), granted.text
    return member_id


def _found_in(text: str) -> list[str]:
    return [canary for canary in CANARIES if canary in text]


def test_the_member_really_wrote_it(member_client, admin_client):
    """Otherwise every assertion below passes on an empty database."""
    _member_who_wrote_private_text_and_shares(member_client, admin_client)
    mood = member_client.get("/api/v1/members/me/mood", params={"today": date.today().isoformat()}).text
    diary = member_client.get("/api/v1/members/me/food-diary", params={"date": date.today().isoformat()}).text
    assert MOOD_NOTE_CANARY in mood
    assert MEAL_CANARY in diary and EXACT_TIME in diary


def _context_for(db, member_client, question):
    from app.auth.models import UserAccount
    from app.auth.provider import principal_for

    user = db.query(UserAccount).filter(UserAccount.email == member_client.account["email"]).one()
    principal = principal_for(user, None)
    decision = PolicyEngine().evaluate(question)
    return MemberContextService(db).build(principal, decision.member_data_scopes, decision)


def test_the_mood_summary_is_built_and_carries_none_of_the_note(member_client, admin_client):
    _member_who_wrote_private_text_and_shares(member_client, admin_client)
    with SessionLocal() as db:
        context = _context_for(db, member_client, MOOD_QUESTION)
        assert isinstance(context.mood, MoodSummary), (
            f"the mood scope produced {type(context.mood).__name__}, not a real summary — "
            "this test would be checking an empty object"
        )
        assert context.mood.days_logged_30d == 3, context.mood

        dumped = context.model_dump_json()
        assert _found_in(dumped) == [], f"the context carries the member's own text: {_found_in(dumped)}"
        prose = "\n".join(context.lines())
        assert prose.strip(), "lines() rendered nothing"
        assert _found_in(prose) == [], f"the prompt lines carry it: {_found_in(prose)}"


def test_the_food_summary_is_built_and_carries_none_of_the_description_or_time(member_client, admin_client):
    _member_who_wrote_private_text_and_shares(member_client, admin_client)
    with SessionLocal() as db:
        context = _context_for(db, member_client, FOOD_QUESTION)
        assert isinstance(context.food_pattern, FoodPatternSummary), (
            f"the food scope produced {type(context.food_pattern).__name__}, not a real summary — "
            "this test would be checking an empty object"
        )
        assert context.food_pattern.entries_30d == 3, context.food_pattern
        # The logged time is rounded to a part of day, so the minute is gone.
        assert context.food_pattern.common_meal_times == ["breakfast"], context.food_pattern.common_meal_times

        dumped = context.model_dump_json()
        assert _found_in(dumped) == [], f"the context carries the member's own text: {_found_in(dumped)}"
        prose = "\n".join(context.lines())
        assert prose.strip(), "lines() rendered nothing"
        assert _found_in(prose) == [], f"the prompt lines carry it: {_found_in(prose)}"


def test_no_canary_reaches_the_reply_the_trace_or_the_console(member_client, admin_client, memory_traces):
    _member_who_wrote_private_text_and_shares(member_client, admin_client)

    for question in (MOOD_QUESTION, FOOD_QUESTION):
        sent = member_client.post("/api/v1/companion/messages", json={"message": question})
        assert sent.status_code == 201, sent.text
        assert sent.json()["context_scopes"], f"no member data was used for {question!r}"
        assert _found_in(sent.text) == [], f"the reply quotes the member's own text: {_found_in(sent.text)}"

    captured = "\n".join(str(payload) for payload in memory_traces.payloads)
    assert captured, "no trace was captured; this test would prove nothing"
    assert "MEMBER CONTEXT" in captured, "the captured trace holds no prompt, so it proves nothing about one"
    assert _found_in(captured) == [], f"the captured prompt or response carries it: {_found_in(captured)}"

    conversations = admin_client.get("/api/v1/admin/companion/conversations", params={"filter": "all"})
    assert conversations.status_code == 200, conversations.text
    assert _found_in(conversations.text) == [], f"the console conversation list carries it: {_found_in(conversations.text)}"
    rows = conversations.json()
    assert rows, "no conversation reached the console, so nothing was checked there"
    detail = admin_client.get(f"/api/v1/admin/companion/conversations/{rows[0]['id']}")
    assert detail.status_code == 200, detail.text
    # The member's question is theirs and is meant to be reviewable; the mood
    # note and the meal description are no part of this turn at all.
    assert _found_in(detail.text) == [], f"the console transcript carries it: {_found_in(detail.text)}"
