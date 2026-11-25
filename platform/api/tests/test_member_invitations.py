"""Inviting someone to become a member (Cara, 15 Nov 2026).

An invitation creates nothing, decides nothing about health sharing and proves
nothing until the emailed link is used. Every way a link can go wrong — used,
replaced, withdrawn, expired, guessed, opened twice at once — ends in words,
never in an account."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app.auth.models import UserAccount
from app.db.session import SessionLocal
from app.main import app
from app.members.invitations import MemberInvitation
from app.members.models import Member
from app.notifications.email import DeliveryResult
from tests.conftest import MEMBER_PASSWORD, admin_sign_in, me, sign_in, sign_up, verify_member_email

ROUTE = "/api/v1/admin/member-invitations"
PREVIEW, ACCEPT = "/api/v1/auth/member-invitation/preview", "/api/v1/auth/member-invitation/accept"
EMAIL = "invited.person@demo.veye.test"
PASSWORD = "InvitedPerson!2026-local"


def invite(admin, email=EMAIL, **extra):
    return admin.post(ROUTE, json={"email": email, **extra})


def token(mailbox, email=EMAIL) -> str:
    sent = [m for m in mailbox.sent if m.to == email and "/accept-invitation?token=" in m.text]
    assert sent, [(m.to, m.subject) for m in mailbox.sent]
    return sent[-1].text.split("/accept-invitation?token=")[1].split()[0]


def accept(client, raw, **extra):
    return client.post(ACCEPT, json={"token": raw, "first_name": "Asha", "last_name": "Rao", "password": PASSWORD, **extra})


def accounts(email=EMAIL) -> int:
    with SessionLocal() as db:
        return db.query(UserAccount).filter(UserAccount.email == email).count()


def test_an_invitation_becomes_a_verified_member_with_their_own_empty_dashboard(admin_client, mailbox):
    sent = invite(admin_client, email="Invited.Person@Demo.Veye.Test", first_name="Asha")
    assert sent.status_code == 201, sent.text
    body = sent.json()
    assert (body["email"], body["status"], body["delivery"], body["sent_count"]) == (EMAIL, "pending", "sent", 1)
    assert accounts() == 0, "sending creates nothing"
    assert "token" not in sent.text and "hash" not in sent.text

    guest = TestClient(app)
    raw = token(mailbox)
    seen = guest.post(PREVIEW, json={"token": raw})
    assert seen.status_code == 200 and seen.json()["mode"] == "new_account" and seen.json()["invited_by"] == "Cara Hogue"
    done = accept(guest, raw)
    assert done.status_code == 200, done.text
    mine = me(guest)["member"]
    assert mine["email"] == EMAIL and mine["email_verified"] is True and mine["admin_access"] is False
    assert guest.get("/api/v1/members/me/health-number").json()["history"] == []
    assert guest.get("/api/v1/members/me/health-permission").json()["state"] == "not_requested"
    assert sign_in(TestClient(app), EMAIL, PASSWORD).status_code == 200

    row = admin_client.get(ROUTE).json()["rows"][0]
    assert row["status"] == "accepted" and row["member_id"] == mine["member_id"]


def test_a_link_works_once_and_is_replaced_by_a_resend(admin_client, mailbox):
    first = invite(admin_client).json()
    old = token(mailbox)
    again = admin_client.post(f"{ROUTE}/{first['id']}/resend")
    assert again.status_code == 200 and again.json()["sent_count"] == 2
    new = token(mailbox)
    assert new != old
    guest = TestClient(app)
    assert accept(guest, old).status_code == 400 and accounts() == 0
    assert accept(guest, new).status_code == 200
    replay = accept(TestClient(app), new)
    assert replay.status_code == 400 and "already been used" in replay.json()["detail"]
    assert accounts() == 1
    assert admin_client.post(f"{ROUTE}/{first['id']}/resend").status_code == 409
    assert admin_client.post(f"{ROUTE}/{first['id']}/revoke").status_code == 409


def test_withdrawn_expired_and_guessed_links_open_nothing(admin_client, mailbox):
    row = invite(admin_client).json()
    raw = token(mailbox)
    assert admin_client.post(f"{ROUTE}/{row['id']}/revoke").json()["status"] == "revoked"
    guest = TestClient(app)
    assert guest.post(PREVIEW, json={"token": raw}).status_code == 400
    assert accept(guest, raw).status_code == 400

    assert invite(admin_client).status_code == 201, "a withdrawn invitation does not block a new one"
    raw = token(mailbox)
    with SessionLocal() as db:
        open_row = db.query(MemberInvitation).filter(MemberInvitation.revoked_at.is_(None)).one()
        open_row.expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
        db.commit()
    assert accept(guest, raw).status_code == 400
    assert admin_client.get(ROUTE, params={"status": "expired"}).json()["total"] == 1
    assert accept(guest, "x" * 43).status_code == 400
    assert accounts() == 0
    # An expired one can be sent again, and the fresh link works.
    with SessionLocal() as db:
        expired = db.query(MemberInvitation).filter(MemberInvitation.revoked_at.is_(None)).one()
    assert admin_client.post(f"{ROUTE}/{expired.id}/resend").status_code == 200
    assert accept(guest, token(mailbox)).status_code == 200


def test_the_same_address_is_never_invited_twice_at_once(admin_client):
    assert invite(admin_client).status_code == 201
    second = invite(admin_client, email=" INVITED.person@demo.veye.test ".strip())
    assert second.status_code == 409 and "already has an invitation" in second.json()["detail"]
    from sqlalchemy.exc import IntegrityError

    with SessionLocal() as db, pytest.raises(IntegrityError):
        db.add(MemberInvitation(email=EMAIL, token_hash="b" * 64, expires_at=datetime.now(timezone.utc)))
        db.commit()


def test_people_who_need_no_invitation_are_refused_with_the_reason(admin_client, client):
    sign_up(client)
    email = me(client)["member"]["email"]
    verify_member_email(client)
    assert "already a member" in invite(admin_client, email=email).json()["detail"]
    member_id = me(client)["member"]["member_id"]
    assert admin_client.post(f"/api/v1/admin/members/{member_id}/archive", json={}).status_code == 200
    assert "archived" in invite(admin_client, email=email).json()["detail"]


def test_an_administrator_adds_a_profile_to_the_same_account_with_their_own_password(admin_client, mailbox):
    admin_email = "cara.hogue@demo.veye.test"
    assert invite(admin_client, email=admin_email).status_code == 201
    raw = token(mailbox, admin_email)
    guest = TestClient(app)
    assert guest.post(PREVIEW, json={"token": raw}).json()["mode"] == "add_profile"
    assert accept(guest, raw).status_code == 403, "the mailbox alone is not enough to change a console account"
    assert me(guest)["member"] is None
    done = accept(guest, raw, password="CaraAdmin!2026-local")
    assert done.status_code == 200, done.text
    assert accounts(admin_email) == 1
    assert me(guest)["member"]["admin_access"] is True
    assert admin_sign_in(TestClient(app), admin_email, "CaraAdmin!2026-local").status_code == 200


def test_an_address_somebody_else_registered_first_becomes_the_mailbox_owners(admin_client, mailbox):
    squatter = TestClient(app)
    assert sign_up(squatter, email=EMAIL).status_code == 201
    assert invite(admin_client).status_code == 201
    owner = TestClient(app)
    raw = token(mailbox)
    assert owner.post(PREVIEW, json={"token": raw}).json()["mode"] == "confirm_existing"
    assert accept(owner, raw).status_code == 200
    assert accounts() == 1
    assert sign_in(TestClient(app), EMAIL, MEMBER_PASSWORD).status_code == 401
    assert squatter.get("/api/v1/members/me/requests").status_code == 401


def test_a_member_by_the_time_the_link_is_opened_is_told_to_sign_in(admin_client, mailbox):
    assert invite(admin_client).status_code == 201
    raw = token(mailbox)
    person = TestClient(app)
    sign_up(person, email=EMAIL)
    verify_member_email(person)
    other = TestClient(app)
    done = accept(other, raw, password="")
    assert done.status_code == 200 and done.json()["account"] is None
    assert me(other)["member"] is None, "a link signs nobody into an account that already exists"
    assert sign_in(TestClient(app), EMAIL, MEMBER_PASSWORD).status_code == 200, "their password is untouched"


def test_two_people_pressing_accept_together_make_one_account(admin_client, mailbox, monkeypatch):
    """The second of two acceptances that both passed the checks."""
    from app.members import invitations

    invite(admin_client)
    raw = token(mailbox)
    real, raced = invitations.MemberInvitationService.mode, []

    def race(self, row):
        answer = real(self, row)
        if not raced:
            raced.append(1)
            assert accept(TestClient(app), raw).status_code == 200
        return answer

    monkeypatch.setattr(invitations.MemberInvitationService, "mode", race)
    late = accept(TestClient(app), raw, password="AnotherPassword!2026")
    assert late.status_code in (400, 409), late.text
    assert accounts() == 1
    assert sign_in(TestClient(app), EMAIL, PASSWORD).status_code == 200


def test_two_acceptances_of_a_registered_address_set_one_password(admin_client, mailbox, monkeypatch):
    """Here the account already exists, so no unique address stops the second."""
    from app.members import invitations

    sign_up(TestClient(app), email=EMAIL)
    invite(admin_client)
    raw = token(mailbox)
    real, raced = invitations.MemberInvitationService.peek, []

    def race(self, raw_token):
        row = real(self, raw_token)
        if not raced:
            raced.append(1)
            assert accept(TestClient(app), raw).status_code == 200
            # Both had decided what to do before either had done it.
            monkeypatch.setattr(invitations.MemberInvitationService, "mode", lambda self, row: invitations.MODE_EXISTING)
        return row

    monkeypatch.setattr(invitations.MemberInvitationService, "peek", race)
    late = accept(TestClient(app), raw, password="AnotherPassword!2026")
    assert late.status_code == 400, late.text
    assert sign_in(TestClient(app), EMAIL, "AnotherPassword!2026").status_code == 401
    assert sign_in(TestClient(app), EMAIL, PASSWORD).status_code == 200


def test_a_refused_email_is_shown_and_the_invitation_stands(admin_client, mailbox, monkeypatch):
    monkeypatch.setattr(type(mailbox), "send", lambda self, message: DeliveryResult(accepted=False, provider="memory", error="relay refused"))
    row = invite(admin_client).json()
    assert row["status"] == "pending" and row["delivery"] in ("retry", "failed") and row["delivery_error"] == "relay refused"


def test_weak_passwords_blank_names_and_extra_fields_are_refused_and_spend_nothing(admin_client, mailbox):
    invite(admin_client)
    raw = token(mailbox)
    guest = TestClient(app)
    assert accept(guest, raw, password="short").status_code == 422
    assert accept(guest, raw, first_name="  ").status_code == 422
    assert guest.post(ACCEPT, json={"token": raw, "password": PASSWORD, "admin_access": True}).status_code == 422
    assert invite(admin_client, email="not-an-address").status_code == 422
    assert accept(guest, raw).status_code == 200, "a refused attempt does not burn the link"


def test_only_administrators_invite_and_every_step_is_recorded(admin_client, client):
    sign_up(client)
    assert client.post(ROUTE, json={"email": EMAIL}).status_code == 401
    assert client.get(ROUTE).status_code == 401
    row = invite(admin_client).json()
    admin_client.post(f"{ROUTE}/{row['id']}/resend")
    admin_client.post(f"{ROUTE}/{row['id']}/revoke")
    from app.admin.models import AdminAuditEntry

    with SessionLocal() as db:
        actions = [a for (a,) in db.query(AdminAuditEntry.action).filter(AdminAuditEntry.entity_id == row["id"])]
    assert sorted(actions) == ["member_invitation.resent", "member_invitation.revoked", "member_invitation.sent"]


def test_deleting_a_member_removes_the_invitation_that_named_them(admin_client, mailbox):
    from app.erasure.models import ErasureRequest

    invite(admin_client)
    guest = TestClient(app)
    accept(guest, token(mailbox))
    gone = guest.post("/api/v1/members/me/erasure", json={"password": PASSWORD, "confirm": "DELETE"})
    assert gone.status_code in (200, 202), gone.text
    with SessionLocal() as db:
        assert db.query(ErasureRequest).one().state == "erased"
        assert db.query(MemberInvitation).count() == 0
        assert db.query(Member).filter(Member.email == EMAIL).count() == 0
