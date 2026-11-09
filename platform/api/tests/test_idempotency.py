"""A retried POST must not do the expensive thing twice.

The two endpoints that matter are the admin reply, which sends an email to a
member, and the Companion message, which pays for a model call. In both cases
the assertion that counts is not the status code — it is that the side effect
happened once.
"""

from __future__ import annotations

from uuid import UUID

import pytest
from fastapi.testclient import TestClient

from app.core.idempotency import Idempotency, IdempotencyRecord, Replay, prune_idempotency_records
from app.db.session import SessionLocal
from app.main import app
from tests.conftest import sign_up

ASK = "/api/v1/companion/messages"


def _reply(admin_client, request_id: str, body: str, key: str | None = None):
    payload = {"body": body}
    if key is not None:
        payload["idempotency_key"] = key
    return admin_client.post(f"/api/v1/admin/requests/{request_id}/reply", json=payload)


# ---- the admin reply: one email, not two ------------------------------------

def test_a_retried_reply_sends_one_email_and_writes_one_reply(member_client, admin_client, mailbox):
    sent = member_client.post("/api/v1/members/me/requests",
                              json={"kind": "contact_us", "subject": "Q", "message": "A question"})
    request_id = sent.json()["id"]
    before = len(mailbox.sent)

    first = _reply(admin_client, request_id, "Here is the answer.", key="reply-key-0001")
    assert first.status_code == 200
    assert len(first.json()["replies"]) == 1
    assert len(mailbox.sent) == before + 1

    # The same key again: the browser retried, the proxy replayed, the
    # administrator double-clicked. Any of those.
    again = _reply(admin_client, request_id, "Here is the answer.", key="reply-key-0001")
    assert again.status_code == 200
    assert len(again.json()["replies"]) == 1, "a retry wrote a second reply"
    assert len(mailbox.sent) == before + 1, "a retry sent a second email"


def test_a_different_key_is_a_different_reply(member_client, admin_client, mailbox):
    sent = member_client.post("/api/v1/members/me/requests", json={"kind": "contact_us", "message": "A question"})
    request_id = sent.json()["id"]
    before = len(mailbox.sent)

    assert _reply(admin_client, request_id, "First answer.", key="reply-key-0001").status_code == 200
    second = _reply(admin_client, request_id, "A follow-up.", key="reply-key-0002")
    assert second.status_code == 200
    assert len(second.json()["replies"]) == 2
    assert len(mailbox.sent) == before + 2


def test_without_a_key_the_old_behaviour_is_unchanged(member_client, admin_client, mailbox):
    """No key means no protection, but no new failure mode either."""
    sent = member_client.post("/api/v1/members/me/requests", json={"kind": "contact_us", "message": "A question"})
    request_id = sent.json()["id"]
    assert _reply(admin_client, request_id, "One.").status_code == 200
    assert _reply(admin_client, request_id, "Two.").status_code == 200
    assert len(admin_client.get(f"/api/v1/admin/requests/{request_id}").json()["replies"]) == 2


# ---- the Companion message: one model call, not two -------------------------

def test_a_retried_message_pays_for_one_model_call(member_client):
    from app.companion.providers.llm import MockLLMProvider
    from app.core.runtime import configure_runtime, get_runtime

    counting = MockLLMProvider()
    before = get_runtime().llm
    configure_runtime(llm=counting)
    try:
        first = member_client.post(ASK, json={"message": "What is a Health Number?",
                                              "idempotency_key": "ask-key-0001"})
        assert first.status_code == 201, first.text
        calls = len(counting.requests)
        assert calls >= 1

        again = member_client.post(ASK, json={"message": "What is a Health Number?",
                                              "idempotency_key": "ask-key-0001"})
        assert again.status_code == 201
        assert len(counting.requests) == calls, "a retry paid for a second model call"
        assert again.json()["reply"] == first.json()["reply"]
    finally:
        configure_runtime(llm=before)


def test_a_retried_message_does_not_appear_twice_in_the_conversation(member_client):
    first = member_client.post(ASK, json={"message": "Tell me about mood", "idempotency_key": "ask-key-0002"})
    assert first.status_code == 201
    conversation_id = first.json()["conversation_id"]
    member_client.post(ASK, json={"message": "Tell me about mood", "idempotency_key": "ask-key-0002"})

    from app.companion.models import CompanionMessage

    db = SessionLocal()
    try:
        mine = (db.query(CompanionMessage)
                .filter(CompanionMessage.conversation_id == UUID(conversation_id),
                        CompanionMessage.role == "member",
                        CompanionMessage.content == "Tell me about mood").count())
    finally:
        db.close()
    assert mine == 1, "the member's own message was recorded twice"


def test_one_members_key_never_hands_back_anothers_answer(member_client):
    """A key is private to its claimant. Replaying somebody else's is a new
    operation, not a window onto their conversation."""
    assert member_client.post(ASK, json={"message": "Mine", "idempotency_key": "shared-key-0001"}).status_code == 201

    other = TestClient(app)
    assert sign_up(other, email="keythief@demo.veye.test", first_name="Key").status_code == 201
    theirs = other.post(ASK, json={"message": "Mine", "idempotency_key": "shared-key-0001"})
    # Either a fresh answer of their own, or a refusal — never the first
    # member's reply.
    assert theirs.status_code in (201, 404, 409)
    if theirs.status_code == 201:
        assert theirs.json()["conversation_id"] != member_client.post(
            ASK, json={"message": "again"}).json()["conversation_id"]


# ---- the claim ordering -------------------------------------------------------

def test_the_claim_is_taken_before_the_work_so_a_race_cannot_double_up():
    """Writing the record afterwards would let two concurrent attempts both
    find nothing, both do the work, and only then collide — by which point two
    emails have gone."""
    first = SessionLocal()
    second = SessionLocal()
    try:
        Idempotency(first).claim("request_reply", "race-key-0001", subject="admin-1")
        first.commit()
        # A second attempt, from another worker, before the first finishes.
        with pytest.raises(Exception) as refused:
            Idempotency(second).claim("request_reply", "race-key-0001", subject="admin-1")
        assert getattr(refused.value, "status_code", None) == 409
    finally:
        first.close()
        second.close()


def test_once_the_first_attempt_finishes_a_replay_gets_its_result():
    db = SessionLocal()
    try:
        idem = Idempotency(db)
        idem.claim("request_reply", "done-key-0001", subject="admin-1")
        idem.complete("request_reply", "done-key-0001", "the-reply-id")
        db.commit()
        with pytest.raises(Replay) as replay:
            idem.claim("request_reply", "done-key-0001", subject="admin-1")
        assert replay.value.entity_id == "the-reply-id"
    finally:
        db.close()


def test_the_same_key_on_a_different_endpoint_is_a_different_operation():
    db = SessionLocal()
    try:
        idem = Idempotency(db)
        idem.claim("request_reply", "scoped-key-0001", subject="admin-1")
        idem.complete("request_reply", "scoped-key-0001", "a")
        db.commit()
        # Same key, other scope: no collision.
        idem.claim("companion_message", "scoped-key-0001", subject="member-1")
        db.commit()
    finally:
        db.close()


def test_a_malformed_key_is_refused_rather_than_stored():
    db = SessionLocal()
    try:
        for bad in ("short", "x" * 200, "has spaces", "<script>alert(1)</script>"):
            with pytest.raises(Exception) as refused:
                Idempotency(db).claim("request_reply", bad, subject="admin-1")
            assert getattr(refused.value, "status_code", None) == 422
    finally:
        db.close()


def test_only_the_id_is_kept_never_the_members_words(member_client, admin_client):
    """Re-rendering from the entity keeps the answer current and avoids a
    second copy of a member's words in a table nobody reads."""
    sent = member_client.post("/api/v1/members/me/requests",
                              json={"kind": "contact_us", "message": "Something private"})
    _reply(admin_client, sent.json()["id"], "A distinctive answer about nothing.", key="kept-key-0001")

    db = SessionLocal()
    try:
        rows = db.query(IdempotencyRecord).all()
        blob = " ".join(f"{r.scope}{r.idempotency_key}{r.subject}{r.entity_id}" for r in rows)
    finally:
        db.close()
    assert "Something private" not in blob
    assert "A distinctive answer" not in blob


def test_housekeeping_closes_the_replay_window():
    from datetime import datetime, timedelta, timezone

    db = SessionLocal()
    try:
        idem = Idempotency(db)
        idem.claim("request_reply", "old-key-0001", subject="admin-1")
        idem.complete("request_reply", "old-key-0001", "x")
        db.commit()
        for row in db.query(IdempotencyRecord).all():
            row.created_at = datetime.now(timezone.utc) - timedelta(hours=96)
        db.commit()
        assert prune_idempotency_records(db, older_than_hours=48) >= 1
        db.commit()
        # The key is free again, which is correct: the window has closed.
        idem.claim("request_reply", "old-key-0001", subject="admin-1")
    finally:
        db.close()


# ---- the Personal Tip's own race ---------------------------------------------

def test_two_first_requests_for_a_tip_do_not_collide(member_client):
    """One row per member, and two first requests can arrive at once. The loser
    re-reads the winner's row instead of failing the dashboard."""
    from app.companion.models import MemberPersonalTip
    from app.companion.personal_tip import PersonalTipService

    assert member_client.post("/api/v1/members/me/health-permission/grant").status_code == 200
    from datetime import date, timedelta

    today = date.today()
    for offset in range(4):
        day = (today - timedelta(days=offset)).isoformat()
        member_client.put("/api/v1/members/me/mood", params={"today": today.isoformat()},
                          json={"entry_date": day, "mood": "calm"})

    account = member_client.account

    first = SessionLocal()
    second = SessionLocal()
    try:
        from app.auth.models import UserAccount
        from app.auth.provider import principal_for

        user = first.query(UserAccount).filter(UserAccount.email == account["email"]).one()
        principal = principal_for(user, None, portal="member")

        # The offline mock answers like a chat, which the tip's shape check
        # rightly rejects — so no row would be written and there would be no
        # race to test. This one writes something that is actually a tip.
        class Tipper:
            name = "tipper"

            def complete(self, request):
                from app.companion.providers.llm import LLMResponse

                return LLMResponse(text="You have logged your mood on most days this month.",
                                   provider=self.name, model="tipper")

            def describe(self):
                return {"provider": self.name}

        llm = Tipper()

        a = PersonalTipService(first, llm).get(principal)
        first.commit()
        assert a.generated, f"no tip was written, so there is no race to test: {a.text!r}"
        b = PersonalTipService(second, llm).get(principal)
        second.commit()
        assert a.text and b.text

        check = SessionLocal()
        try:
            rows = check.query(MemberPersonalTip).filter(
            MemberPersonalTip.member_id == principal.member_id).count()
        finally:
            check.close()
        assert rows == 1, "a second tip row was created for one member"
    finally:
        first.close()
        second.close()
