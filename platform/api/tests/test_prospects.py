"""A visitor's saved result, end to end (architecture V2 §§2–3).

Each claim here has a positive control beside its refusal, because a refusal
test passes just as happily on a feature that does nothing at all:

  * saving needs an explicit, current consent — and with consent it really
    persists the full questionnaire, sealed, with a score that agrees with the
    calculation;
  * Never means nothing is stored; a finite policy stamps an expiry that only
    ever moves earlier; Forever is chosen on purpose or not at all;
  * an address typed into a form gets nobody anything: an account joins a
    saved result only with a capability AND proof of the address AND a
    verified session — and joining it never duplicates the attempt;
  * expiry is enforced on every read, before the purge job runs, and the purge
    is idempotent;
  * the console sees metadata and never the answers or the number.
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient

from app.assessments.models import HealthNumberAttempt
from app.core.runtime import configure_runtime, get_runtime
from app.db.session import SessionLocal
from app.main import app
from app.prospects.crypto import AnswerCipher, CipherError
from app.prospects.models import ProspectAssessment, ProspectEvent, ProspectToken
from app.prospects.routes import cipher_for
from tests.conftest import sign_up

ANSWERS = {
    "goals": ["Live a Healthier Lifestyle"], "plans": ["Intermittent Fasting"],
    "activity": "Moderate (I exercise 1-3 times a week)", "meditate": "yes",
    "tired": "yes", "gainWeight": "no", "abdomenWeight": "yes",
    "sleepEnough": "no", "sleepWell": "yes", "sleepHours": 6.5,
    "diet": "No preference", "source": "Friends or Family",
}
VISITOR = "visitor.one@demo.veye.test"
PASSWORD = "SavedResult!2026-local"


class Clock:
    def __init__(self) -> None:
        self.now = datetime(2026, 11, 14, 12, 0, tzinfo=timezone.utc)

    def __call__(self) -> datetime:
        return self.now

    def advance(self, **delta) -> None:
        self.now = self.now + timedelta(**delta)


@pytest.fixture
def clock() -> Clock:
    c = Clock()
    configure_runtime(clock=c)
    return c


def visitor() -> TestClient:
    http = TestClient(app)
    http.__enter__()
    return http


def publish(admin_client, mode: str, days: int | None = None, **extra):
    return admin_client.put("/api/v1/admin/settings/privacy", json={"mode": mode, "days": days, **extra})


def capture(http: TestClient, email: str = VISITOR, key: str | None = None, answers: dict | None = None):
    notice = http.get("/api/v1/prospects/policy").json()["notice"]
    assert notice is not None, "saving is not switched on"
    return http.post("/api/v1/prospects/assessment", json={
        "email": email, "answers": answers or ANSWERS,
        "consent": {"agreed": True, "notice_version": notice["version"], "notice_hash": notice["hash"]},
        "idempotency_key": key or f"key-{uuid4().hex}"})


def emailed_token(mailbox, to: str) -> str:
    sent = [m for m in mailbox.sent if m.to == to and "/saved-result?token=" in m.text]
    assert sent, f"no saved-result link was emailed to {to}"
    return re.search(r"/saved-result\?token=([A-Za-z0-9_\-]+)", sent[-1].text).group(1)


def verification_token(mailbox, to: str) -> str:
    sent = [m for m in mailbox.sent if m.to == to and "verify-email?token=" in m.text]
    assert sent, f"no verification email to {to}"
    return re.search(r"verify-email\?token=([A-Za-z0-9_\-]+)", sent[-1].text).group(1)


def rows() -> list[ProspectAssessment]:
    with SessionLocal() as db:
        return db.query(ProspectAssessment).order_by(ProspectAssessment.captured_at).all()


def attempts_for(member_id: str) -> list[HealthNumberAttempt]:
    with SessionLocal() as db:
        return db.query(HealthNumberAttempt).filter(HealthNumberAttempt.member_id == UUID(member_id)).all()


# ---- Never is the default, and it stores nothing --------------------------------------

def test_with_nothing_published_saving_is_off_and_a_capture_stores_nothing(client):
    policy = client.get("/api/v1/prospects/policy").json()
    assert policy["saving_enabled"] is False and policy["notice"] is None
    assert policy["retention_label"].startswith("Never")
    refused = client.post("/api/v1/prospects/assessment", json={
        "email": VISITOR, "answers": ANSWERS,
        "consent": {"agreed": True, "notice_version": "x", "notice_hash": "0" * 64},
        "idempotency_key": "never-key-0000000001"})
    assert refused.status_code == 409, refused.text
    assert rows() == []


# ---- capture ---------------------------------------------------------------------------

def test_a_consented_capture_persists_the_full_questionnaire_sealed(admin_client, client, mailbox, clock):
    assert publish(admin_client, "days", 30).status_code == 200
    saved = capture(client)
    assert saved.status_code == 201, saved.text
    body = saved.json()

    # The number shown agrees with the deterministic calculation.
    preview = client.post("/api/v1/health-number/preview", json={"answers": ANSWERS}).json()
    assert body["result"]["displayed_score"] == preview["displayed_score"]
    assert body["result"]["calculation_version"] == preview["calculation_version"]
    assert body["saved"]["status"] == "unverified"
    assert body["confirmation_email"] == "sent"

    [row] = rows()
    assert row.email_normalized == VISITOR
    assert row.retention_mode == "days" and row.retention_days == 30 and row.retention_policy_version == 1
    expires = row.expires_at if row.expires_at.tzinfo else row.expires_at.replace(tzinfo=timezone.utc)
    assert expires == clock.now + timedelta(days=30)
    # Nothing health-related is in clear: not an answer, not the score.
    assert "Intermittent Fasting" not in row.payload_ciphertext and "6.5" not in row.payload_ciphertext
    opened = json.loads(cipher_for().decrypt(row.payload_ciphertext, aad=row.id.bytes))
    assert opened["answers"]["plans"] == ["Intermittent Fasting"]
    assert opened["result"]["displayed_score"] == preview["displayed_score"]
    assert opened["answers"]["sleepHours"] == 6.5

    # Bearer proofs exist only as hashes.
    with SessionLocal() as db:
        tokens = db.query(ProspectToken).filter(ProspectToken.prospect_id == row.id).all()
        events = db.query(ProspectEvent).filter(ProspectEvent.prospect_id == row.id).all()
    assert sorted(t.purpose for t in tokens) == ["browser", "email"]
    assert all(body["claim_token"] != t.token_hash and len(t.token_hash) == 64 for t in tokens)
    assert [e.event_type for e in events] == ["captured"]
    assert "Intermittent" not in json.dumps([e.details for e in events])

    # The confirmation email carries a link, never the answers or the number.
    message = [m for m in mailbox.sent if m.to == VISITOR][-1]
    assert "/saved-result?token=" in message.text
    assert preview["interpretation"] not in message.text and "Intermittent" not in message.text


def test_saving_needs_an_explicit_consent_to_the_current_words(admin_client, client):
    publish(admin_client, "days", 30)
    notice = client.get("/api/v1/prospects/policy").json()["notice"]
    base = {"email": VISITOR, "answers": ANSWERS, "idempotency_key": "consent-key-00000001"}
    unticked = client.post("/api/v1/prospects/assessment", json={**base, "consent": {
        "agreed": False, "notice_version": notice["version"], "notice_hash": notice["hash"]}})
    assert unticked.status_code == 422
    missing = client.post("/api/v1/prospects/assessment", json=base)
    assert missing.status_code == 422
    stale = client.post("/api/v1/prospects/assessment", json={**base, "consent": {
        "agreed": True, "notice_version": notice["version"], "notice_hash": "f" * 64}})
    assert stale.status_code == 409 and "notice" in stale.json()["detail"].lower()
    assert rows() == []
    # The positive control: the same request with the current words saves.
    assert capture(client, key="consent-key-00000001").status_code == 201
    assert len(rows()) == 1


def test_the_notice_changes_with_the_policy_so_old_words_cannot_be_reused(admin_client, client):
    publish(admin_client, "days", 30)
    old = client.get("/api/v1/prospects/policy").json()["notice"]
    publish(admin_client, "days", 15)
    new = client.get("/api/v1/prospects/policy").json()["notice"]
    assert "15 days" in new["text"] and old["hash"] != new["hash"]
    replay = client.post("/api/v1/prospects/assessment", json={
        "email": VISITOR, "answers": ANSWERS, "idempotency_key": "stale-notice-key-01",
        "consent": {"agreed": True, "notice_version": old["version"], "notice_hash": old["hash"]}})
    assert replay.status_code == 409
    assert rows() == []


def test_a_double_submit_is_one_record_and_a_borrowed_key_is_refused(admin_client, client, mailbox):
    publish(admin_client, "days", 30)
    first = capture(client, key="double-click-key-0001")
    second = capture(client, key="double-click-key-0001")
    assert first.status_code == second.status_code == 201
    assert second.json()["replayed"] is True
    assert len(rows()) == 1
    assert len([m for m in mailbox.sent if m.to == VISITOR]) == 1, "a retry must not email again"
    # The first tab's token is superseded by the retry's.
    assert client.post("/api/v1/prospects/status", json={"token": first.json()["claim_token"]}).status_code == 404
    assert client.post("/api/v1/prospects/status", json={"token": second.json()["claim_token"]}).status_code == 200
    stolen = capture(client, email="someone.else@demo.veye.test", key="double-click-key-0001")
    assert stolen.status_code == 409
    # The same key with DIFFERENT answers is a new submission, not a retry:
    # it must never be answered with the number stored for the first one.
    changed = capture(client, key="double-click-key-0001", answers={**ANSWERS, "tired": "no", "sleepHours": 9})
    assert changed.status_code == 409
    assert len(rows()) == 1


def test_a_confirmation_that_could_not_be_sent_is_reported_and_retried_not_lost(admin_client, client, mailbox):
    from app.notifications.email import DeliveryResult
    from app.notifications.models import NotificationOutbox
    from app.notifications.service import NotificationService

    publish(admin_client, "days", 30)

    class Down:
        name = "down"

        def send(self, message):
            return DeliveryResult(accepted=False, provider="down", error="relay unreachable")

        def describe(self):
            return {"provider": "down"}

    configure_runtime(email=Down())
    saved = capture(client)
    assert saved.status_code == 201, "the result is saved even when the email is not"
    assert saved.json()["confirmation_email"] == "retry"
    with SessionLocal() as db:
        [outbox] = db.query(NotificationOutbox).filter(NotificationOutbox.to_email == VISITOR).all()
        assert outbox.status == "retry" and outbox.attempts == 1 and outbox.last_error == "relay unreachable"
        outbox.next_attempt_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        db.commit()
        # The relay recovers; the scheduled dispatcher delivers what was queued.
        outcome = NotificationService(db, mailbox).dispatch_due()
        assert outcome["sent"] == 1
        db.refresh(outbox)
        assert outbox.status == "sent" and outbox.attempts == 2
    assert any(m.to == VISITOR for m in mailbox.sent)


# ---- the console sees metadata only --------------------------------------------------------

def test_the_console_lists_saved_results_without_the_answers_or_the_number(admin_client, client):
    publish(admin_client, "days", 30)
    saved = capture(client).json()
    page = admin_client.get("/api/v1/admin/prospects")
    assert page.status_code == 200, page.text
    data = page.json()
    [row] = data["rows"]
    assert row["email_masked"].startswith("vi") and "@demo.veye.test" in row["email_masked"] and VISITOR not in page.text
    assert row["status"] == "unverified" and row["status_label"] == "Unverified prospect"
    assert row["sharing_note"].startswith("Sharing is available after sign-up")
    assert data["counts"]["unregistered"] == 1
    text = page.text + admin_client.get(f"/api/v1/admin/prospects/{row['id']}").text
    for leak in (saved["result"]["interpretation"], "Intermittent Fasting", "displayed_score", "answers"):
        assert leak not in text, f"the console response carried {leak!r}"
    detail = admin_client.get(f"/api/v1/admin/prospects/{row['id']}").json()
    assert [e["event_type"] for e in detail["events"]] == ["captured"]
    # Exact-address search only.
    assert admin_client.get("/api/v1/admin/prospects", params={"q": VISITOR}).json()["total"] == 1
    assert admin_client.get("/api/v1/admin/prospects", params={"q": "visitor"}).json()["total"] == 0


def test_an_administrator_can_delete_a_saved_result_and_it_is_audited(admin_client, client):
    from app.admin.models import AdminAuditEntry

    publish(admin_client, "days", 30)
    token = capture(client).json()["claim_token"]
    row_id = admin_client.get("/api/v1/admin/prospects").json()["rows"][0]["id"]
    erased = admin_client.post(f"/api/v1/admin/prospects/{row_id}/erase", json={"reason": "Asked by phone"})
    assert erased.status_code == 200 and erased.json()["status"] == "erased"
    [row] = rows()
    assert row.payload_ciphertext is None and row.email_normalized is None
    assert client.post("/api/v1/prospects/status", json={"token": token}).status_code == 404
    with SessionLocal() as db:
        assert db.query(AdminAuditEntry).filter(AdminAuditEntry.action == "prospect.erased").count() == 1


# ---- claiming: capability + proof of the address + verified session ---------------------------

def test_same_browser_sign_up_links_pending_and_verification_completes_it_without_a_duplicate(admin_client, client, mailbox):
    publish(admin_client, "days", 30)
    token = capture(client).json()["claim_token"]
    member = visitor()
    created = sign_up(member, email=VISITOR, password=PASSWORD, health_number_answers=ANSWERS,
                      prospect_claim_token=token)
    assert created.status_code == 201, created.text
    assert created.json()["prospect_link"] == "pending_verification"
    member_id = created.json()["account"]["member_id"]
    [row] = rows()
    assert row.status == "pending_claim" and row.payload_ciphertext is not None
    assert len(attempts_for(member_id)) == 1  # the account's own copy, from sign-up

    verified = member.post("/api/v1/auth/verify-email", json={"token": verification_token(mailbox, VISITOR)})
    assert verified.status_code == 200, verified.text
    assert verified.json()["saved_results_added"] == 1
    [row] = rows()
    assert row.status == "claimed" and str(row.claimed_member_id) == member_id
    assert row.payload_ciphertext is None and row.email_normalized is None
    assert len(attempts_for(member_id)) == 1, "completing the claim must not write a second attempt"


def test_registering_the_same_address_without_a_capability_gets_nothing(admin_client, client, mailbox):
    publish(admin_client, "days", 30)
    capture(client)
    stranger = visitor()
    created = sign_up(stranger, email=VISITOR, password=PASSWORD)
    assert created.status_code == 201
    assert created.json()["prospect_link"] == "none"
    member_id = created.json()["account"]["member_id"]
    stranger.post("/api/v1/auth/verify-email", json={"token": verification_token(mailbox, VISITOR)})
    [row] = rows()
    assert row.status == "unverified" and row.claimed_member_id is None and row.payload_ciphertext is not None
    assert attempts_for(member_id) == []


def test_a_browser_token_cannot_carry_a_result_to_a_different_address_but_the_emailed_link_can(admin_client, client, mailbox):
    publish(admin_client, "days", 30)
    browser = capture(client).json()["claim_token"]
    member = visitor()
    other = "visitor.other@demo.veye.test"
    created = sign_up(member, email=other, password=PASSWORD, health_number_answers=ANSWERS,
                      prospect_claim_token=browser)
    member_id = created.json()["account"]["member_id"]
    added = member.post("/api/v1/auth/verify-email", json={"token": verification_token(mailbox, other)}).json()
    assert added["saved_results_added"] == 0, "a different, merely typed address proves nothing"
    assert rows()[0].status == "pending_claim"

    # The browser token was spent on the pending link; presenting a fresh one
    # still is not proof of the other mailbox.
    refused = member.post("/api/v1/members/me/saved-results/claim", json={"token": browser})
    assert refused.status_code in (404, 409)
    # The emailed link IS proof of that mailbox.
    via_email = member.post("/api/v1/members/me/saved-results/claim", json={"token": emailed_token(mailbox, VISITOR)})
    assert via_email.status_code == 200, via_email.text
    assert via_email.json()["deduplicated"] is True
    assert len(attempts_for(member_id)) == 1


def test_an_unverified_member_cannot_claim_until_the_address_is_proven(admin_client, client, mailbox):
    publish(admin_client, "days", 30)
    capture(client)
    member = visitor()
    sign_up(member, email=VISITOR, password=PASSWORD)
    link = emailed_token(mailbox, VISITOR)
    early = member.post("/api/v1/members/me/saved-results/claim", json={"token": link})
    assert early.status_code == 409 and "verify" in early.json()["detail"].lower()
    member.post("/api/v1/auth/verify-email", json={"token": verification_token(mailbox, VISITOR)})
    later = member.post("/api/v1/members/me/saved-results/claim", json={"token": link})
    assert later.status_code == 200, later.text
    member_id = member.get("/api/v1/auth/me").json()["member"]["member_id"]
    [attempt] = attempts_for(member_id)
    assert attempt.answers["plans"] == ["Intermittent Fasting"]
    # A second click on the same link is the same answer, not a second attempt.
    again = member.post("/api/v1/members/me/saved-results/claim", json={"token": link})
    assert again.status_code == 200 and again.json()["already_claimed"] is True
    assert len(attempts_for(member_id)) == 1


def test_one_saved_result_joins_one_account_only(admin_client, client, mailbox):
    publish(admin_client, "days", 30)
    browser = capture(client).json()["claim_token"]
    link = emailed_token(mailbox, VISITOR)
    first, second = visitor(), visitor()
    sign_up(first, email=VISITOR, password=PASSWORD)
    first.post("/api/v1/auth/verify-email", json={"token": verification_token(mailbox, VISITOR)})
    assert first.post("/api/v1/members/me/saved-results/claim", json={"token": link}).status_code == 200
    sign_up(second, email="second.claimant@demo.veye.test", password=PASSWORD)
    second.post("/api/v1/auth/verify-email", json={"token": verification_token(mailbox, "second.claimant@demo.veye.test")})
    for token in (link, browser):
        late = second.post("/api/v1/members/me/saved-results/claim", json={"token": token})
        assert late.status_code == 404, late.text


def test_an_administrator_session_cannot_claim(admin_client, client, mailbox):
    publish(admin_client, "days", 30)
    capture(client)
    refused = admin_client.post("/api/v1/members/me/saved-results/claim", json={"token": emailed_token(mailbox, VISITOR)})
    assert refused.status_code == 401


# ---- retention -------------------------------------------------------------------------------

def test_expiry_is_enforced_on_read_before_the_purge_and_the_purge_is_idempotent(admin_client, client, mailbox, clock):
    publish(admin_client, "days", 15)
    token = capture(client).json()["claim_token"]
    clock.advance(days=15, seconds=-1)
    assert client.post("/api/v1/prospects/status", json={"token": token}).status_code == 200
    clock.advance(seconds=2)
    gone = client.post("/api/v1/prospects/status", json={"token": token})
    assert gone.status_code == 404
    # Nothing purged yet, but nobody can reach it and the console says Expired.
    [row] = rows()
    assert row.payload_ciphertext is not None
    listed = admin_client.get("/api/v1/admin/prospects").json()
    assert listed["rows"][0]["status"] == "expired" and listed["counts"]["awaiting_purge"] == 1

    run = admin_client.post("/api/v1/admin/settings/privacy/cleanup", json={"dry_run": True}).json()
    assert run["status"] == "ok" and run["counts"]["due"] == 1 and run["dry_run"] is True
    assert rows()[0].payload_ciphertext is not None, "a dry run changes nothing"
    run = admin_client.post("/api/v1/admin/settings/privacy/cleanup", json={"dry_run": False}).json()
    assert run["counts"] == {"due": 1, "purged": 1}
    [row] = rows()
    assert row.status == "expired" and row.payload_ciphertext is None and row.email_normalized is None
    with SessionLocal() as db:
        assert db.query(ProspectToken).count() == 0
    again = admin_client.post("/api/v1/admin/settings/privacy/cleanup", json={"dry_run": False}).json()
    assert again["counts"] == {"due": 0, "purged": 0}
    settings_view = admin_client.get("/api/v1/admin/settings/privacy").json()
    assert settings_view["last_cleanup"]["counts"] == {"due": 0, "purged": 0}


def test_a_new_policy_applies_to_new_captures_and_never_lengthens_an_old_one(admin_client, client, clock):
    publish(admin_client, "days", 30)
    capture(client, email="first.visitor@demo.veye.test")
    publish(admin_client, "days", 45)
    clock.advance(days=1)
    capture(client, email="second.visitor@demo.veye.test")
    first, second = rows()
    as_utc = lambda v: v if v.tzinfo else v.replace(tzinfo=timezone.utc)
    assert as_utc(first.expires_at) - as_utc(first.captured_at) == timedelta(days=30), "lengthened an earlier agreement"
    assert as_utc(second.expires_at) - as_utc(second.captured_at) == timedelta(days=45)
    # Even an explicit "apply to existing records" cannot stretch the 30-day
    # record to the new 45 days.
    assert admin_client.post("/api/v1/admin/settings/privacy/apply-shorter", json={"confirm": True}).json() == \
        {"shortened": 0, "purged_now": 0}
    assert as_utc(rows()[0].expires_at) - as_utc(rows()[0].captured_at) == timedelta(days=30)

    # Forever is never chosen by accident.
    assert publish(admin_client, "forever").status_code == 422
    assert publish(admin_client, "forever", acknowledge_forever=True).status_code == 200
    capture(client, email="third.visitor@demo.veye.test")
    assert rows()[2].expires_at is None and rows()[2].retention_mode == "forever"
    # Applying Forever to existing records does nothing: it would lengthen them.
    assert admin_client.post("/api/v1/admin/settings/privacy/apply-shorter", json={"confirm": True}).json() == \
        {"shortened": 0, "purged_now": 0}
    assert as_utc(rows()[0].expires_at) - as_utc(rows()[0].captured_at) == timedelta(days=30)


def test_applying_a_shorter_policy_moves_expiry_earlier_after_a_preview(admin_client, client, clock):
    publish(admin_client, "days", 45)
    capture(client, email="old.visitor@demo.veye.test")
    clock.advance(days=20)
    capture(client, email="new.visitor@demo.veye.test")
    impact = admin_client.post("/api/v1/admin/settings/privacy/preview", json={"mode": "days", "days": 15}).json()
    # The older record (20 days old) would expire at once; the new one shortens.
    assert impact == {"active": 2, "would_shorten": 1, "would_expire_now": 1, "unaffected": 0,
                      "applies_to_new_captures": "15 days", "lengthens_existing": False}
    assert len([r for r in rows() if r.payload_ciphertext]) == 2, "a preview changes nothing"
    publish(admin_client, "days", 15)
    assert len([r for r in rows() if r.payload_ciphertext]) == 2, "publishing alone does not touch existing records"
    applied = admin_client.post("/api/v1/admin/settings/privacy/apply-shorter", json={"confirm": True}).json()
    assert applied == {"shortened": 2, "purged_now": 1}
    old, new = rows()
    assert old.status == "expired" and old.payload_ciphertext is None
    as_utc = lambda v: v if v.tzinfo else v.replace(tzinfo=timezone.utc)
    assert as_utc(new.expires_at) == as_utc(new.captured_at) + timedelta(days=15)


def test_a_shortened_record_is_unreachable_once_its_new_expiry_passes_although_its_token_lives_on(admin_client, client, clock):
    """Tokens keep the lifetime they were issued with; shortening retention
    moves only the record's expiry. The record's own expiry must therefore be
    what the read path checks — a token that is still valid opens nothing."""
    publish(admin_client, "days", 45)
    token = capture(client).json()["claim_token"]
    publish(admin_client, "days", 15)
    admin_client.post("/api/v1/admin/settings/privacy/apply-shorter", json={"confirm": True})
    clock.advance(days=16)  # past the new 15-day expiry, well inside the token's 30 days
    with SessionLocal() as db:
        [live_token] = db.query(ProspectToken).filter(ProspectToken.purpose == "browser").all()
        token_expiry = live_token.expires_at if live_token.expires_at.tzinfo else live_token.expires_at.replace(tzinfo=timezone.utc)
    assert token_expiry > clock.now, "precondition: the token itself has not expired"
    assert client.post("/api/v1/prospects/status", json={"token": token}).status_code == 404
    assert client.post("/api/v1/prospects/erase", json={"token": token}).status_code == 404


def test_switching_to_never_stops_new_saves_and_leaves_old_ones_until_shortened(admin_client, client):
    publish(admin_client, "days", 30)
    capture(client)
    assert publish(admin_client, "never").status_code == 200
    assert client.get("/api/v1/prospects/policy").json()["saving_enabled"] is False
    assert rows()[0].payload_ciphertext is not None
    applied = admin_client.post("/api/v1/admin/settings/privacy/apply-shorter", json={"confirm": True}).json()
    assert applied["purged_now"] == 1
    assert rows()[0].payload_ciphertext is None


def test_retention_publishing_is_versioned_and_audited(admin_client):
    from app.admin.models import AdminAuditEntry

    assert publish(admin_client, "days", 20).status_code == 422, "only 15, 30 and 45 are offered"
    assert publish(admin_client, "days", 30).status_code == 200
    assert publish(admin_client, "days", 30).status_code == 409, "re-publishing the same policy is not a new version"
    view = publish(admin_client, "days", 15).json()
    assert view["version"] == 2 and [h["version"] for h in view["history"]] == [2, 1]
    with SessionLocal() as db:
        assert db.query(AdminAuditEntry).filter(AdminAuditEntry.action == "settings.prospect_retention.published").count() == 2


# ---- the visitor's other routes ----------------------------------------------------------------

def test_a_visitor_can_delete_their_saved_result(admin_client, client, mailbox):
    publish(admin_client, "days", 30)
    token = capture(client).json()["claim_token"]
    link = emailed_token(mailbox, VISITOR)
    assert client.post("/api/v1/prospects/erase", json={"token": token}).status_code == 200
    [row] = rows()
    assert row.status == "erased" and row.payload_ciphertext is None and row.email_normalized is None
    # Every capability is dead afterwards, including the emailed one.
    for t in (token, link):
        assert client.post("/api/v1/prospects/status", json={"token": t}).status_code == 404


def test_refusals_do_not_say_which_records_exist(admin_client, client, mailbox):
    publish(admin_client, "days", 30)
    token = capture(client).json()["claim_token"]
    client.post("/api/v1/prospects/erase", json={"token": token})
    unknown = client.post("/api/v1/prospects/status", json={"token": "x" * 43})
    erased = client.post("/api/v1/prospects/status", json={"token": token})
    assert unknown.status_code == erased.status_code == 404
    assert unknown.json() == erased.json()
    # Recovery answers the same way for an address with and without a record.
    before = len(mailbox.sent)
    nobody = client.post("/api/v1/prospects/recover", json={"email": "nobody.here@demo.veye.test"})
    assert len(mailbox.sent) == before
    capture(client, email="has.record@demo.veye.test")
    sent_before = len(mailbox.sent)
    somebody = client.post("/api/v1/prospects/recover", json={"email": "has.record@demo.veye.test"})
    assert nobody.status_code == somebody.status_code == 202 and nobody.json() == somebody.json()
    assert len(mailbox.sent) == sent_before + 1


def test_confirming_the_emailed_link_verifies_the_address_but_reveals_no_result(admin_client, client, mailbox):
    publish(admin_client, "days", 30)
    saved = capture(client).json()
    confirmed = client.post("/api/v1/prospects/confirm", json={"token": emailed_token(mailbox, VISITOR)})
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["status"] == "verified" and confirmed.json()["email_verified"] is True
    # Status only: no field of the result travels on this route.
    assert set(confirmed.json()) == {"status", "status_label", "email_masked", "email_verified", "captured_at",
                                     "expires_at", "retention_mode", "retention_days"}
    assert saved["result"]["interpretation"] not in confirmed.text
    # The browser token is not an emailed proof and cannot confirm the address.
    assert client.post("/api/v1/prospects/confirm", json={"token": saved["claim_token"]}).status_code == 404


# ---- the seal ------------------------------------------------------------------------------------

def test_the_seal_refuses_tampering_and_another_records_id():
    cipher = AnswerCipher.from_config(None, production=False)
    a, b = uuid4(), uuid4()
    sealed = cipher.encrypt(b'{"answers": 1}', aad=a.bytes)
    assert cipher.decrypt(sealed, aad=a.bytes) == b'{"answers": 1}'
    with pytest.raises(CipherError):
        cipher.decrypt(sealed, aad=b.bytes)
    middle = len(sealed) - 20
    flipped = sealed[:middle] + ("A" if sealed[middle] != "A" else "B") + sealed[middle + 1:]
    with pytest.raises(CipherError):
        cipher.decrypt(flipped, aad=a.bytes)


def test_production_without_a_key_cannot_save_or_switch_saving_on(admin_client, client):
    from app.core.config import Settings

    production = Settings(database_url="sqlite://", environment="production", email_provider="smtp",
                          smtp_host="smtp.example.test", session_cookie_secure=True)
    assert cipher_for(production) is None
    with pytest.raises(Exception):
        AnswerCipher.from_config("local-dev:" + "A" * 44, production=True)
    configure_runtime(settings=production)  # the next test starts from a fresh runtime
    refused = publish(admin_client, "days", 30)
    assert refused.status_code == 409 and "encryption key" in refused.json()["detail"]
    assert client.get("/api/v1/prospects/policy").json()["saving_enabled"] is False
