"""What a real recipient sees, as opposed to what a developer sees.

Three things have to be true of production email and are not true by default:
the message must not claim to come from a development environment, a reply
must reach somebody or not be invited at all, and an address change must be
visible to the mailbox that lost the account.
"""

from __future__ import annotations

import pytest

from app.notifications import templates
from tests.conftest import MEMBER_PASSWORD
from app.notifications.email import (
    EmailMessage,
    InMemoryEmailProvider,
    LocalSmtpEmailProvider,
    apply_reply_to,
    build_email_provider,
)


@pytest.fixture(autouse=True)
def restore_presentation():
    """These tests change process-wide presentation; put it back."""
    before = templates.presentation()
    yield
    templates.configure(environment=before.environment, reply_to=before.reply_to)


# ---- the development footer ------------------------------------------------

def test_a_production_message_never_says_it_came_from_a_development_environment():
    templates.configure(environment="local")
    local = templates.password_reset("Maya", "https://veye.example/reset?token=x", 30)
    assert "not a live message" in local.html
    assert "local environment" in local.html

    templates.configure(environment="production")
    live = templates.password_reset("Maya", "https://veye.example/reset?token=x", 30)
    assert "Veye &mdash; Nutrition Reimagined." in live.html
    for leak in ("development", "not a live message", "local environment"):
        assert leak not in live.html
    # The wording of the message itself is untouched by the environment.
    assert live.text == local.text


def test_every_template_carries_the_environment_footer_and_none_hardcodes_the_old_line():
    templates.configure(environment="production")
    rendered = [
        templates.welcome("Maya", "https://veye.example"),
        templates.email_verification("Maya", "https://veye.example/v?token=x", 48),
        templates.password_reset("Maya", "https://veye.example/r?token=x", 30),
        templates.admin_invitation("Avery", "https://veye.example/a?token=x", 72, "Cara Hogue"),
        templates.email_change("Maya", "https://veye.example/c?token=x", 24, "new@veye.example"),
        templates.email_changed_notice("Maya", "old@veye.example", "new@veye.example", "contact@veye.co"),
        templates.account_deactivated("Maya", "contact@veye.co"),
        templates.request_reply("A question", "Here is the answer.", "contact@veye.co"),
        templates.companion_escalation("Cara", "sensitive", "https://veye.example/admin"),
    ]
    assert len(rendered) == 9
    for message in rendered:
        assert "local development environment" not in message.html
        assert "Veye &mdash; Nutrition Reimagined." in message.html


# ---- Reply-To --------------------------------------------------------------

def test_reply_to_is_applied_once_at_the_transport_and_never_overrides_a_message():
    message = EmailMessage(to="someone@veye.example", subject="s", text="t")
    assert "Reply-To" not in apply_reply_to(message, None).headers
    assert "Reply-To" not in apply_reply_to(message, "").headers
    assert apply_reply_to(message, "help@veye.co").headers["Reply-To"] == "help@veye.co"
    # A message that chose its own keeps it.
    own = EmailMessage(to="a@b.c", subject="s", text="t", headers={"Reply-To": "someone-else@veye.co"})
    assert apply_reply_to(own, "help@veye.co").headers["Reply-To"] == "someone-else@veye.co"


def test_every_provider_carries_the_configured_reply_to():
    for provider in (
        build_email_provider("memory", host="h", port=1, sender="Veye <no-reply@veye.local>", reply_to="help@veye.co"),
        build_email_provider("local-smtp", host="h", port=1, sender="Veye <no-reply@veye.local>", reply_to="help@veye.co"),
        build_email_provider("smtp", host="smtp.example", port=587, sender="Veye <contact@veye.co>",
                             username="u", password="p", reply_to="help@veye.co"),
    ):
        assert provider.describe()["reply_to"] == "help@veye.co"
    assert isinstance(build_email_provider("memory", host="h", port=1, sender="s"), InMemoryEmailProvider)
    assert build_email_provider("local-smtp", host="h", port=1, sender="s").describe()["reply_to"] is None


def test_a_sent_message_really_carries_the_header():
    """The memory provider stores what would leave, not what was passed in."""
    provider = InMemoryEmailProvider(reply_to="help@veye.co")
    provider.send(EmailMessage(to="maya@veye.example", subject="Hello", text="Body"))
    assert provider.sent[-1].headers["Reply-To"] == "help@veye.co"


def test_the_mime_message_carries_reply_to(monkeypatch):
    """Through the real MIME builder, not only the dataclass."""
    sent = {}

    class FakeSmtp:
        def __init__(self, *a, **k):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def send_message(self, mime):
            sent["mime"] = mime

        def quit(self):
            pass

        def close(self):
            pass

    monkeypatch.setattr("smtplib.SMTP", FakeSmtp)
    LocalSmtpEmailProvider("127.0.0.1", 1025, "Veye <no-reply@veye.local>", reply_to="help@veye.co").send(
        EmailMessage(to="maya@veye.example", subject="Hello", text="Body"))
    assert sent["mime"]["Reply-To"] == "help@veye.co"
    assert sent["mime"]["To"] == "maya@veye.example"


# ---- wording follows the configuration -------------------------------------

def test_wording_only_invites_a_reply_when_one_would_reach_somebody():
    templates.configure(environment="production", reply_to=None)
    no_mailbox = templates.request_reply("Q", "A.", "contact@veye.co")
    assert "contact@veye.co" in no_mailbox.text
    assert "Replying to this message" not in no_mailbox.text

    templates.configure(environment="production", reply_to="help@veye.co")
    monitored = templates.request_reply("Q", "A.", "contact@veye.co")
    assert "Replying to this message reaches the Veye team." in monitored.text


def test_a_deactivated_member_is_never_sent_back_to_a_screen_they_cannot_open():
    templates.configure(environment="production", reply_to=None)
    message = templates.account_deactivated("Maya", "contact@veye.co")
    assert "contact@veye.co" in message.text
    # They cannot sign in, so the way back must not be inside the application.
    assert "Contact Us" not in message.text
    assert "sign in" in message.text


# ---- the old address is told -----------------------------------------------

def test_the_old_address_is_warned_when_a_member_moves_their_account(member_client, mailbox):
    asked = member_client.post("/api/v1/members/me/email",
                               json={"new_email": "moved.aditya@demo.veye.test", "password": MEMBER_PASSWORD})
    assert asked.status_code == 202, asked.text

    # The confirmation goes to the NEW address only.
    confirmation = mailbox.sent[-1]
    assert confirmation.to == "moved.aditya@demo.veye.test"
    link = [w for w in confirmation.text.split() if "token=" in w][0]
    token = link.split("token=")[1]

    confirmed = member_client.post("/api/v1/auth/confirm-email-change", json={"token": token})
    assert confirmed.status_code == 200, confirmed.text

    warning = mailbox.sent[-1]
    assert warning.to == "aditya.demo@demo.veye.test"          # the OLD mailbox
    assert "changed" in warning.subject.lower()
    assert "moved.aditya@demo.veye.test" in warning.text        # what it became
    assert "aditya.demo@demo.veye.test" in warning.text         # what it was
    # A warning is worth nothing to a thief: no link, no token, no password.
    assert "token=" not in warning.text
    assert "http" not in warning.text
    assert "password" not in warning.text.lower()


def test_no_warning_when_the_address_is_already_taken(member_client, mailbox):
    """A change that cannot happen must not produce a security warning about
    one that did."""
    before = len(mailbox.sent)
    refused = member_client.post("/api/v1/members/me/email",
                                 json={"new_email": "aditya.demo@demo.veye.test", "password": MEMBER_PASSWORD})
    assert refused.status_code in (409, 422)
    assert len(mailbox.sent) == before


def test_the_warning_is_not_switchable_off():
    """It is a security message, so a notification preference cannot silence
    it — the same rule the reset and invitation messages already follow."""
    from app.notifications.service import NOTIFICATION_KINDS, TRANSACTIONAL_KINDS

    assert "email_changed" in NOTIFICATION_KINDS
    assert "email_changed" in TRANSACTIONAL_KINDS
