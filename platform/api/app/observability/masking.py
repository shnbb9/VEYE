"""Client-side telemetry masking.

Every telemetry payload passes through `mask_payload` before it reaches any
exporter — the local database exporter included — so the exported shape is
the same whether or not Langfuse is switched on.

Two layers:
1. Structural: keys that can only ever carry a direct identifier are removed
   wherever they appear (`email`, `first_name`, `member_id`, ...).
2. Content: string values are scrubbed for known identifiers of the member in
   question (their name, address, ids) and for generic patterns (email
   addresses, phone numbers, UUIDs, long digit runs).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

DENIED_KEYS = frozenset({
    "email", "email_address", "first_name", "last_name", "full_name", "name", "display_name", "phone", "phone_number",
    "dob", "date_of_birth", "birth_date", "address", "postal_code", "zip", "member_id", "user_id", "account_id",
    "session_cookie", "password", "password_hash", "token", "cookie",
})

# Structural identifiers of approved knowledge and of the trace itself: never
# personal, explicitly part of the production-safe telemetry shape.
# member_ref / session_ref are keyed pseudonyms (never a direct identifier); without
# this the long-digit rule occasionally redacted the middle of a hex pseudonym.
PRESERVED_ID_KEYS = frozenset({"source_id", "document_id", "chunk_id", "trace_id", "conversation_id", "message_id", "member_ref", "session_ref"})

_EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
_UUID_RE = re.compile(r"\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b")
_PHONE_RE = re.compile(r"(?<![\w-])(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}(?![\w-])")
_LONG_DIGITS_RE = re.compile(r"(?<!\d)\d{7,}(?!\d)")


@dataclass(frozen=True)
class KnownIdentifiers:
    """Direct identifiers of the person a payload is about. Used to redact
    them wherever they might appear inside free text."""

    names: tuple[str, ...] = ()
    emails: tuple[str, ...] = ()
    ids: tuple[str, ...] = ()
    extra: tuple[str, ...] = field(default_factory=tuple)

    def all_terms(self) -> list[str]:
        terms = [t.strip() for t in (*self.names, *self.emails, *self.ids, *self.extra) if t and len(t.strip()) >= 2]
        # Longest first so "Aditya Demo" is replaced before "Aditya".
        return sorted(set(terms), key=len, reverse=True)


def term_pattern(term: str) -> re.Pattern:
    """Whole-word for names (so "Al" does not hit "meal"); exact for emails/ids."""
    if re.fullmatch(r"[A-Za-z][A-Za-z '-]*", term):
        return re.compile(rf"(?<![A-Za-z]){re.escape(term)}(?![A-Za-z])", re.IGNORECASE)
    return re.compile(re.escape(term), re.IGNORECASE)


def scrub_text(text: str, known: KnownIdentifiers | None = None) -> str:
    result = text
    if known:
        for term in known.all_terms():
            result = term_pattern(term).sub("[REDACTED]", result)
    result = _EMAIL_RE.sub("[REDACTED:email]", result)
    result = _UUID_RE.sub("[REDACTED:id]", result)
    result = _PHONE_RE.sub("[REDACTED:phone]", result)
    result = _LONG_DIGITS_RE.sub("[REDACTED:number]", result)
    return result


def mask_payload(value: Any, known: KnownIdentifiers | None = None) -> Any:
    if isinstance(value, dict):
        masked: dict[str, Any] = {}
        for key, item in value.items():
            name = str(key).lower()
            if name in DENIED_KEYS:
                continue
            if name in PRESERVED_ID_KEYS and isinstance(item, str):
                # Keep knowledge/trace ids, unless the value is one of the person's own ids.
                masked[str(key)] = "[REDACTED:id]" if known and item in known.ids else item
                continue
            masked[str(key)] = mask_payload(item, known)
        return masked
    if isinstance(value, (list, tuple)):
        return [mask_payload(item, known) for item in value]
    if isinstance(value, str):
        return scrub_text(value, known)
    return value


def contains_identifier(text: str, known: KnownIdentifiers | None = None) -> bool:
    """True when free text still carries a direct identifier. Used by tests and
    by the outbound privacy filter as a final assertion."""
    if known and any(term_pattern(term).search(text) for term in known.all_terms()):
        return True
    return bool(_EMAIL_RE.search(text) or _UUID_RE.search(text) or _PHONE_RE.search(text))
