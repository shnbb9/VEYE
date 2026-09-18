"""LocalSmtpEmailProvider against a real (in-process) SMTP server, the same
protocol path Mailpit uses in the optional Compose profile."""

import socket

from aiosmtpd.controller import Controller

from app.notifications.email import EmailMessage, LocalSmtpEmailProvider, NoEmailProvider, build_email_provider


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


def test_local_smtp_provider_delivers_multipart_message():
    collector = Collector()
    port = _free_port()
    controller = Controller(collector, hostname="127.0.0.1", port=port)
    controller.start()
    try:
        provider = LocalSmtpEmailProvider("127.0.0.1", port, "Veye <no-reply@veye.local>")
        result = provider.send(EmailMessage(to="maya.demo@demo.veye.test", subject="Verify your Veye email address",
                                            text="Plain text body with link http://web.test/verify-email?token=abc",
                                            html="<p>HTML body</p>"))
        assert result.accepted and result.provider == "local-smtp" and result.message_id
    finally:
        controller.stop()

    assert len(collector.messages) == 1
    envelope = collector.messages[0]
    assert envelope.rcpt_tos == ["maya.demo@demo.veye.test"]
    raw = envelope.content.decode("utf-8", errors="replace")
    assert "Subject: Verify your Veye email address" in raw
    assert "multipart/alternative" in raw and "text/html" in raw and "verify-email?token=abc" in raw


def test_unreachable_smtp_is_reported_not_faked():
    provider = LocalSmtpEmailProvider("127.0.0.1", _free_port(), "Veye <no-reply@veye.local>", timeout=1.0)
    result = provider.send(EmailMessage(to="x@demo.veye.test", subject="s", text="t"))
    assert result.accepted is False and result.error


def test_no_provider_is_an_explicit_failure():
    provider = build_email_provider("none", host="", port=0, sender="")
    assert isinstance(provider, NoEmailProvider)
    result = provider.send(EmailMessage(to="x@demo.veye.test", subject="s", text="t"))
    assert result.accepted is False and "No email provider" in result.error
