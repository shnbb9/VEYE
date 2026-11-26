"""A new request tells the team that it arrived, and only that.

Owner, 26 Nov 2026: a customer's Contact Us message, Help question or Join Beta
request reached nobody until somebody happened to open the console. Each new
one now emails the support address kept in Settings -> Product settings. The
email says that one arrived and links to it; who wrote and what they wrote stay
in the console."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from app.core.rate_limit import LIMITS, RateLimitEvent
from app.core.runtime import configure_runtime, get_runtime
from app.db.session import SessionLocal
from app.notifications.email import NoEmailProvider
from app.notifications.service import NotificationService

PUBLIC = "/api/v1/requests"
MINE = "/api/v1/members/me/requests"
PRIVATE = "my glucose was 212 this morning"
SUPPORT = "contact@veye.co"


def _team(mailbox, to: str = SUPPORT) -> list:
    return [m for m in mailbox.sent if m.to == to]


def _everything(email) -> str:
    return f"{email.subject}\n{email.text}\n{email.html}".lower()


def test_a_visitors_message_tells_the_team_it_arrived_and_nothing_of_what_it_says(client, admin_client, mailbox):
    before = len(_team(mailbox))
    asked = client.post(PUBLIC, json={"kind": "contact_us", "name": "Robin Fox", "email": "robin@demo.veye.test",
                                      "subject": "Glucose", "message": f"Hello, {PRIVATE}.", "page": "/contact"})
    assert asked.status_code == 201, asked.text
    request_id = asked.json()["id"]

    told = _team(mailbox)[before:]
    assert len(told) == 1, "one email to the team for one request"
    email = told[0]
    assert email.subject == "Veye: a new Contact Us message"
    assert f"/admin/requests?id={request_id}" in email.text and f"/admin/requests?id={request_id}" in email.html
    assert "a visitor to the website" in email.text
    for private in ("robin", "fox", "robin@demo.veye.test", "glucose", "212", "/contact"):
        assert private not in _everything(email), private

    notice = admin_client.get(f"/api/v1/admin/requests/{request_id}").json()["team_notice"]
    assert notice["status"] == "sent" and notice["to_email"] == SUPPORT and notice["sent_at"] and notice["detail"] is None


def test_a_members_help_question_tells_the_team_once_and_the_console_list_says_so(member_client, admin_client, mailbox):
    before = len(_team(mailbox))
    asked = member_client.post(MINE, json={"kind": "help_question", "subject": "Insulin", "message": PRIVATE})
    assert asked.status_code == 201, asked.text

    told = _team(mailbox)[before:]
    assert [m.subject for m in told] == ["Veye: a new Help question"]
    assert "a signed-in member" in told[0].text
    for private in ("aditya", "demo.veye.test", "insulin", "glucose", "212"):
        assert private not in _everything(told[0]), private

    rows = admin_client.get("/api/v1/admin/requests", params={"view": "all", "page_size": 100}).json()["rows"]
    row = next(r for r in rows if r["id"] == asked.json()["id"])
    assert row["team_notice"]["status"] == "sent"
    # Moving it, labelling it or answering it keeps the record on screen.
    moved = admin_client.post(f"/api/v1/admin/requests/{row['id']}/status", json={"status": "in_progress", "resolution_note": ""})
    assert moved.json()["team_notice"]["status"] == "sent"
    labelled = admin_client.put(f"/api/v1/admin/requests/{row['id']}/priority", json={"priority": "high"})
    assert labelled.json()["team_notice"]["status"] == "sent"
    answered = admin_client.post(f"/api/v1/admin/requests/{row['id']}/reply", json={"body": "We will look at it today."})
    assert answered.json()["team_notice"]["status"] == "sent"


def test_a_join_beta_request_already_open_is_not_announced_again(member_client, mailbox):
    before = len(_team(mailbox))
    first = member_client.post(MINE, json={"kind": "join_beta"})
    again = member_client.post(MINE, json={"kind": "join_beta"})
    assert first.status_code == again.status_code == 201
    assert again.json()["already_open"] is True and again.json()["id"] == first.json()["id"]
    assert [m.subject for m in _team(mailbox)[before:]] == ["Veye: a new Join Beta request"]


def test_the_email_goes_to_the_support_address_the_console_keeps(client, admin_client, mailbox):
    moved = admin_client.put("/api/v1/admin/settings/product", json={"support_email": "help@demo.veye.test", "support_phone": ""})
    assert moved.status_code == 200, moved.text
    before = len(_team(mailbox, "help@demo.veye.test"))
    client.post(PUBLIC, json={"kind": "help_question", "name": "Visitor", "message": "Where is My Progress?"})
    assert len(_team(mailbox, "help@demo.veye.test")) == before + 1


def test_a_refused_send_is_kept_shown_and_sent_later(client, admin_client, mailbox):
    runtime = get_runtime()
    configure_runtime(email=NoEmailProvider())
    try:
        asked = client.post(PUBLIC, json={"kind": "contact_us", "name": "Visitor", "message": "Is anybody there?"})
    finally:
        configure_runtime(email=runtime.email)
    assert asked.status_code == 201, "the visitor is answered whatever the mail server does"
    request_id = asked.json()["id"]
    notice = admin_client.get(f"/api/v1/admin/requests/{request_id}").json()["team_notice"]
    assert notice["status"] == "retry" and notice["detail"] and notice["sent_at"] is None, notice

    before = len(_team(mailbox))
    with SessionLocal() as db:
        NotificationService(db, get_runtime().email).dispatch_due(now=datetime.now(timezone.utc) + timedelta(minutes=2))
    assert len(_team(mailbox)) == before + 1
    assert admin_client.get(f"/api/v1/admin/requests/{request_id}").json()["team_notice"]["status"] == "sent"
    with SessionLocal() as db:   # and never twice
        NotificationService(db, get_runtime().email).dispatch_due(now=datetime.now(timezone.utc) + timedelta(hours=3))
    assert len(_team(mailbox)) == before + 1


def test_the_member_never_sees_the_consoles_record_of_it(member_client):
    member_client.post(MINE, json={"kind": "contact_us", "message": "Anything there?"})
    mine = member_client.get(MINE).json()
    assert mine and "team_notice" not in mine[0]


def test_a_members_requests_are_limited_now_that_each_one_emails_the_team(member_client):
    with SessionLocal() as db:
        db.query(RateLimitEvent).filter(RateLimitEvent.bucket == "member_request").delete()
        db.commit()
    for index in range(LIMITS["member_request"].per_subject):
        assert member_client.post(MINE, json={"kind": "contact_us", "message": f"Question {index}"}).status_code == 201
    assert member_client.post(MINE, json={"kind": "contact_us", "message": "One too many"}).status_code == 429
