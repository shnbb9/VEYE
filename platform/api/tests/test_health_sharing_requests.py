"""Asking to share, telling the member they were asked, and recording the
decision against the exact words shown (architecture V2 §4).

The four facts V2 keeps apart are tested apart here: an emailed link is not a
decision, a session is not a verified address, an administrator session is not
a member session, and a decision against old terms is not a decision against
the new ones.
"""

from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.core.runtime import configure_runtime, get_runtime
from app.db.session import SessionLocal
from app.health_permission.models import MemberHealthPermissionEvent
from app.main import app
from app.notifications.email import DeliveryResult
from app.notifications.models import Notification, NotificationOutbox
from app.policies.models import PlatformPolicyVersion
from tests.conftest import decide_sharing, sign_up, verify_member_email

PASSWORD = "SharingAsk!2026-local"
SUBJECT = "VEYE: Review a request to share your health information"


class Clock:
    def __init__(self) -> None:
        self.now = datetime.now(timezone.utc)

    def __call__(self) -> datetime:
        return self.now

    def advance(self, **delta) -> None:
        self.now += timedelta(**delta)


def member(email: str, *, verified: bool = True) -> TestClient:
    http = TestClient(app)
    http.__enter__()
    created = sign_up(http, email=email, password=PASSWORD)
    assert created.status_code == 201, created.text
    if verified:
        verify_member_email(http)
    http.member_id = created.json()["account"]["member_id"]
    return http


def requests_to(mailbox, address: str):
    return [m for m in mailbox.sent if m.to == address and "/app/settings?section=privacy&request=" in m.text]


def ref_from(message) -> str:
    return re.search(r"request=([A-Za-z0-9_\-]+)", message.text).group(1)


def ask(admin_client, member_id: str, reason: str | None = None):
    return admin_client.post(f"/api/v1/admin/members/{member_id}/health-permission/request",
                             json={"reason": reason} if reason else {})


# ---- the manual request and its email ------------------------------------------------------

def test_a_manual_request_is_recorded_and_emailed_once_after_commit(admin_client, mailbox):
    m = member("ask.manual@demo.veye.test")
    asked = ask(admin_client, m.member_id)
    assert asked.status_code == 200, asked.text
    body = asked.json()
    assert body["state"] == "requested" and body["delivery"]["status"] == "sent"
    [message] = requests_to(mailbox, "ask.manual@demo.veye.test")
    assert message.subject == SUBJECT
    assert message.from_name == "VEYE Team"
    assert "Review sharing request" in message.text and "does not share anything" in message.text
    # The link identifies a request; it is not a credential and carries no health data.
    assert re.search(r"/app/settings\?section=privacy&request=[A-Za-z0-9_\-]{20,}", message.text)
    # The default wording names no instrument and no value.
    assert "Health Number" not in message.text and "displayed_score" not in message.text
    with SessionLocal() as db:
        outbox = db.query(NotificationOutbox).filter(NotificationOutbox.to_email == "ask.manual@demo.veye.test").all()
        assert [o.status for o in outbox if o.notification.kind == "health_sharing_request"] == ["sent"]


def test_an_unverified_member_cannot_be_asked(admin_client, mailbox):
    m = member("ask.unverified@demo.veye.test", verified=False)
    view = admin_client.get(f"/api/v1/admin/members/{m.member_id}/health-permission").json()
    assert view["can_request"] is False and "verified" in view["cannot_request_reason"]
    refused = ask(admin_client, m.member_id)
    assert refused.status_code == 409
    assert requests_to(mailbox, "ask.unverified@demo.veye.test") == []
    # The positive control: once verified, the same ask works.
    verify_member_email(m)
    assert ask(admin_client, m.member_id).status_code == 200


def test_asking_again_waits_for_the_resend_interval(admin_client, mailbox):
    clock = Clock()
    configure_runtime(clock=clock)
    m = member("ask.again@demo.veye.test")
    assert ask(admin_client, m.member_id).status_code == 200
    too_soon = ask(admin_client, m.member_id)
    assert too_soon.status_code == 409 and "ask again after" in too_soon.json()["detail"]
    clock.advance(hours=73)
    assert ask(admin_client, m.member_id).status_code == 200
    assert len(requests_to(mailbox, "ask.again@demo.veye.test")) == 2


def test_after_a_no_a_new_ask_needs_a_stated_reason(admin_client, mailbox):
    m = member("ask.declined@demo.veye.test")
    ask(admin_client, m.member_id)
    assert decide_sharing(m, "decline").status_code == 200
    view = admin_client.get(f"/api/v1/admin/members/{m.member_id}/health-permission").json()
    assert view["requires_reason"] is True and view["can_request"] is True
    assert ask(admin_client, m.member_id).status_code == 422
    assert ask(admin_client, m.member_id, "too short").status_code == 422
    asked = ask(admin_client, m.member_id, "They asked us to review their blood markers with them")
    assert asked.status_code == 200
    notes = [e["note"] for e in asked.json()["events"] if e["to_state"] == "requested"]
    assert notes[-1] == "They asked us to review their blood markers with them"


def test_an_unknown_member_id_is_not_found_rather_than_created(admin_client):
    stranger = uuid4()
    assert admin_client.get(f"/api/v1/admin/members/{stranger}/health-permission").status_code == 404
    assert ask(admin_client, str(stranger)).status_code == 404


# ---- the link opens the app; it decides nothing --------------------------------------------

def test_the_emailed_link_only_identifies_the_request(admin_client, mailbox):
    m = member("ask.link@demo.veye.test")
    ask(admin_client, m.member_id)
    ref = ref_from(requests_to(mailbox, "ask.link@demo.veye.test")[-1])
    opened = m.get(f"/api/v1/members/me/health-permission/request/{ref}")
    assert opened.status_code == 200, opened.text
    data = opened.json()
    assert data["state"] == "requested", "opening the request must not change anything"
    assert data["terms"]["categories"] and data["terms"]["expiry_rule"] and data["terms"]["withdrawal"]
    assert data["open_request"]["ref"] == ref
    # Anonymous, the console, and another member: none of them get anywhere.
    assert TestClient(app).get(f"/api/v1/members/me/health-permission/request/{ref}").status_code == 401
    assert admin_client.get(f"/api/v1/members/me/health-permission/request/{ref}").status_code == 401
    other = member("ask.other@demo.veye.test")
    # The other member has an open request of their own, so only the reference
    # check — not "no request at all" — stands between them and this one.
    ask(admin_client, other.member_id)
    assert other.get(f"/api/v1/members/me/health-permission/request/{ref}").status_code == 404
    assert other.post("/api/v1/members/me/health-permission/grant", json={
        "terms_version": data["terms"]["version"], "terms_hash": data["terms"]["hash"], "request_ref": ref}).status_code == 404
    # Still undecided: only the member's own deliberate choice changes it.
    assert admin_client.get(f"/api/v1/admin/members/{m.member_id}/health-permission").json()["state"] == "requested"
    granted = decide_sharing(m, request_ref=ref)
    assert granted.status_code == 200 and granted.json()["shares_health_data"] is True
    # The request is closed now; the link no longer leads to anything.
    assert m.get(f"/api/v1/members/me/health-permission/request/{ref}").status_code == 404


def test_a_decision_records_the_exact_terms_and_needs_a_verified_address(admin_client):
    m = member("ask.terms@demo.veye.test", verified=False)
    terms = m.get("/api/v1/members/me/health-permission").json()["terms"]
    unverified = m.post("/api/v1/members/me/health-permission/grant",
                        json={"terms_version": terms["version"], "terms_hash": terms["hash"]})
    assert unverified.status_code == 409 and "verify" in unverified.json()["detail"].lower()
    verify_member_email(m)
    stale = m.post("/api/v1/members/me/health-permission/grant",
                   json={"terms_version": terms["version"], "terms_hash": "0" * 64})
    assert stale.status_code == 409
    assert m.post("/api/v1/members/me/health-permission/grant", json={}).status_code == 422, "a decision states its terms"
    ok = m.post("/api/v1/members/me/health-permission/grant",
                json={"terms_version": terms["version"], "terms_hash": terms["hash"]})
    assert ok.status_code == 200
    [event] = [e for e in ok.json()["events"] if e["to_state"] == "granted"]
    assert event["terms_hash"] == terms["hash"] and event["terms_version"] == terms["version"]
    assert event["scope"] == terms["categories"] and event["purpose"] == terms["purpose"]
    assert event["recipient"] == terms["recipient"] and event["expiry_rule"] == terms["expiry_rule"]


def test_withdrawing_never_waits_on_verification_or_terms(admin_client):
    m = member("ask.withdraw@demo.veye.test")
    decide_sharing(m)
    assert m.post("/api/v1/members/me/health-permission/revoke").status_code == 200


# ---- automatic mode ----------------------------------------------------------------------------

def test_automatic_mode_asks_once_after_verification_and_never_before(admin_client, mailbox):
    existing = member("ask.existing@demo.veye.test")  # verified BEFORE automatic mode exists
    published = admin_client.put("/api/v1/admin/settings/health-sharing/notification",
                                 json={"mode": "automatic", "resend_interval_hours": 72, "sender_name": "VEYE Team"})
    assert published.status_code == 200, published.text
    assert requests_to(mailbox, "ask.existing@demo.veye.test") == [], "switching on must not mass-email existing members"

    fresh = member("ask.auto@demo.veye.test", verified=False)
    assert requests_to(mailbox, "ask.auto@demo.veye.test") == [], "sign-up alone is not a verified address"
    verify_member_email(fresh)
    [message] = requests_to(mailbox, "ask.auto@demo.veye.test")
    view = admin_client.get(f"/api/v1/admin/members/{fresh.member_id}/health-permission").json()
    assert view["state"] == "requested" and view["events"][-1]["source"] == "automatic"
    # Asking for a second verification link is refused (already verified): no second request either.
    assert fresh.post("/api/v1/auth/resend-verification").status_code == 409
    assert len(requests_to(mailbox, "ask.auto@demo.veye.test")) == 1
    with SessionLocal() as db:
        keys = [n.idempotency_key for n in db.query(Notification).filter(Notification.kind == "health_sharing_request").all()]
    assert [k for k in keys if k and k.startswith("hsr:auto:")] == [f"hsr:auto:{fresh.member_id}:1"]


def test_manual_mode_sends_nothing_on_verification(admin_client, mailbox):
    m = member("ask.manualmode@demo.veye.test")
    assert requests_to(mailbox, "ask.manualmode@demo.veye.test") == []
    assert admin_client.get(f"/api/v1/admin/members/{m.member_id}/health-permission").json()["state"] == "not_requested"


# ---- delivery failure is visible and retryable ------------------------------------------------------

def test_a_refused_email_is_shown_as_failed_and_can_be_sent_again(admin_client, mailbox):
    m = member("ask.outage@demo.veye.test")

    class Down:
        name = "down"

        def send(self, message):
            return DeliveryResult(accepted=False, provider="down", error="relay unreachable")

        def describe(self):
            return {"provider": "down"}

    healthy = get_runtime().email
    configure_runtime(email=Down())
    asked = ask(admin_client, m.member_id)
    assert asked.status_code == 200
    assert asked.json()["state"] == "requested", "the request stands even though the email did not go"
    assert asked.json()["delivery"]["status"] == "retry" and asked.json()["delivery"]["last_error"] == "relay unreachable"
    configure_runtime(email=healthy)
    resent = admin_client.post(f"/api/v1/admin/members/{m.member_id}/health-permission/resend")
    assert resent.status_code == 200 and resent.json()["delivery"]["status"] == "sent"
    assert len(requests_to(mailbox, "ask.outage@demo.veye.test")) == 1
    # Nothing left to retry now.
    assert admin_client.post(f"/api/v1/admin/members/{m.member_id}/health-permission/resend").status_code == 409


# ---- the editable template and terms ------------------------------------------------------------

DOC = {"blocks": [{"type": "paragraph", "children": [{"type": "text", "text": "Hi {{first_name}}, <script>alert(1)</script>", "marks": ["bold"]}]},
                  {"type": "bullet_list", "items": [[{"type": "link", "href": "https://veye.example/privacy", "children": [{"type": "text", "text": "Privacy", "marks": []}]}]]}]}


def test_template_markup_is_generated_and_typed_markup_is_only_ever_text(admin_client):
    preview = admin_client.post("/api/v1/admin/settings/health-sharing/template/preview",
                                json={"subject": "Hello {{first_name}}", "body": DOC})
    assert preview.status_code == 200, preview.text
    html = preview.json()["html"]
    assert "<script>" not in html and "&lt;script&gt;alert(1)&lt;/script&gt;" in html
    assert "<strong>" in html and 'href="https://veye.example/privacy"' in html
    assert "Hi Cara" in preview.json()["text"]


@pytest.mark.parametrize("bad", [
    {"type": "link", "href": "javascript:alert(1)", "children": [{"type": "text", "text": "x", "marks": []}]},
    {"type": "link", "href": "data:text/html,<b>x</b>", "children": [{"type": "text", "text": "x", "marks": []}]},
    {"type": "link", "href": "http://plain.example", "children": [{"type": "text", "text": "x", "marks": []}]},
    {"type": "link", "href": "//evil.example/x", "children": [{"type": "text", "text": "x", "marks": []}]},
    {"type": "link", "href": "https://user:pass@evil.example/", "children": [{"type": "text", "text": "x", "marks": []}]},
    {"type": "text", "text": "Unknown {{password}}", "marks": []},
    {"type": "text", "text": "bad mark", "marks": ["blink"]},
    {"type": "image", "src": "https://evil.example/pixel.gif"},
])
def test_unsafe_links_unknown_variables_and_foreign_nodes_are_refused(admin_client, bad):
    body = {"blocks": [{"type": "paragraph", "children": [bad]}]}
    refused = admin_client.put("/api/v1/admin/settings/health-sharing/template/draft",
                               json={"subject": SUBJECT, "body": body})
    assert refused.status_code == 422, refused.text
    with SessionLocal() as db:
        assert db.query(PlatformPolicyVersion).count() == 0, "nothing invalid is stored, not even as a draft"


def test_a_published_template_is_what_members_receive_and_old_versions_never_change(admin_client, mailbox):
    body = {"blocks": [{"type": "paragraph", "children": [{"type": "text", "text": "Hello {{first_name}}, a quick question from Veye.", "marks": []}]}]}
    assert admin_client.put("/api/v1/admin/settings/health-sharing/template/draft",
                            json={"subject": "Veye would like to ask you something", "body": body}).status_code == 200
    m = member("ask.template@demo.veye.test")
    ask(admin_client, m.member_id)
    assert requests_to(mailbox, "ask.template@demo.veye.test")[-1].subject == SUBJECT, "a draft is not sent"
    published = admin_client.post("/api/v1/admin/settings/health-sharing/template/publish")
    assert published.status_code == 200 and published.json()["template"]["version"] == 1
    with SessionLocal() as db:
        v1 = db.query(PlatformPolicyVersion).filter(PlatformPolicyVersion.key == "health_sharing_email",
                                                    PlatformPolicyVersion.version == 1).one()
        v1_hash, v1_value = v1.content_hash, dict(v1.value)
    other = member("ask.template2@demo.veye.test")
    ask(admin_client, other.member_id)
    sent = requests_to(mailbox, "ask.template2@demo.veye.test")[-1]
    assert sent.subject == "Veye would like to ask you something" and "Hello Aditya," in sent.text
    # A second version leaves the first exactly as it was.
    admin_client.put("/api/v1/admin/settings/health-sharing/template/draft",
                     json={"subject": "Second wording", "body": body})
    admin_client.post("/api/v1/admin/settings/health-sharing/template/publish")
    with SessionLocal() as db:
        again = db.query(PlatformPolicyVersion).filter(PlatformPolicyVersion.key == "health_sharing_email",
                                                       PlatformPolicyVersion.version == 1).one()
        assert again.content_hash == v1_hash and again.value == v1_value


def test_a_test_email_goes_only_to_the_signed_in_administrator(admin_client, mailbox):
    sent = admin_client.post("/api/v1/admin/settings/health-sharing/template/test",
                             json={"subject": SUBJECT, "body": DOC})
    assert sent.status_code == 200 and sent.json()["to"] == "cara.hogue@demo.veye.test"
    assert [m.to for m in mailbox.sent if m.subject.startswith("[Test]")] == ["cara.hogue@demo.veye.test"]


def test_new_terms_do_not_rewrite_an_earlier_decision(admin_client):
    m = member("ask.newterms@demo.veye.test")
    old_terms = m.get("/api/v1/members/me/health-permission").json()["terms"]
    decide_sharing(m)
    draft = {"summary": {"blocks": [{"type": "paragraph", "children": [{"type": "text", "text": "New summary.", "marks": []}]}]},
             "details": {"blocks": []}, "purpose": "To review your program with you each month.",
             "recipient": "The Veye care team"}
    assert admin_client.put("/api/v1/admin/settings/health-sharing/terms/draft", json=draft).status_code == 200
    preview = admin_client.post("/api/v1/admin/settings/health-sharing/terms/preview", json=draft).json()
    assert preview["material_change"] is True
    assert admin_client.post("/api/v1/admin/settings/health-sharing/terms/publish").status_code == 200
    mine = m.get("/api/v1/members/me/health-permission").json()
    assert mine["current_policy_version"] == "health-sharing-terms-v1"
    assert mine["policy_version"] == old_terms["label"], "the earlier decision keeps the words it was made against"
    [granted] = [e for e in mine["events"] if e["to_state"] == "granted"]
    assert granted["terms_hash"] == old_terms["hash"] and granted["purpose"] == old_terms["purpose"]
    # Deciding again with the old terms is refused; the new ones are accepted.
    m.post("/api/v1/members/me/health-permission/revoke")
    assert m.post("/api/v1/members/me/health-permission/grant",
                  json={"terms_version": old_terms["version"], "terms_hash": old_terms["hash"]}).status_code == 409
    assert decide_sharing(m).status_code == 200
    with SessionLocal() as db:
        latest = (db.query(MemberHealthPermissionEvent).filter(MemberHealthPermissionEvent.to_state == "granted")
                  .order_by(MemberHealthPermissionEvent.created_at.desc()).first())
        assert latest.recipient == "The Veye care team" and latest.terms_version == 1


def test_withdrawing_keeps_the_terms_the_decision_was_made_under(admin_client):
    """A withdrawal is not a decision on any terms. It used to stamp the
    built-in v0 label on the row, so once an administrator had published terms
    every member who withdrew was told they had "decided against an earlier
    version of the terms" — found by the V2 prototype comparison."""
    draft = {"summary": {"blocks": [{"type": "paragraph", "children": [{"type": "text", "text": "Published summary.", "marks": []}]}]},
             "details": {"blocks": []}, "purpose": "To review your program with you each month.",
             "recipient": "The Veye care team"}
    assert admin_client.put("/api/v1/admin/settings/health-sharing/terms/draft", json=draft).status_code == 200
    admin_client.post("/api/v1/admin/settings/health-sharing/terms/preview", json=draft)
    assert admin_client.post("/api/v1/admin/settings/health-sharing/terms/publish").status_code == 200

    m = member("withdraw.terms@demo.veye.test")
    assert decide_sharing(m).status_code == 200
    shared = m.get("/api/v1/members/me/health-permission").json()
    assert shared["policy_version"] == shared["current_policy_version"] == "health-sharing-terms-v1"

    assert m.post("/api/v1/members/me/health-permission/revoke").status_code == 200
    after = m.get("/api/v1/members/me/health-permission").json()
    assert after["state"] == "revoked"
    assert after["policy_version"] == "health-sharing-terms-v1", "the row keeps the terms the member decided under"
    assert after["policy_version"] == after["current_policy_version"], "nothing about older terms to say"
    [withdrawal] = [e for e in after["events"] if e["to_state"] == "revoked"]
    assert withdrawal["policy_version"] == "health-sharing-terms-v1", "the event names the terms in force"


def test_locked_elements_cannot_be_edited_away(admin_client):
    draft = {"summary": {"blocks": []}, "details": {"blocks": []}, "purpose": "x", "recipient": "y",
             "categories": ["nothing"]}
    assert admin_client.put("/api/v1/admin/settings/health-sharing/terms/draft", json=draft).status_code == 422
    blank = {"summary": {"blocks": []}, "details": {"blocks": []}, "purpose": "Help", "recipient": "Team"}
    assert admin_client.put("/api/v1/admin/settings/health-sharing/terms/draft", json=blank).status_code == 422
    settings_view = admin_client.get("/api/v1/admin/settings/health-sharing").json()
    assert settings_view["terms"]["locked"]["categories"]
