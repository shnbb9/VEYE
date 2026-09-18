"""Outbound privacy layer for the Companion.

Primary control  — the structured allowlist: `MemberContext` only has the
                   fields it declares; identifiers have nowhere to live.
Secondary control — free-text scrubbing of the member's own words and any
                   string the prompt carries, using pluggable detectors
                   (regex today; a stronger detector implements `PiiDetector`).
Final assertion   — the assembled LLM request is checked once more; if a
                   known identifier is still present the request is refused
                   rather than sent."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Protocol

from app.auth.principal import CurrentPrincipal
from app.companion.providers.llm import LLMMessage, LLMRequest
from app.observability.masking import KnownIdentifiers, contains_identifier, term_pattern


@dataclass(frozen=True)
class PiiSpan:
    start: int
    end: int
    kind: str


class PiiDetector(Protocol):
    name: str

    def find(self, text: str) -> list[PiiSpan]: ...


class RegexPiiDetector:
    """Obvious identifiers: email addresses, phone numbers, UUIDs and long digit runs."""

    name = "regex"
    _patterns = (
        ("email", re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")),
        ("id", re.compile(r"\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b")),
        ("phone", re.compile(r"(?<![\w-])(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}(?![\w-])")),
        ("number", re.compile(r"(?<!\d)\d{7,}(?!\d)")),
    )

    def find(self, text: str) -> list[PiiSpan]:
        spans: list[PiiSpan] = []
        for kind, pattern in self._patterns:
            spans.extend(PiiSpan(m.start(), m.end(), kind) for m in pattern.finditer(text))
        return spans


class KnownIdentifierDetector:
    """The member's own identifiers, wherever they appear in free text."""

    name = "known-identifiers"

    def __init__(self, known: KnownIdentifiers) -> None:
        self.patterns = [term_pattern(term) for term in known.all_terms()]

    def find(self, text: str) -> list[PiiSpan]:
        spans: list[PiiSpan] = []
        for pattern in self.patterns:
            spans.extend(PiiSpan(m.start(), m.end(), "identifier") for m in pattern.finditer(text))
        return spans


@dataclass
class PrivacyReport:
    redactions: dict[str, int] = field(default_factory=dict)

    def add(self, kind: str, count: int = 1) -> None:
        self.redactions[kind] = self.redactions.get(kind, 0) + count

    @property
    def total(self) -> int:
        return sum(self.redactions.values())


class PrivacyViolation(RuntimeError):
    pass


def known_identifiers_for(principal: CurrentPrincipal) -> KnownIdentifiers:
    ids = [str(principal.user_id)]
    if principal.member_id is not None:
        ids.append(str(principal.member_id))
    if principal.session_id is not None:
        ids.append(str(principal.session_id))
    names = tuple(n for n in (principal.first_name, principal.last_name, principal.display_name) if n and len(n) >= 2)
    return KnownIdentifiers(names=names, emails=(principal.email,), ids=tuple(ids))


class OutboundPrivacyFilter:
    def __init__(self, known: KnownIdentifiers, detectors: list[PiiDetector] | None = None) -> None:
        self.known = known
        self.detectors = detectors or [KnownIdentifierDetector(known), RegexPiiDetector()]

    def scrub(self, text: str, report: PrivacyReport | None = None) -> str:
        spans: list[PiiSpan] = []
        for detector in self.detectors:
            spans.extend(detector.find(text))
        if not spans:
            return text
        spans.sort(key=lambda s: (s.start, -s.end))
        out: list[str] = []
        cursor = 0
        for span in spans:
            if span.start < cursor:
                continue
            out.append(text[cursor:span.start])
            out.append(f"[REDACTED:{span.kind}]")
            if report is not None:
                report.add(span.kind)
            cursor = span.end
        out.append(text[cursor:])
        return "".join(out)

    def filter_request(self, request: LLMRequest) -> tuple[LLMRequest, PrivacyReport]:
        report = PrivacyReport()
        system = self.scrub(request.system, report)
        messages = tuple(LLMMessage(role=m.role, content=self.scrub(m.content, report)) for m in request.messages)
        filtered = LLMRequest(system=system, messages=messages, max_tokens=request.max_tokens,
                              temperature=request.temperature, metadata=dict(request.metadata))
        for value in (filtered.system, *(m.content for m in filtered.messages), *filtered.metadata.values()):
            if contains_identifier(value, self.known):
                raise PrivacyViolation("A direct identifier survived the outbound privacy filter; the request was not sent.")
        return filtered, report
