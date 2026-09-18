"""EmailProvider abstraction.

The production provider (SES or another) is a client decision. Business logic
only ever talks to `EmailProvider.send`, so swapping the transport later does
not touch the sign-up, verification, reset or notification flows.
"""

from __future__ import annotations

import smtplib
from dataclasses import dataclass, field
from email.message import EmailMessage as MimeMessage
from email.utils import make_msgid
from typing import Protocol


@dataclass(frozen=True)
class EmailMessage:
    to: str
    subject: str
    text: str
    html: str | None = None
    headers: dict[str, str] = field(default_factory=dict)


@dataclass(frozen=True)
class DeliveryResult:
    accepted: bool
    provider: str
    message_id: str | None = None
    error: str | None = None


class EmailProvider(Protocol):
    name: str

    def send(self, message: EmailMessage) -> DeliveryResult: ...

    def describe(self) -> dict[str, object]: ...


class LocalSmtpEmailProvider:
    """Plain SMTP to a local development endpoint (Mailpit in the optional
    Compose `mail` profile). No TLS, no authentication, never a real mailbox."""

    name = "local-smtp"

    def __init__(self, host: str, port: int, sender: str, timeout: float = 5.0) -> None:
        self.host = host
        self.port = port
        self.sender = sender
        self.timeout = timeout

    def send(self, message: EmailMessage) -> DeliveryResult:
        mime = MimeMessage()
        mime["From"] = self.sender
        mime["To"] = message.to
        mime["Subject"] = message.subject
        message_id = make_msgid(domain="veye.local")
        mime["Message-ID"] = message_id
        for key, value in message.headers.items():
            mime[key] = value
        mime.set_content(message.text)
        if message.html:
            mime.add_alternative(message.html, subtype="html")
        try:
            with smtplib.SMTP(self.host, self.port, timeout=self.timeout) as smtp:
                smtp.send_message(mime)
        except (OSError, smtplib.SMTPException) as exc:
            return DeliveryResult(accepted=False, provider=self.name, error=f"{type(exc).__name__}: {exc}")
        return DeliveryResult(accepted=True, provider=self.name, message_id=message_id)

    def describe(self) -> dict[str, object]:
        return {"provider": self.name, "host": self.host, "port": self.port, "sender": self.sender}


class InMemoryEmailProvider:
    """Test double: keeps every message in memory."""

    name = "memory"

    def __init__(self) -> None:
        self.sent: list[EmailMessage] = []

    def send(self, message: EmailMessage) -> DeliveryResult:
        self.sent.append(message)
        return DeliveryResult(accepted=True, provider=self.name, message_id=f"memory-{len(self.sent)}")

    def describe(self) -> dict[str, object]:
        return {"provider": self.name, "sent": len(self.sent)}


class NoEmailProvider:
    """Explicit absence. Every message is reported as undeliverable — nothing
    is silently "sent"."""

    name = "none"

    def send(self, message: EmailMessage) -> DeliveryResult:
        return DeliveryResult(accepted=False, provider=self.name, error="No email provider is configured.")

    def describe(self) -> dict[str, object]:
        return {"provider": self.name}


def build_email_provider(kind: str, *, host: str, port: int, sender: str) -> EmailProvider:
    if kind == "local-smtp":
        return LocalSmtpEmailProvider(host, port, sender)
    if kind == "memory":
        return InMemoryEmailProvider()
    if kind == "none":
        return NoEmailProvider()
    raise ValueError(f"Unknown email provider '{kind}'. Production email is a client decision and is not configured here.")
