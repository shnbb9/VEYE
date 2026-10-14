"""EmailProvider abstraction.

Business logic only ever talks to `EmailProvider.send`, so swapping the
transport does not touch the sign-up, verification, reset or notification
flows. `smtp` is the production transport (any authenticated TLS relay, e.g.
Google Workspace); the other providers are for development and tests only.
"""

from __future__ import annotations

import logging
import smtplib
import ssl
from dataclasses import dataclass, field
from email.message import EmailMessage as MimeMessage
from email.utils import make_msgid, parseaddr
from typing import Protocol

from pydantic import SecretStr

log = logging.getLogger("veye.email")

DEVELOPMENT_PROVIDERS = frozenset({"local-smtp", "memory", "none"})
TLS_MODES = ("auto", "starttls", "ssl", "none")


class EmailConfigurationError(ValueError):
    """The email settings cannot work; raised at start-up, never per message."""


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


def _build_mime(message: EmailMessage, sender: str, domain: str) -> tuple[MimeMessage, str]:
    mime = MimeMessage()
    mime["From"] = sender
    mime["To"] = message.to
    mime["Subject"] = message.subject
    message_id = make_msgid(domain=domain)
    mime["Message-ID"] = message_id
    for key, value in message.headers.items():
        mime[key] = value
    mime.set_content(message.text)
    if message.html:
        mime.add_alternative(message.html, subtype="html")
    return mime, message_id


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
        mime, message_id = _build_mime(message, self.sender, "veye.local")
        try:
            with smtplib.SMTP(self.host, self.port, timeout=self.timeout) as smtp:
                smtp.send_message(mime)
        except (OSError, smtplib.SMTPException) as exc:
            return DeliveryResult(accepted=False, provider=self.name, error=f"{type(exc).__name__}: {exc}")
        return DeliveryResult(accepted=True, provider=self.name, message_id=message_id)

    def describe(self) -> dict[str, object]:
        return {"provider": self.name, "host": self.host, "port": self.port, "sender": self.sender}


def resolve_tls_mode(mode: str | None, port: int) -> str:
    mode = (mode or "auto").strip().lower()
    if mode not in TLS_MODES:
        raise EmailConfigurationError(f"VEYE_SMTP_TLS_MODE must be one of {', '.join(TLS_MODES)}.")
    if mode == "auto":
        return "ssl" if port == 465 else "starttls"
    return mode


class SmtpEmailProvider:
    """Authenticated SMTP over TLS to a real relay (Google Workspace, SES SMTP…).

    Certificates are always verified. A server that does not offer STARTTLS is
    refused, never used in plaintext, and credentials are only sent over TLS.
    A failed delivery (bad login, network, blocked port, TLS) is returned as an
    undeliverable result — never raised — so it cannot break sign-up. The
    password is held as a SecretStr and appears in no repr, log line or error."""

    name = "smtp"

    def __init__(self, host: str, port: int, sender: str, *, tls_mode: str | None = "auto", username: str | None = None,
                 password: SecretStr | str | None = None, timeout: float = 10.0,
                 ssl_context: ssl.SSLContext | None = None) -> None:
        if not host:
            raise EmailConfigurationError("VEYE_SMTP_HOST is required for the smtp email provider.")
        self.host = host
        self.port = int(port)
        self.sender = sender
        self.timeout = float(timeout)
        self.tls_mode = resolve_tls_mode(tls_mode, self.port)
        self.username = username or None
        if isinstance(password, str):
            password = SecretStr(password) if password else None
        self._password: SecretStr | None = password
        if bool(self.username) != bool(self._password):
            raise EmailConfigurationError("Set both VEYE_SMTP_USERNAME and VEYE_SMTP_PASSWORD, or neither.")
        if self.username and self.tls_mode == "none":
            raise EmailConfigurationError("SMTP credentials are only sent over TLS; set VEYE_SMTP_TLS_MODE to starttls or ssl.")
        # Tests inject a context that trusts their throwaway CA; production uses
        # the system trust store with hostname checking.
        self._ssl_context = ssl_context
        self._domain = parseaddr(sender)[1].rpartition("@")[2] or "veye.local"

    def __repr__(self) -> str:
        return f"SmtpEmailProvider(host={self.host!r}, port={self.port}, tls_mode={self.tls_mode!r}, auth={self._auth_state()!r})"

    def _auth_state(self) -> str:
        return "configured" if self.username else "none"

    def _context(self) -> ssl.SSLContext:
        return self._ssl_context or ssl.create_default_context()

    def send(self, message: EmailMessage) -> DeliveryResult:
        mime, message_id = _build_mime(message, self.sender, self._domain)
        smtp: smtplib.SMTP | None = None
        try:
            if self.tls_mode == "ssl":
                smtp = smtplib.SMTP_SSL(self.host, self.port, timeout=self.timeout, context=self._context())
            else:
                smtp = smtplib.SMTP(self.host, self.port, timeout=self.timeout)
                if self.tls_mode == "starttls":
                    # Raises SMTPNotSupportedError when the server does not offer
                    # STARTTLS: nothing (credentials or message) goes out in clear.
                    smtp.starttls(context=self._context())
            if self.username and self._password:
                smtp.login(self.username, self._password.get_secret_value())
            smtp.send_message(mime)
        except Exception as exc:  # any transport problem becomes an undeliverable record
            error = self._safe_error(exc)
            log.warning("Email delivery failed via smtp (host=%s port=%s tls=%s): %s", self.host, self.port, self.tls_mode, error)
            return DeliveryResult(accepted=False, provider=self.name, error=error)
        finally:
            if smtp is not None:
                try:
                    smtp.quit()
                except Exception:
                    smtp.close()
        return DeliveryResult(accepted=True, provider=self.name, message_id=message_id)

    def _safe_error(self, exc: Exception) -> str:
        """A fixed description per failure class plus the SMTP status code — never
        the server's free text, and never the password."""
        if isinstance(exc, smtplib.SMTPAuthenticationError):
            summary = "authentication failed (check VEYE_SMTP_USERNAME / VEYE_SMTP_PASSWORD)"
        elif isinstance(exc, smtplib.SMTPNotSupportedError):
            summary = "server does not offer STARTTLS or AUTH; refused to continue without it"
        elif isinstance(exc, smtplib.SMTPRecipientsRefused):
            summary = "recipient refused by the server"
        elif isinstance(exc, smtplib.SMTPSenderRefused):
            summary = "sender address refused by the server (check VEYE_EMAIL_FROM)"
        elif isinstance(exc, smtplib.SMTPResponseException):
            summary = "server rejected the message"
        elif isinstance(exc, smtplib.SMTPServerDisconnected):
            summary = "server closed the connection"
        elif isinstance(exc, (ssl.SSLError, ssl.CertificateError)):
            summary = "TLS handshake or certificate verification failed"
        elif isinstance(exc, TimeoutError):
            summary = "timed out"
        elif isinstance(exc, OSError):
            summary = "network error (connection refused, unreachable or port blocked)"
        else:
            summary = "unexpected error"
        code = getattr(exc, "smtp_code", None)
        text = f"{type(exc).__name__}: {summary}" + (f" [SMTP {code}]" if isinstance(code, int) else "")
        if self._password and self._password.get_secret_value() in text:
            text = text.replace(self._password.get_secret_value(), "***")
        return text

    def describe(self) -> dict[str, object]:
        return {"provider": self.name, "host": self.host, "port": self.port, "tls_mode": self.tls_mode,
                "sender": self.sender, "auth": self._auth_state()}


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


def build_email_provider(kind: str, *, host: str, port: int, sender: str, production: bool = False,
                         tls_mode: str | None = "auto", username: str | None = None,
                         password: SecretStr | str | None = None, timeout: float = 10.0) -> EmailProvider:
    """Built once at start-up. Invalid or unsafe settings raise here, so the API
    refuses to start rather than run with a broken or development transport."""
    if production and kind in DEVELOPMENT_PROVIDERS:
        raise EmailConfigurationError(
            f"Email provider '{kind}' is for development only; production requires VEYE_EMAIL_PROVIDER=smtp.")
    if kind == "smtp":
        provider = SmtpEmailProvider(host, port, sender, tls_mode=tls_mode, username=username, password=password, timeout=timeout)
        if production and provider.tls_mode == "none":
            raise EmailConfigurationError("Production email must use TLS: set VEYE_SMTP_TLS_MODE to starttls, ssl or auto.")
        return provider
    if kind == "local-smtp":
        return LocalSmtpEmailProvider(host, port, sender)
    if kind == "memory":
        return InMemoryEmailProvider()
    if kind == "none":
        return NoEmailProvider()
    raise EmailConfigurationError(f"Unknown email provider '{kind}'. Use smtp, local-smtp, memory or none.")
