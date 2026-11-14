"""Deleting a member profile (architecture V2 §6) — and proving it.

Every claim has its positive control: the data exists before, is gone after,
and the thing that must survive (a dual-access person's console access) still
works. A purge that fails part-way must leave access closed, and a database
restored from an older backup must be re-erased from the ledger.
"""

from __future__ import annotations

import io
import json
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.admin.models import AdminAuditEntry
from app.assessments.models import HealthNumberAttempt
from app.auth.models import AuthSession, UserAccount
from app.companion.models import CompanionConversation, CompanionMessage, CompanionPolicyDecision
from app.core.runtime import configure_runtime, get_runtime
from app.db.session import SessionLocal
from app.erasure.models import ErasureRequest
from app.erasure.service import LEDGER_PREFIX
from app.health_permission.models import MemberHealthPermission, MemberHealthPermissionEvent
from app.main import app
from app.members.models import Member
from app.mood.models import MoodEntry
from app.requests.models import MemberRequest
from tests.conftest import MEMBER_PASSWORD, admin_sign_in, decide_sharing, sign_in, sign_up, verify_member_email

PASSWORD = "EraseMe!2026-local"
ANSWERS = {
    "goals": ["Live a Healthier Lifestyle"], "plans": ["No other plans"],
    "activity": "Moderate (I exercise 1-3 times a week)", "meditate": "yes",
    "tired": "no", "gainWeight": "no", "abdomenWeight": "no",
    "sleepEnough": "yes", "sleepWell": "yes", "sleepHours": 7,
    "diet": "No preference", "source": "Friends or Family",
}


def png() -> bytes:
    out = io.BytesIO()
    Image.new("RGB", (32, 32), (90, 140, 40)).save(out, format="PNG")
    return out.getvalue()


def rich_member(email: str) -> tuple[TestClient, dict]:
    """A member with something in every slice erasure has to reach."""
    http = TestClient(app)
    http.__enter__()
    created = sign_up(http, email=email, password=PASSWORD)
    assert created.status_code == 201, created.text
    verify_member_email(http)
    assert http.post("/api/v1/health-number/calculate", json={"answers": ANSWERS}).status_code in (200, 201)
    assert http.put("/api/v1/members/me/mood", json={"entry_date": "2026-11-10", "mood": "happy",
                                                      "note": "zz-erase-mood-note"}).status_code in (200, 201)
    http.post("/api/v1/members/me/requests", json={"kind": "contact_us", "subject": "hi", "message": "zz-erase-message",
                                                    "page": "/app"})
    http.post("/api/v1/companion/messages", json={"message": "How is my progress?"})
    http.post("/api/v1/members/me/photo", files={"file": ("me.png", io.BytesIO(png()), "image/png")})
    decide_sharing(http)
    account = http.get("/api/v1/auth/me").json()["member"]
    return http, account


def erase(http: TestClient, password: str = PASSWORD, confirm: str = "DELETE"):
    return http.post("/api/v1/members/me/erasure", json={"password": password, "confirm": confirm})


def rows_for(member_id: UUID) -> dict[str, int]:
    with SessionLocal() as db:
        conversations = [c for (c,) in db.query(CompanionConversation.id).filter(CompanionConversation.member_id == member_id)]
        return {
            "member": db.query(Member).filter(Member.id == member_id).count(),
            "health_number": db.query(HealthNumberAttempt).filter(HealthNumberAttempt.member_id == member_id).count(),
            "mood": db.query(MoodEntry).filter(MoodEntry.member_id == member_id).count(),
            "requests": db.query(MemberRequest).filter(MemberRequest.member_id == member_id).count(),
            "conversations": len(conversations),
            "messages": db.query(CompanionMessage).filter(CompanionMessage.conversation_id.in_(conversations)).count() if conversations else 0,
            "policy_decisions": db.query(CompanionPolicyDecision).filter(CompanionPolicyDecision.member_id == member_id).count(),
            "sharing": db.query(MemberHealthPermission).filter(MemberHealthPermission.member_id == member_id).count(),
            "sharing_events": db.query(MemberHealthPermissionEvent).filter(MemberHealthPermissionEvent.member_id == member_id).count(),
        }


# ---- the request itself -------------------------------------------------------------------

def test_the_preview_says_what_goes_and_what_stays_before_anything_is_asked(member_client):
    preview = member_client.get("/api/v1/members/me/erasure/preview")
    assert preview.status_code == 200
    body = preview.json()
    assert body["scope"] == "entire_identity" and body["confirm_word"] == "DELETE"
    assert any("sign-in account" in line for line in body["removed"])
    assert body["kept"], "the minimal record that remains is stated, not hidden"


def test_the_password_and_the_typed_word_are_both_required(member_client):
    assert erase(member_client, password="wrong-password").status_code == 403
    assert erase(member_client, password=MEMBER_PASSWORD, confirm="delete me").status_code == 422
    assert member_client.get("/api/v1/auth/me").json()["member"] is not None, "nothing happened"
    with SessionLocal() as db:
        assert db.query(ErasureRequest).count() == 0


def test_an_admin_session_cannot_start_a_members_deletion(admin_client):
    assert admin_client.post("/api/v1/members/me/erasure", json={"password": "x", "confirm": "DELETE"}).status_code == 401


# ---- a member-only account: everything goes ----------------------------------------------------

def test_erasure_removes_every_trace_and_leaves_a_receipt_without_health_data(admin_client, mailbox):
    http, account = rich_member("erase.full@demo.veye.test")
    member_id, user_id = UUID(account["member_id"]), UUID(account["id"])
    before = rows_for(member_id)
    assert all(before[k] >= 1 for k in ("member", "health_number", "mood", "requests", "conversations", "messages", "sharing")), before
    admin_client.get(f"/api/v1/admin/members/{member_id}")  # an audited read about this member
    # An audit entry that really does record the address (the positive control
    # for redaction: without one, "no email in the audit log" proves nothing).
    assert admin_client.post(f"/api/v1/admin/members/{member_id}/send-password-reset").status_code == 200
    with SessionLocal() as db:
        recorded = [e for e in db.query(AdminAuditEntry).filter(AdminAuditEntry.entity_id == str(user_id)).all()
                    if "erase.full@demo.veye.test" in json.dumps(e.details or {})]
        assert recorded, "precondition: an audit entry holds the address"
        photo_key = db.get(UserAccount, user_id).photo_object_key
    assert photo_key and get_runtime().media_store.exists(photo_key)

    done = erase(http)
    assert done.status_code == 202, done.text
    result = done.json()
    assert result["state"] == "erased" and result["scope"] == "entire_identity"
    assert result["receipt"]["health_number"] >= 1 and result["receipt"]["sign_in_account"] == 1

    assert rows_for(member_id) == {k: 0 for k in before}, rows_for(member_id)
    with SessionLocal() as db:
        # Not merely unlinked: the words the member wrote are gone.
        assert db.query(MemberRequest).filter(MemberRequest.message.contains("zz-erase-message")).count() == 0
        assert db.get(UserAccount, user_id) is None
        assert db.query(AuthSession).filter(AuthSession.user_id == user_id).count() == 0
        kept = db.query(AdminAuditEntry).filter(AdminAuditEntry.entity_id.in_((str(member_id), str(user_id)))).all()
        assert kept, "the audit rows themselves are kept"
        for entry in kept:
            assert "erase.full@demo.veye.test" not in json.dumps(entry.details or {})
    assert not get_runtime().media_store.exists(photo_key)

    # The session that asked is gone; the account cannot sign in; the console cannot open it.
    assert http.get("/api/v1/auth/me").json()["member"] is None
    assert sign_in(TestClient(app), "erase.full@demo.veye.test", PASSWORD).status_code == 401
    assert admin_client.get(f"/api/v1/admin/members/{member_id}").status_code == 404

    # A receipt with a reference and no health information; a public status by reference.
    receipt = [m for m in mailbox.sent if m.to == "erase.full@demo.veye.test" and "deleted" in m.subject.lower()][-1]
    assert result["request_id"] in receipt.text
    for leak in ("zz-erase-mood-note", "zz-erase-message", "Health Number"):
        assert leak not in receipt.text
    status = TestClient(app).get(f"/api/v1/erasure-requests/{result['request_id']}").json()
    assert status["state"] == "erased" and status["receipt"] == {}
    # The ledger entry lives outside the database and holds ids only.
    entry = json.loads(get_runtime().media_store.get(f"{LEDGER_PREFIX}{result['request_id']}.json"))
    assert entry["subject_member_id"] == str(member_id) and "email" not in json.dumps(entry)
    with SessionLocal() as db:
        request = db.get(ErasureRequest, UUID(result["request_id"]))
        assert request.receipt_email is None, "the address is not kept once the receipt is queued"


# ---- a dual-access account: the console access survives ---------------------------------------------

def test_a_dual_access_person_keeps_console_access_and_loses_only_member_data(admin_client, mailbox):
    http, account = rich_member("erase.dual@demo.veye.test")
    member_id, user_id = UUID(account["member_id"]), UUID(account["id"])
    invited = admin_client.post("/api/v1/admin/administrators/invite",
                                json={"email": "erase.dual@demo.veye.test", "first_name": "Erase", "last_name": "Dual"})
    assert invited.status_code == 201, invited.text
    with SessionLocal() as db:
        user = db.get(UserAccount, user_id)
        user.invitation_accepted_at = user.invited_at
        db.commit()
    console = TestClient(app)
    console.__enter__()
    assert admin_sign_in(console, "erase.dual@demo.veye.test", PASSWORD).status_code == 200

    assert http.get("/api/v1/members/me/erasure/preview").json()["scope"] == "member_data"
    done = erase(http)
    assert done.status_code == 202 and done.json()["state"] == "erased" and done.json()["scope"] == "member_data"
    assert rows_for(member_id)["member"] == 0 and rows_for(member_id)["health_number"] == 0
    with SessionLocal() as db:
        user = db.get(UserAccount, user_id)
        assert user is not None and user.admin_access and user.is_active and user.member_id is None
        assert user.photo_object_key, "one picture serves both portals; it stays with the console account"
    assert console.get("/api/v1/admin/members").status_code == 200, "the console session survives"
    assert http.get("/api/v1/auth/me").json()["member"] is None
    assert sign_in(TestClient(app), "erase.dual@demo.veye.test", PASSWORD).status_code == 403, "no member profile any more"


# ---- a purge that fails part-way ---------------------------------------------------------------------

def test_a_failed_purge_keeps_access_closed_and_finishes_on_retry(admin_client):
    http, account = rich_member("erase.blocked@demo.veye.test")
    member_id = UUID(account["member_id"])
    real_store = get_runtime().media_store

    class BrokenDeletes:
        def __getattr__(self, name):
            return getattr(real_store, name)

        def delete(self, key):
            raise OSError("bucket unreachable")

    configure_runtime(media_store=BrokenDeletes())
    done = erase(http)
    assert done.status_code == 202
    assert done.json()["state"] == "purge_blocked"
    # Access is closed although the purge did not finish.
    assert http.get("/api/v1/auth/me").json()["member"] is None
    assert sign_in(TestClient(app), "erase.blocked@demo.veye.test", PASSWORD).status_code == 401
    assert admin_client.get(f"/api/v1/admin/members/{member_id}").status_code == 404
    listed = admin_client.get("/api/v1/admin/erasure-requests").json()
    [row] = [r for r in listed if r["subject_member_id"] == str(member_id)]
    assert row["state"] == "purge_blocked" and row["failure_category"].startswith("media:")

    configure_runtime(media_store=real_store)
    retried = admin_client.post(f"/api/v1/admin/erasure-requests/{row['request_id']}/retry")
    assert retried.status_code == 200 and retried.json()["state"] == "erased"
    assert rows_for(member_id)["member"] == 0
    assert admin_client.post(f"/api/v1/admin/erasure-requests/{row['request_id']}/retry").status_code == 409


def test_running_the_purge_again_does_nothing_twice(admin_client):
    from app.erasure.service import build_service

    http, account = rich_member("erase.twice@demo.veye.test")
    request_id = UUID(erase(http).json()["request_id"])
    with SessionLocal() as db:
        request = db.get(ErasureRequest, request_id)
        receipt = dict(request.receipt)
        again = build_service(db, get_runtime()).process(request)
        assert again.state == "erased" and again.receipt == receipt and again.attempts == 1


# ---- restore safety ---------------------------------------------------------------------------------

def test_a_restored_backup_is_re_erased_from_the_ledger(admin_client):
    """A rehearsal of the restore runbook at application level: the rows come
    back exactly as a pre-deletion backup would bring them back, and the replay
    job removes them again."""
    from app.jobs.runner import run_job

    http, account = rich_member("erase.restore@demo.veye.test")
    member_id, user_id = UUID(account["member_id"]), UUID(account["id"])
    with SessionLocal() as db:
        member = db.get(Member, member_id)
        snapshot_member = {"id": member.id, "email": member.email, "display_name": member.display_name}
        attempt = db.query(HealthNumberAttempt).filter(HealthNumberAttempt.member_id == member_id).first()
        snapshot_attempt = {c.name: getattr(attempt, c.name) for c in HealthNumberAttempt.__table__.columns}
        user = db.get(UserAccount, user_id)
        snapshot_user = {c.name: getattr(user, c.name) for c in UserAccount.__table__.columns}
    request_id = erase(http).json()["request_id"]
    assert rows_for(member_id)["member"] == 0

    # "Restore": the old rows reappear, and the erasure_requests row does not
    # (it was written after the backup was taken).
    with SessionLocal() as db:
        db.query(ErasureRequest).delete()
        db.add(Member(**snapshot_member))
        db.flush()
        db.add(UserAccount(**snapshot_user))
        db.add(HealthNumberAttempt(**snapshot_attempt))
        db.commit()
    assert rows_for(member_id)["member"] == 1 and rows_for(member_id)["health_number"] == 1

    run = run_job(SessionLocal, "replay-erasures", triggered_by="restore rehearsal")
    assert run.status == "ok" and run.counts == {"ledger_entries": 1, "reapplied": 1}, run.counts
    assert rows_for(member_id)["member"] == 0 and rows_for(member_id)["health_number"] == 0
    with SessionLocal() as db:
        assert db.get(UserAccount, user_id) is None
        assert db.get(ErasureRequest, UUID(request_id)).state == "erased"
    # Replaying again finds nothing to do.
    assert run_job(SessionLocal, "replay-erasures").counts == {"ledger_entries": 1, "reapplied": 0}


def test_unknown_references_reveal_nothing(client):
    assert client.get("/api/v1/erasure-requests/00000000-0000-4000-8000-000000000000").status_code == 404


def test_a_deletion_another_worker_is_running_is_left_alone_and_a_stale_one_is_reclaimed(admin_client):
    """The request handler and the scheduled job can both reach one request;
    only one of them may run the stages. A worker that died mid-run must not
    leave the deletion stuck for ever."""
    from datetime import datetime, timedelta, timezone

    from app.erasure.service import build_service

    http, account = rich_member("erase.claim@demo.veye.test")
    member_id = UUID(account["member_id"])
    with SessionLocal() as db:
        user = db.get(UserAccount, UUID(account["id"]))
        service = build_service(db, get_runtime())
        request = service.request(user, password=PASSWORD, confirm="DELETE")
        request.state, request.updated_at = "purging", datetime.now(timezone.utc)
        db.commit()
        busy = service.process(request)
        assert busy.state == "purging" and busy.attempts == 0, "another worker holds it"
        assert rows_for(member_id)["health_number"] == 1, "nothing was deleted twice-over or half-way"
        request.updated_at = datetime.now(timezone.utc) - timedelta(minutes=16)
        db.commit()
        finished = service.process(request)
        assert finished.state == "erased" and finished.attempts == 1
    assert rows_for(member_id)["member"] == 0
