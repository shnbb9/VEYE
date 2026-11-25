"""Output safety: the last check before a model reply reaches a member.

Deterministic rules only:
- an empty or over-long reply is replaced by the fallback;
- a reply that states a supplement/medicine amount is blocked and replaced by
  the safe response (amounts are chosen by condition, never by Sprout);
- a reply that tells the member they have a condition, or to change a medicine,
  is blocked the same way: the prompt forbids it, and a rule the prompt alone
  keeps is a request, not a gate;
- any direct identifier pattern in the reply is redacted."""

from __future__ import annotations

import re
from dataclasses import dataclass

from app.observability.masking import KnownIdentifiers, scrub_text

RESULT_PASS = "pass"
RESULT_BLOCKED_DOSAGE = "blocked_dosage"
RESULT_BLOCKED_MEDICAL = "blocked_medical"
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
# A diagnosis: "you have diabetes", "you may be diabetic". Approved band wording
# ("You show signs of insulin resistance") states no condition and passes.
_CONDITION = (r"(?:pre-?)?diabetes|cancer|(?:heart|kidney|liver|thyroid|coeliac|celiac|autoimmune|coronary\w*) disease|hypertension|high blood pressure|"
              r"hypo(?:glyc|thyroid)\w*|hyperthyroid\w*|depression|an? eating disorder|arthritis|an? infection|pcos|an(?:a)?emia|metabolic syndrome")
_DIAGNOSIS_RE = re.compile(
    rf"\byou(?:'ve| have| (?:may|might|could|probably|likely|clearly|definitely|almost certainly|do|seem to|appear to)(?: \w+)? have|(?:'re| are) suffering from| suffer from)"
    rf"(?: (?:got|a|an|early|mild|chronic|type (?:1|2|i|ii|one|two)))* (?:{_CONDITION})\b"
    r"|\byou(?:'re| are| may be| might be| could be)(?: \w+)? (?:pre-?diabetic|diabetic|hypertensive|clinically depressed|an(?:a)?emic)\b", re.IGNORECASE)
# Telling the member to change a medicine. Telling them NOT to, or to ask
# somebody first, is the right answer and passes.
_MEDICINE_RE = re.compile(
    r"\b(?:stop|start|begin|skip|quit|discontinue|reduce|lower|increase|raise|double|halve|change|adjust|switch|come off|cut back on|cut down on|wean off)\b"
    r"(?: taking| using)?(?: (?:your|the|any|all|his|her))?(?: \w+){0,2}? (?:medications?|medicines?|meds|insulin|metformin|statins?|prescriptions?|pills?|tablets?|dosage|dose)\b",
    re.IGNORECASE)
_CAUTION_RE = re.compile(r"\b(?:do not|don't|never|should not|shouldn't|must not|avoid|before|without|ask|talk to|speak (?:to|with)|check with|consult|whether|if you)\b", re.IGNORECASE)
_MAX_CHARS = 1600


def gives_medical_direction(text: str) -> bool:
    plain = text.replace("\u2019", "'")
    if _DIAGNOSIS_RE.search(plain):
        return True
    for sentence in re.split(r"(?<=[.!?])\s+", plain):
        found = _MEDICINE_RE.search(sentence)
        # Insulin resistance is a band name; insulin is a medicine only when it is taken.
        if found and not _CAUTION_RE.search(sentence[:found.start()]) and not re.match(r"\s+resistan", sentence[found.end():], re.IGNORECASE):
            return True
    return False


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
        if gives_medical_direction(candidate):
            return SafetyResult(self.safe_response, RESULT_BLOCKED_MEDICAL, ("reply diagnosed, or directed a medicine",))
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
