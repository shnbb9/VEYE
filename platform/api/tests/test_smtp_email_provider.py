"""SmtpEmailProvider against an in-process SMTP server that REQUIRES STARTTLS
and AUTH (aiosmtpd + a throwaway certificate authority from trustme). No real
mailbox and no real credentials: every password is generated per test run."""

import logging
import secrets
import socket
import ssl

import pytest
import trustme
from aiosmtpd.controller import Controller
from aiosmtpd.smtp import AuthResult, LoginPassword

from app.core.config import Settings
from app.core.runtime import build_runtime, configure_runtime
from app.db.session import SessionLocal
from app.notifications.email import (
    EmailConfigurationError,
    EmailMessage,
    SmtpEmailProvider,
    build_email_provider,
)
from app.notifications.models import Notification, NotificationOutbox
from tests.conftest import sign_up

USERNAME = "relay-user@demo.veye.test"
SENDER = "Veye <no-reply@demo.veye.test>"
MESSAGE = EmailMessage(to="maya.demo@demo.veye.test", subject="Verify your Veye email address",
                       text="Plain text body with link http://web.test/verify-email?token=abc", html="<p>HTML body</p>")


class Collector:
    def __init__(self) -> None:
        self.messages = []

    async def handle_DATA(self, server, session, envelope):
        self.messages.append(envelope)
        return "250 Message accepted for delivery"


def _free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def _authenticator(expected_password: str):
    def check(server, session, envelope, mechanism, auth_data):
        ok = (isinstance(auth_data, LoginPassword) and auth_data.login.decode() == USERNAME
              and auth_data.password.decode() == expected_password)
        return AuthResult(success=ok, handled=False)
    return check


@pytest.fixture(scope="module")
def ca():
    return trustme.CA()


@pytest.fixture
def server_tls(ca):
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ca.issue_cert("127.0.0.1", "localhost").configure_cert(context)
    return context


@pytest.fixture
def client_tls(ca):
    context = ssl.create_default_context()
    ca.configure_trust(context)
    return context


@pytest.fixture
def password():
    return f"dummy-{secrets.token_hex(12)}"


@pytest.fixture
def starttls_server(server_tls, password):
    """STARTTLS is required before AUTH, and AUTH before any mail."""
    collector, port = Collector(), _free_port()
    controller = Controller(collector, hostname="127.0.0.1", port=port, tls_context=server_tls, require_starttls=True,
                            auth_required=True, auth_require_tls=True, authenticator=_authenticator(password))
    controller.start()
    yield port, collector
    controller.stop()


def _provider(port, client_tls, password, **overrides):
    options = {"tls_mode": "starttls", "username": USERNAME, "password": password, "timeout": 5.0, "ssl_context": client_tls}
    return SmtpEmailProvider("127.0.0.1", port, SENDER, **(options | overrides))


def _assert_secret_absent(secret: str, *texts: str) -> None:
    for text in texts:
        assert secret not in text


# ---- delivery ----------------------------------------------------------------------

def test_starttls_and_auth_deliver_the_message(starttls_server, client_tls, password, caplog, capsys):
    caplog.set_level(logging.DEBUG)
    port, collector = starttls_server
    provider = _provider(port, client_tls, password)

    result = provider.send(MESSAGE)

    assert result.accepted and result.provider == "smtp" and result.message_id and result.error is None
    assert len(collector.messages) == 1
    envelope = collector.messages[0]
    assert envelope.rcpt_tos == ["maya.demo@demo.veye.test"]
    raw = envelope.content.decode("utf-8", errors="replace")
    assert "From: Veye <no-reply@demo.veye.test>" in raw and "Subject: Verify your Veye email address" in raw
    assert "multipart/alternative" in raw and "verify-email?token=abc" in raw
    assert "@demo.veye.test>" in result.message_id  # Message-ID uses the sender's domain
    out = capsys.readouterr()
    _assert_secret_absent(password, caplog.text, out.out, out.err, repr(provider), str(provider.describe()))


@pytest.mark.filterwarnings("ignore::UserWarning:aiosmtpd.*")
def test_implicit_tls_mode_delivers(server_tls, client_tls, password):
    collector, port = Collector(), _free_port()
    # Implicit TLS (SMTPS): the whole session is encrypted from the first byte.
    # aiosmtpd only counts STARTTLS as TLS for auth_require_tls, so it is off here.
    controller = Controller(collector, hostname="127.0.0.1", port=port, ssl_context=server_tls,
                            auth_required=True, auth_require_tls=False, authenticator=_authenticator(password))
    controller.start()
    try:
        result = _provider(port, client_tls, password, tls_mode="ssl").send(MESSAGE)
    finally:
        controller.stop()
    assert result.accepted and len(collector.messages) == 1


# ---- failures are undeliverable records, never exceptions, never the password ----------------

def test_wrong_password_is_undeliverable_and_never_leaks(starttls_server, client_tls, password, caplog, capsys):
    caplog.set_level(logging.DEBUG)
    port, collector = starttls_server
    wrong = f"dummy-wrong-{secrets.token_hex(12)}"
    provider = _provider(port, client_tls, wrong)

    result = provider.send(MESSAGE)

    assert result.accepted is False and result.provider == "smtp"
    assert "SMTPAuthenticationError" in result.error and "authentication failed" in result.error
    assert collector.messages == []
    assert "Email delivery failed via smtp" in caplog.text
    out = capsys.readouterr()
    _assert_secret_absent(wrong, result.error, caplog.text, out.out, out.err, repr(provider), str(provider.describe()))
    _assert_secret_absent(password, result.error, caplog.text, out.out, out.err)


def test_server_without_starttls_is_refused_not_downgraded(client_tls, password):
    collector, port = Collector(), _free_port()
    controller = Controller(collector, hostname="127.0.0.1", port=port)  # plain SMTP, no STARTTLS offered
    controller.start()
    try:
        result = _provider(port, client_tls, password).send(MESSAGE)
    finally:
        controller.stop()
    assert result.accepted is False and "STARTTLS" in result.error
    assert collector.messages == []  # neither the credentials nor the message went out in clear


def test_untrusted_certificate_is_refused(starttls_server, password):
    port, collector = starttls_server
    result = _provider(port, ssl.create_default_context(), password).send(MESSAGE)  # system trust store only
    assert result.accepted is False and "TLS handshake or certificate verification failed" in result.error
    assert collector.messages == []


def test_unreachable_server_is_undeliverable(client_tls, password):
    result = _provider(_free_port(), client_tls, password, timeout=1.0).send(MESSAGE)
    # Linux refuses a closed port at once; Windows retries until the timeout.
    assert result.accepted is False and ("network error" in result.error or "timed out" in result.error)


def test_sign_up_survives_a_failed_login_and_records_it(client, starttls_server, client_tls, password, caplog):
    caplog.set_level(logging.DEBUG)
    port, collector = starttls_server
    wrong = f"dummy-wrong-{secrets.token_hex(12)}"
    configure_runtime(email=_provider(port, client_tls, wrong))

    response = sign_up(client, email="smtp.failure@demo.veye.test")

    assert response.status_code == 201, response.text
    assert collector.messages == []
    with SessionLocal() as db:
        rows = db.query(NotificationOutbox, Notification).join(Notification).all()
        kinds = {notification.kind: outbox for outbox, notification in rows}
        assert {"email_verification", "welcome"} <= set(kinds)
        for outbox in kinds.values():
            assert outbox.status == "failed" and outbox.provider == "smtp" and "authentication failed" in outbox.last_error
        stored = " ".join(f"{o.last_error} {n.body_text} {n.body_html} {n.context}" for o, n in rows)
    _assert_secret_absent(wrong, stored, caplog.text, response.text)


# ---- configuration and production guard -------------------------------------------------

@pytest.mark.parametrize("kind", ["local-smtp", "memory", "none"])
def test_production_refuses_development_providers(kind):
    with pytest.raises(EmailConfigurationError):
        build_email_provider(kind, host="mail", port=1025, sender=SENDER, production=True)


def test_production_refuses_smtp_without_tls():
    with pytest.raises(EmailConfigurationError):
        build_email_provider("smtp", host="smtp.example.test", port=25, sender=SENDER, production=True, tls_mode="none")


def test_production_accepts_tls_smtp():
    provider = build_email_provider("smtp", host="smtp.example.test", port=587, sender=SENDER, production=True,
                                    username=USERNAME, password="dummy-not-a-credential")
    assert provider.name == "smtp" and provider.tls_mode == "starttls"


def test_api_refuses_to_start_in_production_with_a_development_provider():
    config = Settings(database_url="sqlite:///./test-veye.db", environment="production", email_provider="local-smtp")
    with pytest.raises(EmailConfigurationError):
        build_runtime(config)


@pytest.mark.parametrize(("mode", "port", "expected"), [("auto", 465, "ssl"), ("auto", 587, "starttls"), ("", 2525, "starttls"),
                                                        ("STARTTLS", 465, "starttls"), ("none", 25, "none")])
def test_tls_mode_resolution(mode, port, expected):
    assert SmtpEmailProvider("smtp.example.test", port, SENDER, tls_mode=mode).tls_mode == expected


def test_invalid_configurations_are_refused():
    with pytest.raises(EmailConfigurationError):
        SmtpEmailProvider("", 587, SENDER)
    with pytest.raises(EmailConfigurationError):
        SmtpEmailProvider("smtp.example.test", 587, SENDER, tls_mode="tls1.0")
    with pytest.raises(EmailConfigurationError):
        SmtpEmailProvider("smtp.example.test", 587, SENDER, username=USERNAME)  # username without password
    with pytest.raises(EmailConfigurationError):
        SmtpEmailProvider("smtp.example.test", 25, SENDER, tls_mode="none", username=USERNAME, password="dummy-x")


def test_settings_mask_the_password_and_treat_blank_values_as_unset(password):
    config = Settings(database_url="sqlite:///./test-veye.db", smtp_password=password, smtp_username=USERNAME)
    _assert_secret_absent(password, repr(config), str(config), str(config.model_dump()))
    blank = Settings(database_url="sqlite:///./test-veye.db", smtp_username="", smtp_password="", smtp_tls_mode=" ")
    assert blank.smtp_username is None and blank.smtp_password is None and blank.smtp_tls_mode == "auto"
