"""Rate limits on the endpoints that cost money or send mail.

What these are actually protecting is three different things, and the tests
follow that split: money (a model call), other people's mailboxes (an email to
an address the caller typed), and the database (writes from anyone at all).

The load-bearing assertion in most of them is not the 429 — it is that the
expensive thing did not happen.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

from app.core.rate_limit import LIMITS, RateLimitEvent, RateLimiter, prune_rate_limit_events
from app.db.session import SessionLocal
from app.main import app
from tests.conftest import sign_up

TIP = "/api/v1/companion/personal-tip"
ASK = "/api/v1/companion/messages"


def _age_events(bucket: str, minutes: int) -> None:
    """Push a bucket's events back in time, so a window can be crossed without
    the test taking that long."""
    db = SessionLocal()
    try:
        for row in db.query(RateLimitEvent).filter(RateLimitEvent.bucket == bucket).all():
            row.created_at = datetime.now(timezone.utc) - timedelta(minutes=minutes)
        db.commit()
    finally:
        db.close()


def _clear(bucket: str) -> None:
    db = SessionLocal()
    try:
        db.query(RateLimitEvent).filter(RateLimitEvent.bucket == bucket).delete()
        db.commit()
    finally:
        db.close()


# ---- the boundary ------------------------------------------------------------

def test_the_request_at_the_limit_is_accepted_and_the_next_one_is_not(member_client):
    _clear("companion_message")
    allowed = LIMITS["companion_message"].per_subject
    for attempt in range(allowed):
        answer = member_client.post(ASK, json={"message": "What is a Health Number?"})
        assert answer.status_code in (201, 200), f"attempt {attempt + 1} of {allowed}: {answer.status_code}"

    refused = member_client.post(ASK, json={"message": "One more"})
    assert refused.status_code == 429
    assert refused.headers.get("Retry-After", "").isdigit()
    assert int(refused.headers["Retry-After"]) > 0
    assert "try again" in refused.json()["detail"].lower()


def test_the_window_expiring_allows_another(member_client):
    _clear("companion_message")
    for _ in range(LIMITS["companion_message"].per_subject):
        member_client.post(ASK, json={"message": "hello"})
    assert member_client.post(ASK, json={"message": "hello"}).status_code == 429

    _age_events("companion_message", LIMITS["companion_message"].window_minutes + 1)
    assert member_client.post(ASK, json={"message": "hello"}).status_code in (200, 201)


def test_one_members_messages_do_not_consume_anothers_allowance(member_client):
    _clear("companion_message")
    for _ in range(LIMITS["companion_message"].per_subject):
        member_client.post(ASK, json={"message": "hello"})
    assert member_client.post(ASK, json={"message": "hello"}).status_code == 429

    other = TestClient(app)
    assert sign_up(other, email="unlimited@demo.veye.test", first_name="Other").status_code == 201
    assert other.post(ASK, json={"message": "hello"}).status_code in (200, 201)


# ---- the model is not called once the limit is reached -----------------------

def test_a_refused_message_never_reaches_the_model(member_client):
    """The 429 is incidental. The point is that nothing was paid for."""
    from app.companion.providers.llm import MockLLMProvider
    from app.core.runtime import configure_runtime, get_runtime

    _clear("companion_message")
    counting = MockLLMProvider()
    before = get_runtime().llm
    configure_runtime(llm=counting)
    try:
        for _ in range(LIMITS["companion_message"].per_subject):
            member_client.post(ASK, json={"message": "What is a Health Number?"})
        calls = len(counting.requests)
        assert member_client.post(ASK, json={"message": "and again"}).status_code == 429
        assert len(counting.requests) == calls, "the model was called for a request that was over the limit"
    finally:
        configure_runtime(llm=before)


def test_a_cached_personal_tip_costs_nothing_against_the_limit(member_client):
    """Reading a tip is free; only writing one is limited. A dashboard refresh
    must not burn a member's allowance."""
    _clear("personal_tip")
    assert member_client.post("/api/v1/members/me/health-permission/grant").status_code == 200
    for _ in range(LIMITS["personal_tip"].per_subject + 5):
        assert member_client.get(TIP).status_code == 200

    db = SessionLocal()
    try:
        spent = db.query(RateLimitEvent).filter(RateLimitEvent.bucket == "personal_tip").count()
    finally:
        db.close()
    assert spent <= 1, f"a cached read spent {spent} of the allowance"


# ---- mail to an address the caller typed ------------------------------------

def test_sign_up_cannot_be_used_to_post_mail_to_strangers(client):
    _clear("signup")
    allowed = LIMITS["signup"].per_subject
    for index in range(allowed):
        assert sign_up(client, email=f"flood{index}@demo.veye.test", first_name="F").status_code == 201
    refused = sign_up(client, email="flood-last@demo.veye.test", first_name="F")
    assert refused.status_code == 429
    assert refused.headers.get("Retry-After")


def test_a_reset_limit_never_records_the_address_that_was_typed(client):
    """A table of probed addresses is exactly what this must not become."""
    _clear("forgot_password")
    for _ in range(3):
        client.post("/api/v1/auth/forgot-password", json={"email": "somebody@example.com"})
    db = SessionLocal()
    try:
        subjects = [r.subject for r in db.query(RateLimitEvent)
                    .filter(RateLimitEvent.bucket == "forgot_password").all()]
    finally:
        db.close()
    assert subjects, "nothing was recorded"
    assert all("somebody@example.com" not in s for s in subjects)
    assert all(s.startswith("ip:") for s in subjects)


def test_the_public_contact_form_is_limited(client):
    _clear("public_request")
    allowed = LIMITS["public_request"].per_subject
    for index in range(allowed):
        answer = client.post("/api/v1/requests", json={"kind": "contact_us", "name": "Visitor",
                                                       "message": f"Message {index}"})
        assert answer.status_code == 201
    refused = client.post("/api/v1/requests", json={"kind": "contact_us", "name": "Visitor",
                                                    "message": "One too many"})
    assert refused.status_code == 429


# ---- the storage itself -------------------------------------------------------

def test_the_counter_is_in_the_database_so_several_instances_share_it():
    """A limiter in a process limits one instance. Cloud Run runs several, and
    ten instances would mean ten times the limit, which is not a limit."""
    first = SessionLocal()
    second = SessionLocal()
    try:
        _clear("public_request")
        limit = LIMITS["public_request"].per_subject
        for _ in range(limit):
            RateLimiter(first).record("public_request", subject="ip:203.0.113.9")
        first.commit()
        # A different session — standing in for a different instance — sees it.
        assert RateLimiter(second).check("public_request", subject="ip:203.0.113.9") is not None
    finally:
        first.close()
        second.close()


def test_housekeeping_removes_old_events_because_none_of_it_is_evidence():
    db = SessionLocal()
    try:
        _clear("public_request")
        RateLimiter(db).record("public_request", subject="ip:198.51.100.4")
        db.commit()
        _age_events("public_request", 60 * 72)
        removed = prune_rate_limit_events(db, older_than_hours=48)
        db.commit()
        assert removed >= 1
        assert RateLimiter(db).check("public_request", subject="ip:198.51.100.4") is None
    finally:
        db.close()


def test_an_unknown_bucket_is_not_silently_unlimited():
    """`enforce` on a bucket nobody declared does nothing, which is the right
    behaviour only because adding a limit is a deliberate act. The test exists
    so that a typo in a bucket name is visible here rather than in production."""
    assert set(LIMITS) == {
        "companion_message", "personal_tip", "signup", "forgot_password",
        "resend_verification", "public_request", "photo_upload",
    }
    for name, limit in LIMITS.items():
        assert limit.bucket == name, f"{name} declares itself as {limit.bucket}"
        assert limit.per_subject > 0 and limit.window_minutes > 0


def test_the_scale_raises_a_limit_for_an_environment_but_can_never_lower_one(member_client):
    """A development stack and the acceptance suite produce more traffic from
    one address than any person would. The same limits apply, scaled — there
    is deliberately no way to switch them off."""
    from app.core.config import Settings

    db = SessionLocal()
    try:
        base = RateLimiter(db, Settings(database_url="sqlite:///unused", rate_limit_scale=1.0))
        raised = RateLimiter(db, Settings(database_url="sqlite:///unused", rate_limit_scale=50))
        lowered = RateLimiter(db, Settings(database_url="sqlite:///unused", rate_limit_scale=0.0))
        assert base._allowance(10) == 10
        assert raised._allowance(10) == 500
        # Below 1 is clamped, so a misconfiguration cannot tighten the limit to
        # nothing and lock everybody out either.
        assert lowered._allowance(10) == 10
    finally:
        db.close()
