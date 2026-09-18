"""Sign-up, sign-in, sign-out, verification, password reset and the
member/admin authorization boundary — all against the development provider
and the in-memory EmailProvider."""

import re
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

from app.auth.models import AuthToken, UserAccount
from app.db.session import SessionLocal
from app.main import app
from app.notifications.models import NotificationOutbox
from tests.conftest import MEMBER_PASSWORD, sign_in, sign_up


def _link(text: str, path: str) -> str:
    match = re.search(rf"http://web\.test/{path}\?token=([A-Za-z0-9_-]+)", text)
    assert match, text
    return match.group(1)


def _answers():
    return {
        "goals": ["Live a Healthier Lifestyle"], "plans": ["No other plans"],
        "activity": "Moderate (I exercise 1-3 times a week)", "meditate": "yes",
        "tired": "no", "gainWeight": "no", "abdomenWeight": "no",
        "sleepEnough": "yes", "sleepWell": "yes", "sleepHours": 7,
        "diet": "No preference", "source": "Friends or Family",
    }


def test_sign_up_creates_account_member_session_and_emails(client, mailbox):
    response = sign_up(client)
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["account"]["role"] == "member"
    assert body["account"]["member_id"]
    assert body["account"]["email_verified"] is False
    assert {d["kind"]: d["status"] for d in body["deliveries"]} == {"email_verification": "sent", "welcome": "sent"}
    assert "veye_session" in client.cookies

    subjects = [m.subject for m in mailbox.sent]
    assert subjects == ["Verify your Veye email address", "Welcome to Veye"]
    assert MEMBER_PASSWORD not in "".join(m.text + (m.html or "") for m in mailbox.sent)

    me = client.get("/api/v1/auth/me")
    assert me.status_code == 200
    assert me.json()["account"]["email"] == "aditya.demo@demo.veye.test"

    with SessionLocal() as db:
        user = db.query(UserAccount).one()
        assert user.password_hash.startswith("$argon2id$")
        assert MEMBER_PASSWORD not in user.password_hash


def test_sign_up_rejects_duplicates_short_passwords_and_mismatch(client):
    assert sign_up(client).status_code == 201
    duplicate = sign_up(client, email="Aditya.Demo@demo.veye.test")
    assert duplicate.status_code == 409
    short = sign_up(client, email="other@demo.veye.test", password="short")
    assert short.status_code == 422
    mismatch = sign_up(client, email="other@demo.veye.test", confirm_password="something-else-entirely")
    assert mismatch.status_code == 422


def test_sign_in_sign_out_and_wrong_password(client):
    sign_up(client)
    client.cookies.clear()
    assert client.get("/api/v1/auth/me").json() == {"account": None}

    assert sign_in(client, "aditya.demo@demo.veye.test", "not-the-password").status_code == 401
    assert sign_in(client, "nobody@demo.veye.test").status_code == 401

    response = sign_in(client, "aditya.demo@demo.veye.test")
    assert response.status_code == 200
    assert client.get("/api/v1/auth/me").status_code == 200

    assert client.post("/api/v1/auth/sign-out").status_code == 204
    assert client.get("/api/v1/auth/me").json() == {"account": None}


def test_email_verification_link_is_single_use(client, mailbox):
    sign_up(client)
    token = _link(mailbox.sent[0].text, "verify-email")
    assert client.get("/api/v1/auth/me").json()["account"]["email_verified"] is False

    verified = client.post("/api/v1/auth/verify-email", json={"token": token})
    assert verified.status_code == 200
    assert verified.json()["account"]["email_verified"] is True

    again = client.post("/api/v1/auth/verify-email", json={"token": token})
    assert again.status_code == 400
    assert "already been used" in again.json()["detail"]
    assert client.post("/api/v1/auth/verify-email", json={"token": "not-a-real-token-value"}).status_code == 400


def test_password_reset_changes_password_and_revokes_old_sessions(client, mailbox):
    sign_up(client)
    forgot = client.post("/api/v1/auth/forgot-password", json={"email": "aditya.demo@demo.veye.test"})
    assert forgot.status_code == 202
    assert forgot.json()["delivery"]["status"] == "sent"
    unknown = client.post("/api/v1/auth/forgot-password", json={"email": "unknown@demo.veye.test"})
    assert unknown.status_code == 202
    assert unknown.json()["message"] == forgot.json()["message"]
    assert unknown.json()["delivery"] is None

    reset_mail = mailbox.sent[-1]
    assert reset_mail.subject == "Reset your Veye password"
    token = _link(reset_mail.text, "reset-password")

    too_short = client.post("/api/v1/auth/reset-password", json={"token": token, "password": "short"})
    assert too_short.status_code == 422

    done = client.post("/api/v1/auth/reset-password", json={"token": token, "password": "brand-new-password-2026"})
    assert done.status_code == 200
    # The session that existed before the reset is gone.
    assert client.get("/api/v1/auth/me").json()["account"] is None
    # Old password no longer works, new one does, token is spent.
    assert sign_in(client, "aditya.demo@demo.veye.test", MEMBER_PASSWORD).status_code == 401
    assert sign_in(client, "aditya.demo@demo.veye.test", "brand-new-password-2026").status_code == 200
    reused = client.post("/api/v1/auth/reset-password", json={"token": token, "password": "another-new-password-2026"})
    assert reused.status_code == 400


def test_expired_reset_token_is_rejected(client, mailbox):
    sign_up(client)
    client.post("/api/v1/auth/forgot-password", json={"email": "aditya.demo@demo.veye.test"})
    token = _link(mailbox.sent[-1].text, "reset-password")
    with SessionLocal() as db:
        row = db.query(AuthToken).filter(AuthToken.purpose == "reset_password").one()
        row.expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
        db.commit()
    response = client.post("/api/v1/auth/reset-password", json={"token": token, "password": "brand-new-password-2026"})
    assert response.status_code == 400
    assert "expired" in response.json()["detail"]


def test_outbox_records_delivery_honestly(client):
    sign_up(client)
    with SessionLocal() as db:
        rows = db.query(NotificationOutbox).all()
        assert {row.status for row in rows} == {"sent"}
        assert all(row.provider == "memory" and row.attempts == 1 for row in rows)


def test_notification_preferences_skip_optional_kinds_only(client, mailbox):
    sign_up(client)
    updated = client.put("/api/v1/auth/notification-preferences", json={"kind": "welcome", "email_enabled": False})
    assert updated.status_code == 200
    assert updated.json()["preferences"]["welcome"] is False
    # Transactional kinds cannot be silenced by preference.
    silenced = client.put("/api/v1/auth/notification-preferences", json={"kind": "email_verification", "email_enabled": False})
    assert silenced.status_code == 200
    before = len(mailbox.sent)
    assert client.post("/api/v1/auth/resend-verification").status_code == 200
    assert len(mailbox.sent) == before + 1


def test_member_and_admin_isolation(client, admin_client):
    sign_up(client)
    # A member cannot use the admin surfaces; the admin has no member record.
    assert client.get("/api/v1/admin/companion/overview").status_code == 403
    assert admin_client.get("/api/v1/members/me/health-number").status_code == 403
    assert admin_client.account["member_id"] is None
    assert admin_client.account["role"] == "admin"


def test_member_a_cannot_read_member_b(client):
    sign_up(client)
    a_member_id = client.get("/api/v1/auth/me").json()["account"]["member_id"]
    client.post("/api/v1/health-number/calculate", json={"answers": _answers()})

    with TestClient(app) as other:
        sign_up(other, email="maya.demo@demo.veye.test", first_name="Maya")
        # Only `me` resolves; the other member's id, an alias or a random id are unavailable.
        assert other.get(f"/api/v1/members/{a_member_id}/health-number").status_code == 404
        assert other.get("/api/v1/members/development/health-number").status_code == 404
        mine = other.get("/api/v1/members/me/health-number")
        assert mine.status_code == 200
        assert mine.json()["history"] == []


def test_anonymous_requests_are_refused(client):
    assert client.get("/api/v1/members/me/health-number").status_code == 401
    assert client.post("/api/v1/health-number/calculate", json={"answers": _answers()}).status_code == 401
    # The public onboarding preview stays available without an account and stores nothing.
    preview = client.post("/api/v1/health-number/preview", json={"answers": _answers()})
    assert preview.status_code == 200
    assert "attempt_id" not in preview.json()


def test_sign_up_can_attach_the_onboarding_answers(client):
    response = sign_up(client, health_number_answers=_answers())
    assert response.status_code == 201
    assert response.json()["health_number_attempt_id"]
    history = client.get("/api/v1/members/me/health-number").json()
    assert history["latest"]["attempt_id"] == response.json()["health_number_attempt_id"]
