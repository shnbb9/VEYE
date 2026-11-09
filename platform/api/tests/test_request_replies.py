"""Replying to a request from the console.

The product rule: an administrator can answer the person who wrote in, the
answer is emailed to the address on that request, and the request keeps a
true record of what was sent — including a send that failed.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app
from tests.conftest import sign_up


def _reply(admin_client, request_id: str, body: str):
    return admin_client.post(f"/api/v1/admin/requests/{request_id}/reply", json={"body": body})


def test_an_administrator_answers_a_member_and_the_member_sees_it(member_client, admin_client, mailbox):
    sent = member_client.post("/api/v1/members/me/requests",
                              json={"kind": "contact_us", "subject": "History question",
                                    "message": "Is my first Health Number kept when I retake it?"})
    assert sent.status_code == 201
    request_id = sent.json()["id"]

    answered = _reply(admin_client, request_id, "Yes — every result you save is kept, and you can see them all in My Progress.")
    assert answered.status_code == 200, answered.text
    replies = answered.json()["replies"]
    assert len(replies) == 1
    assert replies[0]["body"].startswith("Yes")
    assert replies[0]["to_email"] == "aditya.demo@demo.veye.test"
    assert replies[0]["sent_by_name"] == "Cara Hogue"
    assert replies[0]["delivery_status"] == "sent"

    # It really went out, with the administrator's words unaltered.
    message = mailbox.sent[-1]
    assert message.to == "aditya.demo@demo.veye.test"
    assert message.subject == "Veye replied to your message: History question"
    assert "every result you save is kept" in message.text
    # …and it points at the support address the console maintains, not at a
    # no-reply mailbox it would be a lie to invite people to use.
    assert "contact@veye.co" in message.text

    # The member sees the answer against their own request.
    mine = member_client.get("/api/v1/members/me/requests").json()
    assert [r["id"] for r in mine] == [request_id]
    assert mine[0]["replies"][0]["body"].startswith("Yes")


def test_a_public_visitor_is_answered_at_the_address_they_typed(client, admin_client, mailbox):
    asked = client.post("/api/v1/requests", json={"kind": "help_question", "name": "Robert Fox",
                                                  "email": "robert@demo.veye.test",
                                                  "message": "Where do I update a blood marker?", "page": "/help"})
    assert asked.status_code == 201
    request_id = asked.json()["id"]

    answered = _reply(admin_client, request_id, "My Progress → Blood Markers, then Add an entry.")
    assert answered.status_code == 200, answered.text
    assert mailbox.sent[-1].to == "robert@demo.veye.test"
    assert answered.json()["replies"][0]["to_email"] == "robert@demo.veye.test"
    # A visitor has no account, so there is nothing account-scoped to attach:
    # the request itself is the record.
    assert answered.json()["member_id"] is None


def test_a_request_with_no_address_cannot_be_answered(client, admin_client):
    """Contact Us does not force an email address. The console says so rather
    than pretending a reply was sent into the void."""
    asked = client.post("/api/v1/requests", json={"kind": "contact_us", "name": "Anonymous",
                                                  "message": "Just leaving feedback, no reply needed."})
    assert asked.status_code == 201
    refused = _reply(admin_client, asked.json()["id"], "Thank you for the feedback.")
    assert refused.status_code == 409
    assert "no email address" in refused.json()["detail"]


def test_a_failed_send_is_recorded_as_failed(member_client, admin_client):
    """A reply that never left must not look like one that arrived."""
    from app.core.runtime import configure_runtime, get_runtime
    from app.notifications.email import NoEmailProvider

    sent = member_client.post("/api/v1/members/me/requests", json={"kind": "contact_us", "message": "Anything there?"})
    request_id = sent.json()["id"]
    runtime = get_runtime()
    configure_runtime(email=NoEmailProvider())
    try:
        answered = _reply(admin_client, request_id, "We are here.")
        assert answered.status_code == 200, answered.text
        reply = answered.json()["replies"][0]
        assert reply["delivery_status"] == "failed"
        assert reply["delivery_detail"]
    finally:
        configure_runtime(email=runtime.email)


def test_replies_accumulate_in_order_and_never_change_the_status(member_client, admin_client):
    sent = member_client.post("/api/v1/members/me/requests", json={"kind": "contact_us", "message": "First question."})
    request_id = sent.json()["id"]
    assert _reply(admin_client, request_id, "An answer.").status_code == 200
    second = _reply(admin_client, request_id, "One more thing.")
    assert second.status_code == 200
    bodies = [r["body"] for r in second.json()["replies"]]
    assert bodies == ["An answer.", "One more thing."]
    # Moving the request on is a separate, visible decision.
    assert second.json()["status"] == "new"
    moved = admin_client.post(f"/api/v1/admin/requests/{request_id}/status", json={"status": "resolved"})
    assert moved.status_code == 200 and moved.json()["status"] == "resolved"
    assert len(moved.json()["replies"]) == 2


def test_an_empty_reply_is_refused_and_members_cannot_reply_to_anyone(member_client, admin_client):
    sent = member_client.post("/api/v1/members/me/requests", json={"kind": "contact_us", "message": "Hello."})
    request_id = sent.json()["id"]
    assert _reply(admin_client, request_id, " ").status_code == 422
    assert _reply(admin_client, request_id, "x" * 4001).status_code == 422
    # The reply route belongs to the console alone.
    assert member_client.post(f"/api/v1/admin/requests/{request_id}/reply",
                              json={"body": "Replying to myself."}).status_code == 401


def test_a_reply_goes_to_the_address_on_the_request_not_a_later_one(member_client, admin_client, mailbox):
    """The record has to stay true to what was actually sent, so the address
    is captured with the reply."""
    sent = member_client.post("/api/v1/members/me/requests", json={"kind": "contact_us", "message": "Question."})
    request_id = sent.json()["id"]
    assert _reply(admin_client, request_id, "First answer.").status_code == 200
    first_to = mailbox.sent[-1].to

    other = TestClient(app)
    assert sign_up(other, email="maya.demo@demo.veye.test", first_name="Maya").status_code == 201
    # Maya's request is answered at Maya's address; Aditya's reply is untouched.
    hers = other.post("/api/v1/members/me/requests", json={"kind": "contact_us", "message": "Hers."})
    assert _reply(admin_client, hers.json()["id"], "Her answer.").status_code == 200
    assert mailbox.sent[-1].to == "maya.demo@demo.veye.test"

    stored = admin_client.get(f"/api/v1/admin/requests/{request_id}").json()["replies"][0]
    assert stored["to_email"] == first_to == "aditya.demo@demo.veye.test"


def test_the_member_sees_the_answer_but_not_the_consoles_own_record(member_client, admin_client):
    """A reply is written for the member; the handling around it is not. The
    internal note, the administrator's name and the delivery result stay in the
    console — and stay off the wire, so no screen can leak them by accident."""
    sent = member_client.post("/api/v1/members/me/requests",
                              json={"kind": "contact_us", "subject": "Can I export?", "message": "Can I export my results?"})
    request_id = sent.json()["id"]
    assert _reply(admin_client, request_id, "Not yet — it is on the roadmap.").status_code == 200
    assert admin_client.post(f"/api/v1/admin/requests/{request_id}/status",
                             json={"status": "resolved",
                                   "resolution_note": "Told her no; chase Cara about export."}).status_code == 200

    mine = member_client.get("/api/v1/members/me/requests").json()[0]
    assert mine["status_label"] == "Resolved"
    assert mine["replies"][0]["body"] == "Not yet — it is on the roadmap."
    for internal in ("resolution_note", "handled_by", "handled_at"):
        assert internal not in mine
    for internal in ("sent_by_name", "to_email", "delivery_status", "delivery_detail"):
        assert internal not in mine["replies"][0]

    # The console keeps all of it.
    theirs = admin_client.get(f"/api/v1/admin/requests/{request_id}").json()
    assert theirs["resolution_note"].startswith("Told her no")
    assert theirs["replies"][0]["sent_by_name"] == "Cara Hogue"
