"""The dashboard's Personal tip.

Distinct from the Daily Health tip beside it, and deliberately so: that one is
copy an administrator publishes for everybody, and this one is written for one
member from their own summaries. They are never merged.

Three rules shape everything here.

**It is not a calculation.** A Health Number, a Balance score and a body-fat
percentage are deterministic VEYE arithmetic and stay that way. The tip is a
sentence about what the member has been doing, and if it ever starts producing
figures of its own, something has gone wrong.

**It is not advice about a condition.** No diagnosis, no supplement, no dose,
no "you should" about anything clinical. The client's documents supply those
and this does not. `UNSAFE` below is the backstop, and a tip that trips it is
dropped rather than shown.

**It is not generated on every page render.** A tip is cached against a
fingerprint of the context that produced it, so it is rewritten when the
member's own data moves or the tip gets old — not when they refresh the
dashboard. That keeps a paid model call proportional to a real change.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy.orm import Session

from app.auth.principal import CurrentPrincipal
from app.companion.context import MemberContext, MemberContextService
from app.companion.models import MemberPersonalTip
from app.companion.policy import POLICY_VERSION, PolicyDecision
from app.companion.providers.llm import DataClassification, LLMMessage, LLMRequest, classify_for
from app.health_permission.service import HealthPermissionService

log = logging.getLogger("veye.companion.tip")

# Bump when the prompt or the rules below change, so an old tip is replaced
# rather than left looking current.
TIP_VERSION = "personal-tip-2026-11-09-v1"

# How stale a tip may get even when nothing about the member has changed.
MAX_AGE = timedelta(days=7)

TIP_SCOPES = ("health_number_summary", "mood_summary", "food_pattern_summary")

MAX_CHARS = 240

SYSTEM = """You are Sprout, the Veye Companion, writing one short personal note for the member's dashboard.

Write ONE sentence, at most 35 words, in the second person, about a pattern in the summary below.

You MUST NOT:
- give medical advice, name a condition, or suggest it might exist
- recommend a supplement, a dose, a medicine or a test
- state or recalculate any score, percentage or number
- promise an outcome, or imply Veye has reviewed anything clinically
- greet, sign off, use the member's name, or ask a question

Say something true about their own recorded habit and leave it there. If the summary
does not support anything worth saying, reply with exactly: NOTHING_TO_SAY
"""

# Anything matching and the tip is dropped. The model is instructed above; this
# is what happens when it does not listen.
UNSAFE_WORDS = re.compile(
    r"\b(diagnos\w*|disease|disorder|syndrome|deficien\w*|prescrib\w*|dose|dosage|"
    r"supplement\w*|medication|medicine|drug|treat\w*|cure\w*|symptom\w*|doctor|physician|"
    r"blood pressure|cholesterol|diabet\w*|cancer|epa|dha|omega[- ]?3)\b",
    re.I,
)

# A dose is written with the number against the unit — "1000mg", "5000 IU" — and
# there is no word boundary between the digit and the letter, so a word list
# cannot see it. The first draft of this filter had `mg\b` in the list above and
# let "Take 1000mg of EPA daily" straight through. This is the shape that
# actually appears.
UNSAFE_DOSE = re.compile(
    r"\b\d+(?:[.,]\d+)?\s*(?:mg|mcg|ug|µg|g|iu|ml|grams?|milligrams?)\b", re.I
)

FALLBACK = "Your Personal tip appears once Sprout has a little of your own history to go on."
# Different reason, different sentence. A member with months of entries should
# not be told to come back when they have some.
FALLBACK_NO_TIP = "Sprout has not written you a note yet. One appears here when there is something useful to say."
FALLBACK_NOT_SHARED = "Share your results with Veye and Sprout can write you a personal note here."

GREETING = re.compile(r"^\s*(hi|hey|hello|good (morning|afternoon|evening))\b", re.I)


def looks_like_a_tip(text: str) -> bool:
    """Does this obey the rules the prompt actually set?

    A provider that ignores the instructions does not get to put its answer on
    the member's dashboard. The offline mock, for instance, returns the
    Companion's conversational refusal — a greeting, an unresolved
    personalisation token and a question — which is a perfectly good chat reply
    and a nonsense personal tip. Checking the shape here is what stops a
    half-connected model from looking like personalisation.
    """
    if not text:
        return False
    if "{{" in text or "}}" in text:          # an unresolved personalisation token
        return False
    if "?" in text:                            # the prompt forbids questions
        return False
    if GREETING.match(text):                   # and greetings
        return False
    if len(text.split()) > 45:                 # "one sentence, at most 35 words"
        return False
    return True


@dataclass(frozen=True)
class PersonalTip:
    text: str
    generated: bool          # False when this is the fallback
    generated_at: datetime | None
    context_version: str
    source: str              # "companion" | "fallback"


def fingerprint(context: MemberContext) -> str:
    """What the tip was written from.

    A hash rather than the context itself: it only has to answer "has anything
    the tip depends on changed?", and storing the summary again would be one
    more copy of the member's data for no benefit."""
    payload = json.dumps(context.model_dump(mode="json"), sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(f"{TIP_VERSION}|{payload}".encode("utf-8")).hexdigest()


def is_safe(text: str) -> bool:
    return bool(text) and not UNSAFE_WORDS.search(text) and not UNSAFE_DOSE.search(text)


class PersonalTipService:
    def __init__(self, db: Session, llm) -> None:
        self.db = db
        self.llm = llm

    def get(self, principal: CurrentPrincipal, *, force: bool = False) -> PersonalTip:
        """The member's current tip, generating one only when it is missing,
        stale, or written from data that has since moved."""
        member_id = principal.member_id
        if member_id is None:
            return self._fallback()
        # A tip is built from the member's own records, so it needs the same
        # permission everything else does.
        if not HealthPermissionService(self.db).shares_health_data(member_id):
            return self._fallback(FALLBACK_NOT_SHARED)

        context = self._context(principal)
        if not self._has_material(context):
            return self._fallback()

        stamp = fingerprint(context)
        row = (self.db.query(MemberPersonalTip)
               .filter(MemberPersonalTip.member_id == member_id).one_or_none())
        if row is not None and not self._acceptable(row.text):
            # A tip stored before a rule existed must not keep being served
            # because the fingerprint happens to match. The rules are applied
            # on the way out as well as on the way in, so tightening them
            # takes effect for tips already in the database.
            log.info("cached personal tip no longer passes the current rules; regenerating")
            row.context_fingerprint = ""
        elif row is not None and not force and row.context_fingerprint == stamp and not self._stale(row):
            return PersonalTip(text=row.text, generated=True, generated_at=row.generated_at,
                               context_version=row.tip_version, source="companion")

        text = self._write(context, classify_for(principal))
        if text is None:
            # Keep the previous tip rather than replacing a good one with a
            # fallback because today's attempt did not work — but only if it
            # still passes the current rules.
            if row is not None and self._acceptable(row.text):
                return PersonalTip(text=row.text, generated=True, generated_at=row.generated_at,
                                   context_version=row.tip_version, source="companion")
            # They have the history; the provider just did not produce anything
            # usable. Saying "come back when you have some history" would be
            # wrong and a little insulting.
            return self._fallback(FALLBACK_NO_TIP)

        now = datetime.now(timezone.utc)
        if row is None:
            row = MemberPersonalTip(member_id=member_id)
            self.db.add(row)
        row.text = text
        row.context_fingerprint = stamp
        row.tip_version = TIP_VERSION
        row.provider = getattr(self.llm, "name", "unknown")
        row.generated_at = now
        self.db.flush()
        return PersonalTip(text=text, generated=True, generated_at=now,
                           context_version=TIP_VERSION, source="companion")

    # ---- internals -----------------------------------------------------------
    def _context(self, principal: CurrentPrincipal) -> MemberContext:
        decision = PolicyDecision(outcome="allow", category=None, matched_rule="personal_tip",
                                  reason="dashboard personal tip", retrieval_scopes=(),
                                  member_data_scopes=TIP_SCOPES, policy_version=POLICY_VERSION)
        return MemberContextService(self.db).build(principal, TIP_SCOPES, decision)

    @staticmethod
    def _has_material(context: MemberContext) -> bool:
        """Something real to write about. A tip assembled from three "not
        available" lines would be invention."""
        from app.companion.context import UnavailableSummary

        return any(getattr(context, field) is not None and not isinstance(getattr(context, field), UnavailableSummary)
                   for field in ("health_number", "mood", "food_pattern"))

    @staticmethod
    def _acceptable(text: str) -> bool:
        """Both gates, applied wherever a tip is about to be shown."""
        return is_safe(text) and looks_like_a_tip(text)

    @staticmethod
    def _stale(row: MemberPersonalTip) -> bool:
        if row.tip_version != TIP_VERSION:
            return True
        generated = row.generated_at
        if generated is None:
            return True
        if generated.tzinfo is None:
            generated = generated.replace(tzinfo=timezone.utc)
        return datetime.now(timezone.utc) - generated > MAX_AGE

    def _write(self, context: MemberContext, classification: DataClassification) -> str | None:
        lines = "\n".join(context.lines())
        request = LLMRequest(
            system=SYSTEM,
            # The member's summaries travel in the user message, under no
            # heading. Nothing in this prompt's text says whose data it is,
            # which is exactly why the classification is carried separately.
            messages=(LLMMessage(role="user", content=f"Summary of this member:\n{lines}"),),
            max_tokens=120, temperature=0.4,
            metadata={"topic": "personal_tip", "tip_version": TIP_VERSION},
            classification=classification,
        )
        try:
            response = self.llm.complete(request)
        except Exception as exc:  # a tip is never worth a 500 on the dashboard
            # Type AND message. Swallowing everything is right for the member —
            # a dashboard must not fail over a nicety — but a log that records
            # only "TypeError" turns a one-line mistake into an afternoon.
            log.warning("personal tip not generated: %s: %s", type(exc).__name__, str(exc)[:200])
            return None
        text = " ".join((response.text or "").split()).strip().strip('"')
        if not text or "NOTHING_TO_SAY" in text.upper():
            return None
        if len(text) > MAX_CHARS:
            text = text[:MAX_CHARS].rsplit(" ", 1)[0].rstrip(",;:") + "…"
        if not is_safe(text):
            log.warning("personal tip dropped by the safety filter")
            return None
        if not looks_like_a_tip(text):
            log.info("personal tip dropped: the provider did not answer in the shape a tip has to take")
            return None
        return text

    @staticmethod
    def _fallback(text: str = FALLBACK) -> PersonalTip:
        return PersonalTip(text=text, generated=False, generated_at=None,
                           context_version=TIP_VERSION, source="fallback")
