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
from tests.conftest import MEMBER_PASSWORD, admin_sign_in, me, sign_in, sign_up


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
    assert body["account"]["member_access"] is True
    assert body["account"]["admin_access"] is False
    assert body["account"]["portal"] == "member"
    assert body["account"]["email_verified"] is False
    assert {d["kind"]: d["status"] for d in body["deliveries"]} == {"email_verification": "sent", "welcome": "sent"}
    assert "veye_member_session" in client.cookies
    assert "veye_admin_session" not in client.cookies

    subjects = [m.subject for m in mailbox.sent]
    assert subjects == ["Verify your Veye email address", "Welcome to Veye"]
    assert MEMBER_PASSWORD not in "".join(m.text + (m.html or "") for m in mailbox.sent)

    sessions = me(client)
    assert sessions["member"]["email"] == "aditya.demo@demo.veye.test"
    assert sessions["admin"] is None

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
    assert me(client) == {"member": None, "admin": None}

    assert sign_in(client, "aditya.demo@demo.veye.test", "not-the-password").status_code == 401
    assert sign_in(client, "nobody@demo.veye.test").status_code == 401

    response = sign_in(client, "aditya.demo@demo.veye.test")
    assert response.status_code == 200
    assert client.get("/api/v1/auth/me").status_code == 200

    assert client.post("/api/v1/auth/sign-out").status_code == 204
    assert me(client) == {"member": None, "admin": None}


def test_email_verification_link_is_single_use(client, mailbox):
    sign_up(client)
    token = _link(mailbox.sent[0].text, "verify-email")
    assert me(client)["member"]["email_verified"] is False

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
    assert me(client)["member"] is None
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
    # A member-portal session is worthless on the admin surfaces (no admin
    # cookie at all → 401); the admin-only account has no member record and
    # cannot even open the member portal.
    assert client.get("/api/v1/admin/companion/overview").status_code == 401
    assert admin_client.get("/api/v1/members/me/health-number").status_code == 401
    assert admin_client.account["member_id"] is None
    assert admin_client.account["member_access"] is False
    assert admin_client.account["admin_access"] is True
    assert admin_client.account["portal"] == "admin"
    assert sign_in(admin_client, "cara.hogue@demo.veye.test", "CaraAdmin!2026-local").status_code == 403
    # Sign-up is a member feature only: there is no admin self-registration.
    assert client.post("/api/v1/auth/admin/sign-up", json={}).status_code in (404, 405)


def test_member_cookie_cannot_open_the_admin_portal_and_vice_versa(client, admin_client):
    """Presenting a member session under the admin cookie name (or the other
    way round) authenticates nothing: sessions belong to one portal."""
    sign_up(client)
    member_cookie = client.cookies.get("veye_member_session")
    admin_cookie = admin_client.cookies.get("veye_admin_session")
    assert member_cookie and admin_cookie

    with TestClient(app) as forged:
        forged.cookies.set("veye_admin_session", member_cookie)
        assert forged.get("/api/v1/admin/companion/overview").status_code == 401
        assert me(forged) == {"member": None, "admin": None}
    with TestClient(app) as forged:
        forged.cookies.set("veye_member_session", admin_cookie)
        assert forged.get("/api/v1/members/me/health-number").status_code == 401
        assert me(forged) == {"member": None, "admin": None}


def test_dual_access_person_lands_where_they_signed_in(client):
    """One account with a member profile AND administrator access: the portal
    chosen decides the experience, never the account's flags."""
    from app.seed.users import DUAL, seed_users

    seed_users()
    # Member portal → a member session only.
    member = sign_in(client, DUAL.email, DUAL.password)
    assert member.status_code == 200, member.text
    assert member.json()["account"]["portal"] == "member"
    assert member.json()["account"]["admin_access"] is True
    assert me(client)["member"]["email"] == DUAL.email
    assert me(client)["admin"] is None
    assert client.get("/api/v1/members/me/health-number").status_code == 200
    assert client.get("/api/v1/admin/companion/overview").status_code == 401

    # Admin portal, same browser → the admin session is added; the member
    # session is untouched.
    admin = admin_sign_in(client, DUAL.email, DUAL.password)
    assert admin.status_code == 200, admin.text
    assert admin.json()["account"]["portal"] == "admin"
    sessions = me(client)
    assert sessions["member"]["id"] == sessions["admin"]["id"] == admin.json()["account"]["id"]
    assert client.get("/api/v1/members/me/health-number").status_code == 200
    assert client.get("/api/v1/admin/companion/overview").status_code == 200

    # Signing out of one portal leaves the other signed in.
    assert client.post("/api/v1/auth/admin/sign-out").status_code == 204
    sessions = me(client)
    assert sessions["admin"] is None and sessions["member"] is not None
    assert client.get("/api/v1/admin/companion/overview").status_code == 401
    assert client.get("/api/v1/members/me/health-number").status_code == 200

    assert admin_sign_in(client, DUAL.email, DUAL.password).status_code == 200
    assert client.post("/api/v1/auth/sign-out").status_code == 204
    sessions = me(client)
    assert sessions["member"] is None and sessions["admin"] is not None
    assert client.get("/api/v1/admin/companion/overview").status_code == 200
    assert client.get("/api/v1/members/me/health-number").status_code == 401


def test_member_only_account_is_refused_by_the_admin_portal(client):
    sign_up(client)
    refused = admin_sign_in(client, "aditya.demo@demo.veye.test", MEMBER_PASSWORD)
    assert refused.status_code == 403
    assert "administrator access" in refused.json()["detail"]
    # …and a wrong password on the admin portal stays a plain 401, so the
    # refusal never confirms a password.
    assert admin_sign_in(client, "aditya.demo@demo.veye.test", "not-the-password").status_code == 401
    assert me(client)["admin"] is None


def test_admin_origin_reset_link_returns_to_the_admin_sign_in(admin_client, mailbox):
    forgot = admin_client.post("/api/v1/auth/forgot-password", json={"email": "cara.hogue@demo.veye.test", "portal": "admin"})
    assert forgot.status_code == 202
    link_text = mailbox.sent[-1].text
    assert "reset-password?token=" in link_text and "&portal=admin" in link_text
    token = re.search(r"token=([A-Za-z0-9_-]+)&portal=admin", link_text).group(1)
    done = admin_client.post("/api/v1/auth/reset-password", json={"token": token, "password": "brand-new-admin-password-2026"})
    assert done.status_code == 200
    # Reset ends every session of the account, on both portals.
    assert me(admin_client) == {"member": None, "admin": None}
    assert admin_sign_in(admin_client, "cara.hogue@demo.veye.test", "brand-new-admin-password-2026").status_code == 200
    # The reset token never granted portal access: the member portal still refuses the admin-only account.
    assert sign_in(admin_client, "cara.hogue@demo.veye.test", "brand-new-admin-password-2026").status_code == 403


def test_member_a_cannot_read_member_b(client):
    sign_up(client)
    a_member_id = me(client)["member"]["member_id"]
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
