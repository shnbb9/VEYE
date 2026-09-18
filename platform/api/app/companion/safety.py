"""Output safety: the last check before a model reply reaches a member.

Deterministic rules only:
- an empty or over-long reply is replaced by the fallback;
- a reply that states a supplement/medicine amount is blocked and replaced by
  the safe response (amounts are chosen by condition, never by Sprout);
- any direct identifier pattern in the reply is redacted."""

from __future__ import annotations

import re
from dataclasses import dataclass

from app.observability.masking import KnownIdentifiers, scrub_text

RESULT_PASS = "pass"
RESULT_BLOCKED_DOSAGE = "blocked_dosage"
RESULT_BLOCKED_EMPTY = "blocked_empty"
RESULT_REDACTED_IDENTIFIER = "redacted_identifier"
RESULT_TRUNCATED = "truncated"

# Amounts in supplement/medicine units are always blocked; gram amounts are
# blocked only when the sentence is about a supplement (so approved food
# wording such as "30g of protein" passes).
_UNIT_DOSE_RE = re.compile(r"\b\d+(?:[.,]\d+)?\s?(?:mg|mcg|µg|iu|ml|capsules?|tablets?|drops?|softgels?)\b", re.IGNORECASE)
_GRAM_DOSE_RE = re.compile(r"\b\d+(?:[.,]\d+)?\s?(?:g|grams?)\b", re.IGNORECASE)
_SUPPLEMENT_RE = re.compile(
    r"\b(?:omega|epa|dha|fish oil|magnesium|vitamin|supplement|polyphenol|zinc|iron|probiotic|melatonin|medicine|medication)\b",
    re.IGNORECASE,
)
_MAX_CHARS = 1600


def states_dosage(text: str) -> bool:
    if _UNIT_DOSE_RE.search(text):
        return True
    for sentence in re.split(r"(?<=[.!?])\s+", text):
        if _GRAM_DOSE_RE.search(sentence) and _SUPPLEMENT_RE.search(sentence):
            return True
    return False


@dataclass(frozen=True)
class SafetyResult:
    text: str
    result: str
    reasons: tuple[str, ...] = ()


class OutputSafety:
    def __init__(self, *, safe_response: str, fallback: str, known: KnownIdentifiers | None = None) -> None:
        self.safe_response = safe_response
        self.fallback = fallback
        self.known = known

    def check(self, text: str) -> SafetyResult:
        candidate = (text or "").strip()
        if not candidate:
            return SafetyResult(self.fallback, RESULT_BLOCKED_EMPTY, ("empty reply",))
        if states_dosage(candidate):
            return SafetyResult(self.safe_response, RESULT_BLOCKED_DOSAGE, ("reply stated an amount",))
        reasons: list[str] = []
        result = RESULT_PASS
        scrubbed = scrub_text(candidate, self.known)
        if scrubbed != candidate:
            candidate = scrubbed
            result = RESULT_REDACTED_IDENTIFIER
            reasons.append("identifier redacted")
        if len(candidate) > _MAX_CHARS:
            candidate = candidate[:_MAX_CHARS].rsplit(" ", 1)[0] + "…"
            result = RESULT_TRUNCATED if result == RESULT_PASS else result
            reasons.append("truncated")
        return SafetyResult(candidate, result, tuple(reasons))
