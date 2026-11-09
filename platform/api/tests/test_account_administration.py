"""Account administration: how administrator access is granted and withdrawn,
what an administrator may do to a member's sign-in account, and the member's
own security controls.

There are no roles anywhere in here. Every administrator has exactly the same
console; these tests cover provisioning and account state, not permissions.
Each one drives the public API the way the browser does.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app
from tests.conftest import MEMBER_PASSWORD, admin_sign_in, me, sign_in, sign_up

NEW_ADMIN = "priya.ops@demo.veye.test"
NEW_PASSWORD = "Administrator!2026-local"


def _link_token(mailbox, to_email: str, needle: str) -> str:
    """The single-use token out of the newest message sent to an address."""
    sent = [m for m in mailbox.sent if m.to == to_email and needle in m.text]
    assert sent, f"no message to {to_email} containing {needle!r}; sent={[(m.to, m.subject) for m in mailbox.sent]}"
    body = sent[-1].text
    start = body.index(needle) + len(needle)
    return body[start:].split()[0].strip()


def _invite(admin_client, email=NEW_ADMIN, first="Priya", last="Ops"):
    return admin_client.post("/api/v1/admin/administrators/invite",
                             json={"email": email, "first_name": first, "last_name": last})


def _rows(admin_client) -> dict[str, dict]:
    listing = admin_client.get("/api/v1/admin/administrators")
    assert listing.status_code == 200, listing.text
    return {row["email"]: row for row in listing.json()["rows"]}


# ---------------------------------------------------------------- invitations
def test_invited_administrator_activates_the_account_and_signs_in(admin_client, mailbox):
    invited = _invite(admin_client)
    assert invited.status_code == 201, invited.text
    row = invited.json()["row"]
    assert row["invitation_status"] == "pending" and row["is_active"] is True
    assert row["accepted_at"] is None and row["invited_by"] == "Cara Hogue"
    assert invited.json()["delivery"]["status"] == "sent"

    # The invitation cannot be used as a sign-in until it is accepted.
    fresh = TestClient(app)
    assert admin_sign_in(fresh, NEW_ADMIN, NEW_PASSWORD).status_code == 401

    token = _link_token(mailbox, NEW_ADMIN, "accept-invitation?token=")
    preview = fresh.get("/api/v1/auth/admin-invitation", params={"token": token})
    assert preview.status_code == 200, preview.text
    assert preview.json()["email"] == NEW_ADMIN and preview.json()["invited_by"] == "Cara Hogue"

    accepted = fresh.post("/api/v1/auth/admin-invitation/accept", json={"token": token, "password": NEW_PASSWORD})
    assert accepted.status_code == 200, accepted.text
    # Accepting does not sign anyone in: the portal decides that, as always.
    assert me(fresh)["admin"] is None

    assert admin_sign_in(fresh, NEW_ADMIN, NEW_PASSWORD).status_code == 200
    assert me(fresh)["admin"]["email"] == NEW_ADMIN
    # …and the console it opens is the same one, not a reduced view.
    assert fresh.get("/api/v1/admin/members").status_code == 200
    assert fresh.get("/api/v1/admin/administrators").status_code == 200

    listed = _rows(admin_client)[NEW_ADMIN]
    assert listed["invitation_status"] == "accepted" and listed["accepted_at"] is not None
    assert listed["active_sessions"] == 1 and listed["also_member"] is False


def test_an_invitation_link_works_once_and_a_resend_replaces_it(admin_client, mailbox):
    _invite(admin_client)
    first_token = _link_token(mailbox, NEW_ADMIN, "accept-invitation?token=")
    user_id = _rows(admin_client)[NEW_ADMIN]["user_id"]

    resent = admin_client.post(f"/api/v1/admin/administrators/{user_id}/resend")
    assert resent.status_code == 200, resent.text
    second_token = _link_token(mailbox, NEW_ADMIN, "accept-invitation?token=")
    assert second_token != first_token

    fresh = TestClient(app)
    # The superseded link is dead…
    stale = fresh.post("/api/v1/auth/admin-invitation/accept", json={"token": first_token, "password": NEW_PASSWORD})
    assert stale.status_code == 400
    # …the newest one works, exactly once.
    assert fresh.post("/api/v1/auth/admin-invitation/accept",
                      json={"token": second_token, "password": NEW_PASSWORD}).status_code == 200
    assert fresh.post("/api/v1/auth/admin-invitation/accept",
                      json={"token": second_token, "password": NEW_PASSWORD}).status_code == 400


def test_invitations_refuse_a_weak_password_and_duplicate_invites(admin_client, mailbox):
    _invite(admin_client)
    token = _link_token(mailbox, NEW_ADMIN, "accept-invitation?token=")
    fresh = TestClient(app)
    assert fresh.post("/api/v1/auth/admin-invitation/accept", json={"token": token, "password": "short"}).status_code == 422
    assert fresh.post("/api/v1/auth/admin-invitation/accept", json={"token": token, "password": NEW_PASSWORD}).status_code == 200
    # Inviting someone who already has console access is a conflict, not a second account.
    assert _invite(admin_client).status_code == 409
    assert len(_rows(admin_client)) == 2


def test_a_revoked_invitation_cannot_be_accepted(admin_client, mailbox):
    _invite(admin_client)
    token = _link_token(mailbox, NEW_ADMIN, "accept-invitation?token=")
    user_id = _rows(admin_client)[NEW_ADMIN]["user_id"]
    assert admin_client.post(f"/api/v1/admin/administrators/{user_id}/revoke-invitation").status_code == 200

    fresh = TestClient(app)
    assert fresh.post("/api/v1/auth/admin-invitation/accept",
                      json={"token": token, "password": NEW_PASSWORD}).status_code == 400
    assert admin_sign_in(fresh, NEW_ADMIN, NEW_PASSWORD).status_code == 401


def test_an_existing_member_can_be_invited_and_keeps_both_doors(client, admin_client, mailbox):
    assert sign_up(client).status_code == 201
    member_email = client.get("/api/v1/auth/me").json()["member"]["email"]

    invited = _invite(admin_client, email=member_email, first="Aditya", last="Demo")
    assert invited.status_code == 201, invited.text
    assert invited.json()["row"]["also_member"] is True
    token = _link_token(mailbox, member_email, "accept-invitation?token=")
    assert client.post("/api/v1/auth/admin-invitation/accept",
                       json={"token": token, "password": NEW_PASSWORD}).status_code == 200

    both = TestClient(app)
    # The member password still opens the member application…
    assert sign_in(both, member_email, MEMBER_PASSWORD).status_code == 401  # accepting set a new password
    assert sign_in(both, member_email, NEW_PASSWORD).status_code == 200
    # …and the same person may open the console through its own door.
    assert admin_sign_in(both, member_email, NEW_PASSWORD).status_code == 200
    sessions = me(both)
    assert sessions["member"]["email"] == member_email and sessions["admin"]["email"] == member_email


# ---------------------------------------------------------------- administrator state
def test_an_administrator_cannot_switch_off_their_own_access_or_the_last_one(admin_client):
    rows = _rows(admin_client)
    cara = rows["cara.hogue@demo.veye.test"]
    assert cara["is_self"] is True
    assert admin_client.post(f"/api/v1/admin/administrators/{cara['user_id']}/deactivate").status_code == 409
    assert admin_client.post(f"/api/v1/admin/administrators/{cara['user_id']}/revoke-invitation").status_code == 409
    # Still able to use the console afterwards.
    assert admin_client.get("/api/v1/admin/members").status_code == 200


def test_deactivating_an_administrator_ends_their_session_at_once(admin_client, mailbox):
    _invite(admin_client)
    token = _link_token(mailbox, NEW_ADMIN, "accept-invitation?token=")
    priya = TestClient(app)
    priya.post("/api/v1/auth/admin-invitation/accept", json={"token": token, "password": NEW_PASSWORD})
    assert admin_sign_in(priya, NEW_ADMIN, NEW_PASSWORD).status_code == 200
    assert priya.get("/api/v1/admin/members").status_code == 200

    user_id = _rows(admin_client)[NEW_ADMIN]["user_id"]
    off = admin_client.post(f"/api/v1/admin/administrators/{user_id}/deactivate")
    assert off.status_code == 200, off.text
    assert off.json()["row"]["is_active"] is False and off.json()["row"]["deactivated_at"] is not None

    # The cookie they already hold is worthless now.
    assert priya.get("/api/v1/admin/members").status_code == 401
    assert admin_sign_in(priya, NEW_ADMIN, NEW_PASSWORD).status_code == 401

    back = admin_client.post(f"/api/v1/admin/administrators/{user_id}/reactivate")
    assert back.status_code == 200 and back.json()["row"]["is_active"] is True
    assert admin_sign_in(priya, NEW_ADMIN, NEW_PASSWORD).status_code == 200


def test_administrator_actions_are_audited_and_need_the_console(admin_client, client):
    _invite(admin_client)
    actions = [e["action"] for e in admin_client.get("/api/v1/admin/companion/advanced/audit").json()]
    assert "administrator.invited" in actions
    # A member session cannot see or use any of it.
    assert sign_up(client).status_code == 201
    assert client.get("/api/v1/admin/administrators").status_code == 401
    assert client.post("/api/v1/admin/administrators/invite",
                       json={"email": "x@demo.veye.test", "first_name": "X"}).status_code == 401


# ---------------------------------------------------------------- member accounts
def test_an_administrator_can_deactivate_and_restore_a_member_account(member_client, admin_client, mailbox):
    member_id = member_client.account["member_id"]
    assert member_client.get("/api/v1/members/me/profile").status_code in (200, 405)

    off = admin_client.post(f"/api/v1/admin/members/{member_id}/deactivate")
    assert off.status_code == 200, off.text
    assert off.json()["account"]["is_active"] is False
    assert off.json()["delivery"]["status"] == "sent"

    # Signed out immediately, and the password no longer opens the door.
    assert member_client.get("/api/v1/members/me/sessions").status_code == 401
    locked = TestClient(app)
    assert sign_in(locked, "aditya.demo@demo.veye.test").status_code == 401

    assert admin_client.post(f"/api/v1/admin/members/{member_id}/deactivate").status_code == 409
    assert admin_client.post(f"/api/v1/admin/members/{member_id}/reactivate").status_code == 200
    assert sign_in(locked, "aditya.demo@demo.veye.test").status_code == 200
    # Member 360 reports the account state the page shows.
    account = admin_client.get(f"/api/v1/admin/members/{member_id}").json()["account"]
    assert account["is_active"] is True and account["email"] == "aditya.demo@demo.veye.test"
    assert account["admin_access"] is False and account["active_sessions"] >= 1


def test_an_administrator_can_resend_verification_and_a_reset_link_but_never_sets_a_password(member_client, admin_client, mailbox):
    member_id = member_client.account["member_id"]
    resent = admin_client.post(f"/api/v1/admin/members/{member_id}/resend-verification")
    assert resent.status_code == 200 and resent.json()["delivery"]["status"] == "sent"

    reset = admin_client.post(f"/api/v1/admin/members/{member_id}/send-password-reset")
    assert reset.status_code == 200 and reset.json()["delivery"]["status"] == "sent"
    token = _link_token(mailbox, "aditya.demo@demo.veye.test", "reset-password?token=")

    # Only the person holding the mailbox chooses the new password.
    chosen = TestClient(app)
    assert chosen.post("/api/v1/auth/reset-password", json={"token": token, "password": "a-brand-new-secret"}).status_code == 200
    assert sign_in(chosen, "aditya.demo@demo.veye.test", "a-brand-new-secret").status_code == 200
    # No admin route exposes or sets a password.
    assert admin_client.post(f"/api/v1/admin/members/{member_id}/set-password",
                             json={"password": "x"}).status_code in (404, 405)


def test_a_members_console_access_is_managed_on_the_administrators_page(admin_client, client, mailbox):
    assert sign_up(client).status_code == 201
    member_email = client.get("/api/v1/auth/me").json()["member"]["email"]
    member_id = client.get("/api/v1/auth/me").json()["member"]["member_id"]
    _invite(admin_client, email=member_email, first="Aditya", last="Demo")
    token = _link_token(mailbox, member_email, "accept-invitation?token=")
    client.post("/api/v1/auth/admin-invitation/accept", json={"token": token, "password": NEW_PASSWORD})

    # The member page refuses to act on someone who also holds the console.
    refused = admin_client.post(f"/api/v1/admin/members/{member_id}/deactivate")
    assert refused.status_code == 409 and "Administrators" in refused.json()["detail"]


# ---------------------------------------------------------------- member security
def test_a_member_changes_their_password_and_stays_signed_in_here_only(member_client):
    other_device = TestClient(app)
    assert sign_in(other_device, "aditya.demo@demo.veye.test").status_code == 200

    wrong = member_client.post("/api/v1/members/me/password",
                               json={"current_password": "not-it", "new_password": "a-brand-new-secret"})
    assert wrong.status_code == 403
    short = member_client.post("/api/v1/members/me/password",
                               json={"current_password": MEMBER_PASSWORD, "new_password": "short"})
    assert short.status_code == 422
    same = member_client.post("/api/v1/members/me/password",
                              json={"current_password": MEMBER_PASSWORD, "new_password": MEMBER_PASSWORD})
    assert same.status_code == 422

    changed = member_client.post("/api/v1/members/me/password",
                                 json={"current_password": MEMBER_PASSWORD, "new_password": "a-brand-new-secret"})
    assert changed.status_code == 200, changed.text
    # This session survives; the other device is signed out.
    assert member_client.get("/api/v1/members/me/sessions").status_code == 200
    assert other_device.get("/api/v1/members/me/sessions").status_code == 401
    assert sign_in(other_device, "aditya.demo@demo.veye.test", MEMBER_PASSWORD).status_code == 401
    assert sign_in(other_device, "aditya.demo@demo.veye.test", "a-brand-new-secret").status_code == 200


def test_a_member_sees_their_sessions_and_can_sign_out_everywhere_else(member_client):
    for _ in range(2):
        extra = TestClient(app)
        assert sign_in(extra, "aditya.demo@demo.veye.test").status_code == 200

    listed = member_client.get("/api/v1/members/me/sessions")
    assert listed.status_code == 200, listed.text
    rows = listed.json()["rows"]
    assert len(rows) == 3 and sum(1 for r in rows if r["current"]) == 1
    assert {r["portal"] for r in rows} == {"member"}

    ended = member_client.post("/api/v1/members/me/sessions/revoke-others")
    assert ended.status_code == 200 and "2" in ended.json()["message"]
    assert len(member_client.get("/api/v1/members/me/sessions").json()["rows"]) == 1
    # Nothing to do the second time, and this session is never the one ended.
    assert member_client.post("/api/v1/members/me/sessions/revoke-others").status_code == 200
    assert member_client.get("/api/v1/members/me/sessions").status_code == 200


def test_a_member_moves_their_account_to_a_new_address_only_from_that_mailbox(member_client, mailbox):
    new_email = "aditya.new@demo.veye.test"
    wrong_password = member_client.post("/api/v1/members/me/email",
                                        json={"new_email": new_email, "password": "not-it"})
    assert wrong_password.status_code == 403

    asked = member_client.post("/api/v1/members/me/email", json={"new_email": new_email, "password": MEMBER_PASSWORD})
    assert asked.status_code == 202, asked.text
    # The confirmation goes to the NEW address, never the old one.
    assert mailbox.sent[-1].to == new_email
    assert member_client.get("/api/v1/auth/me").json()["member"]["email"] == "aditya.demo@demo.veye.test"

    token = _link_token(mailbox, new_email, "confirm-email?token=")
    confirmed = member_client.post("/api/v1/auth/confirm-email-change", json={"token": token})
    assert confirmed.status_code == 200, confirmed.text

    # The identity moved, so everyone signs in again — with the new address.
    assert member_client.get("/api/v1/members/me/sessions").status_code == 401
    after = TestClient(app)
    assert sign_in(after, "aditya.demo@demo.veye.test").status_code == 401
    assert sign_in(after, new_email).status_code == 200


def test_an_email_change_can_be_cancelled_and_never_takes_a_used_address(member_client, mailbox):
    taken = TestClient(app)
    assert sign_up(taken, email="maya.demo@demo.veye.test", first_name="Maya").status_code == 201
    clash = member_client.post("/api/v1/members/me/email",
                               json={"new_email": "maya.demo@demo.veye.test", "password": MEMBER_PASSWORD})
    assert clash.status_code == 409

    assert member_client.post("/api/v1/members/me/email",
                              json={"new_email": "aditya.new@demo.veye.test", "password": MEMBER_PASSWORD}).status_code == 202
    token = _link_token(mailbox, "aditya.new@demo.veye.test", "confirm-email?token=")
    assert member_client.delete("/api/v1/members/me/email").status_code == 200
    # The cancelled link is dead and the address is unchanged.
    assert member_client.post("/api/v1/auth/confirm-email-change", json={"token": token}).status_code == 400
    assert member_client.get("/api/v1/auth/me").json()["member"]["email"] == "aditya.demo@demo.veye.test"


def test_member_security_routes_are_the_members_own_and_need_a_member_session(client, admin_client):
    assert client.get("/api/v1/members/me/sessions").status_code == 401
    assert client.post("/api/v1/members/me/password",
                       json={"current_password": "x", "new_password": "y"}).status_code == 401
    # An administrator session is not a member session.
    assert admin_client.get("/api/v1/members/me/sessions").status_code == 401
    assert admin_client.post("/api/v1/members/me/sessions/revoke-others").status_code == 401


def test_qa_cleanup_removes_invited_console_accounts_but_never_a_seeded_one(admin_client, mailbox):
    """The suite invites administrators; housekeeping has to take them away
    again, or the Administrators page fills up run after run. Seeded console
    accounts and anyone holding a member profile are never touched."""
    from app.seed.users import seed_users

    seed_users()
    assert _invite(admin_client, email="e2e.mubb7gjx@demo.veye.test", first="Ember", last="Test").status_code == 201
    before = set(_rows(admin_client))  # keyed by email
    assert "e2e.mubb7gjx@demo.veye.test" in before
    assert "cara.hogue@demo.veye.test" in before

    cleaned = admin_client.post("/api/v1/admin/qa/cleanup-synthetic-members", json={"prefixes": ["e2e"]})
    assert cleaned.status_code == 200, cleaned.text
    assert cleaned.json()["removed"] == ["e2e.mubb7gjx@demo.veye.test"]

    after = set(_rows(admin_client))
    assert "e2e.mubb7gjx@demo.veye.test" not in after
    # Every seeded administrator survives, including the dual-access account.
    assert {"cara.hogue@demo.veye.test", "priya.ops@demo.veye.test", "jordan.dual@demo.veye.test"} <= after


# ---------------------------------------------------------------- the administrator's own account
ADMIN_EMAIL = "cara.hogue@demo.veye.test"
ADMIN_PASSWORD = "CaraAdmin!2026-local"


def test_an_administrator_changes_their_own_password_from_the_console(admin_client):
    """The console half of the member's Sign-in details: this session lives,
    every other one ends, and the old password stops opening the door."""
    other_console = TestClient(app)
    assert admin_sign_in(other_console, ADMIN_EMAIL, ADMIN_PASSWORD).status_code == 200

    wrong = admin_client.post("/api/v1/admin/account/password",
                              json={"current_password": "not-it", "new_password": "a-brand-new-secret"})
    assert wrong.status_code == 403
    short = admin_client.post("/api/v1/admin/account/password",
                              json={"current_password": ADMIN_PASSWORD, "new_password": "short"})
    assert short.status_code == 422

    changed = admin_client.post("/api/v1/admin/account/password",
                                json={"current_password": ADMIN_PASSWORD, "new_password": "a-brand-new-secret"})
    assert changed.status_code == 200, changed.text

    # This console session survives; the other one is out.
    assert admin_client.get("/api/v1/admin/members").status_code == 200
    assert other_console.get("/api/v1/admin/members").status_code == 401
    assert admin_sign_in(other_console, ADMIN_EMAIL, ADMIN_PASSWORD).status_code == 401
    assert admin_sign_in(other_console, ADMIN_EMAIL, "a-brand-new-secret").status_code == 200


def test_an_administrator_sees_and_ends_their_own_sessions_only(admin_client, client):
    # A member signed in elsewhere must not appear in, or be ended by, this list.
    assert sign_up(client).status_code == 201
    for _ in range(2):
        extra = TestClient(app)
        assert admin_sign_in(extra, ADMIN_EMAIL, ADMIN_PASSWORD).status_code == 200

    listed = admin_client.get("/api/v1/admin/account/sessions")
    assert listed.status_code == 200, listed.text
    rows = listed.json()["rows"]
    assert len(rows) == 3 and sum(1 for r in rows if r["current"]) == 1
    assert {r["portal"] for r in rows} == {"admin"}

    ended = admin_client.post("/api/v1/admin/account/sessions/revoke-others")
    assert ended.status_code == 200 and "2" in ended.json()["message"]
    assert len(admin_client.get("/api/v1/admin/account/sessions").json()["rows"]) == 1
    # The member elsewhere is untouched: a different account entirely.
    assert client.get("/api/v1/members/me/sessions").status_code == 200


def test_the_console_account_routes_need_the_console_session(client, member_client):
    for path in ("/api/v1/admin/account/sessions", "/api/v1/admin/account/password"):
        assert client.get(path).status_code in (401, 405)
    assert member_client.post("/api/v1/admin/account/password",
                              json={"current_password": MEMBER_PASSWORD, "new_password": "a-brand-new-secret"}).status_code == 401
    assert member_client.post("/api/v1/admin/account/sessions/revoke-others").status_code == 401


def test_a_dual_access_password_change_from_the_console_ends_the_member_session(admin_client):
    """One account, one password: changing it in the console signs the same
    person out of the member application, because the secret they used there
    is no longer the secret."""
    from app.seed.users import DUAL, seed_users

    seed_users()
    jordan_console = TestClient(app)
    jordan_member = TestClient(app)
    assert admin_sign_in(jordan_console, DUAL.email, DUAL.password).status_code == 200
    assert sign_in(jordan_member, DUAL.email, DUAL.password).status_code == 200

    changed = jordan_console.post("/api/v1/admin/account/password",
                                  json={"current_password": DUAL.password, "new_password": "a-brand-new-secret"})
    assert changed.status_code == 200, changed.text
    assert jordan_console.get("/api/v1/admin/members").status_code == 200
    assert jordan_member.get("/api/v1/members/me/sessions").status_code == 401
    assert sign_in(jordan_member, DUAL.email, "a-brand-new-secret").status_code == 200


def test_signing_out_everywhere_counts_only_sessions_somebody_could_use(admin_client):
    """An account that has been signed in many times carries dead rows. They
    are closed too, but the person is told about the live ones only — the
    number has to match the list they were just shown."""
    from datetime import datetime, timedelta, timezone

    from app.auth.models import AuthSession
    from app.db.session import SessionLocal

    live = TestClient(app)
    assert admin_sign_in(live, ADMIN_EMAIL, ADMIN_PASSWORD).status_code == 200

    db = SessionLocal()
    try:
        user_id = db.query(AuthSession).first().user_id
        for _ in range(3):
            db.add(AuthSession(user_id=user_id, token_hash=f"expired-{_}" * 4, portal="admin",
                               expires_at=datetime.now(timezone.utc) - timedelta(days=1)))
        db.commit()
    finally:
        db.close()

    listed = admin_client.get("/api/v1/admin/account/sessions").json()["rows"]
    assert len(listed) == 2  # the expired rows are not offered as sessions

    ended = admin_client.post("/api/v1/admin/account/sessions/revoke-others")
    assert ended.status_code == 200
    assert "1 other session was signed out" in ended.json()["message"]
    assert live.get("/api/v1/admin/members").status_code == 401
