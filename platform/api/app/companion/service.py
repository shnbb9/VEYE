"""CompanionService: the Sprout request pipeline.

Member request -> Auth (principal) -> Is this person all right? (fixed words,
no model; answered even when Sprout is off or the member is over the limit)
-> Policy Gate -> Retrieval Orchestrator
-> Approved Knowledge Retrieval -> Structured Member Context Service
-> Minimum-Necessary / PII-PHI Filter -> Prompt Builder -> LLMProvider
-> Output Safety -> personalization inside the trust boundary
-> Member Response -> Feedback / Logging (masked telemetry).

The model never touches the database; it receives only the LLMRequest this
service assembles."""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field, replace
from datetime import datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy.orm import Session

from app.auth.models import UserAccount
from app.auth.principal import CurrentPrincipal
from app.companion.context import MemberContext, MemberContextService
from app.companion.distress import CHECK_IN, DISTRESS, FEELINGS, MEDICAL, NONE, OTHER, RANK, SELF_HARM, UNSURE, Assessment, assess
from app.companion.models import (
    CompanionConversation,
    CompanionFeedback,
    CompanionMessage,
    CompanionMessageSource,
    CompanionPolicyDecision,
    CompanionSettings,
)
from app.companion.personalization import MEMBER_FIRST_NAME_TOKEN, substitute
from app.companion.policy import (
    CRISIS_CATEGORY,
    CRISIS_FLOOR,
    MEDICAL_CATEGORY,
    OUTCOME_ALLOW,
    OUTCOME_ESCALATE,
    OUTCOME_OFF_TOPIC,
    OUTCOME_PROHIBIT,
    OUTCOME_SUPPORT,
    PolicyDecision,
    PolicyEngine,
)
from app.companion.privacy import OutboundPrivacyFilter, PrivacyViolation, known_identifiers_for
from app.companion.prompt import PromptBuilder
from app.companion.providers.llm import LLMProvider, LLMResponse, ProviderFailed, ProviderNotConfigured, classify_for, leaves_veye
from app.companion.safety import OutputSafety
from app.companion.safety_copy import (
    ACKNOWLEDGE,
    DISTRESS_WORDS,
    MEDICAL_CARE,
    NOT_WATCHED,
    PROGRAM,
    SAFETY_COPY_VERSION,
    STEADIER,
    STILL_HERE,
    SUPPORT,
    UNSURE_LINE,
    UNSURE_QUESTION,
    distress_words,
    urgent_words,
)
from app.companion.settings import get_or_create_settings
from app.core.runtime import Runtime
from app.knowledge.models import KnowledgeSource
from app.knowledge.service import SEARCH_FAILED, KnowledgeService, RetrievedChunk
from app.notifications import templates
from app.notifications.service import DuplicateNotification, NotificationService
from app.observability.telemetry import CompanionTrace
from app.sprout_permission.service import SproutPermissionService

log = logging.getLogger("veye.companion")

OUTCOME_ANSWERED = "answered"
OUTCOME_PROHIBITED = "prohibited"
OUTCOME_ESCALATED = "escalated"
OUTCOME_UNAVAILABLE = "unavailable"
# Fixed words, and nobody was told: somebody finding it hard, or a question
# about safety that is not about anybody now.
OUTCOME_SAFETY = "safety"

# How long a worrying message colours the ones after it ("tonight", "yes").
RECENT = timedelta(hours=24)
# How long "yes" may answer a question with something Sprout could not take in
# said in between.
ANSWER_WITHIN = timedelta(minutes=30)
SAFETY_RULE = "safety:"
TOWARDS = "towards"             # somebody else may be hurt, and by them
REASONS = {
    "imminent": "possible immediate danger",
    "self_harm": "possible thoughts of suicide or self-harm",
    "check_in": "words that could mean they don't feel safe",
    "medical_emergency": "possible medical emergency",
    "unsure": "nothing worrying was said, and it may be meant: Sprout asked",
    "distress": "distress, with no sign of danger",
    "feelings": "an ordinary hard feeling",
}

# What happened to the member's health information for one reply.
HEALTH_USED = "used"              # summaries of it were in front of Sprout
HEALTH_OFF = "off"                # the topic would use it; the member's Sprout choice is off
HEALTH_RESTRICTED = "restricted"  # on, but this environment's model is outside Veye
HEALTH_NONE = "none"              # the topic does not use it

# Which setting is theirs to know: this is kept in a conversation the team can
# read. The note under the reply (health_context) tells the member.
TURNED_OFF_MEANWHILE = ("Your settings changed while I was answering, so I set that answer aside. Ask me again and I'll answer "
                        "with them as they are now.")
NOT_REACHED = "Sprout could not reach its language model just now. Please try again in a moment."
NOT_CONNECTED = ("Sprout is not connected to a language model in this environment yet, so I would rather not guess. "
                 "Your saved results are in My Progress.")
# The same worry is emailed again if nobody has read it by then.
ALERT_AGAIN = timedelta(hours=12)
SOMEBODY_ELSE = "possible danger to somebody else"


def passing(exc: Exception) -> bool:
    """Would it be any different in a moment? Not when it is not set up, not
    cleared or not indexed."""
    return isinstance(exc, ProviderFailed) and not isinstance(exc, ProviderNotConfigured)


def _aware(moment: datetime) -> datetime:
    """SQLite gives a moment back without saying it is UTC."""
    return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)


def _kind(decision: PolicyDecision) -> str:
    """Whose, and of what kind: each is worth telling somebody about once."""
    rule = decision.matched_rule or ""
    if not rule.startswith(SAFETY_RULE):
        return "self" if rule in CRISIS_FLOOR else "listed"
    body = decision.category == MEDICAL_CATEGORY
    if rule.endswith(f":{OTHER}"):
        return "their body" if body else "other"
    if rule.endswith(f":{TOWARDS}"):
        return TOWARDS
    return "body" if body else "self"


def _emailed(alerted: dict | None, kind: str, now: datetime) -> int:
    """How grave the last email of this kind was, while it still stands."""
    rank, at = ((alerted or {}).get("sent") or {}).get(kind) or (-1, None)
    return rank if at and now - datetime.fromisoformat(at) < ALERT_AGAIN else -1


def _said(decision) -> str:
    """What an earlier message was read as, if it was handed over, and about
    themselves."""
    rule = decision.matched_rule or ""
    if decision.outcome != OUTCOME_ESCALATE or decision.category not in (CRISIS_CATEGORY, MEDICAL_CATEGORY) or rule.endswith(f":{OTHER}"):
        return NONE
    return _level_of(rule)


def _asked(decision) -> bool:
    """Was it answered by asking: a guess, a question about the subject, or
    something long over? Then nobody was told, and "yes" means something."""
    rule = decision.matched_rule or ""
    return (decision.outcome == OUTCOME_SUPPORT and rule.startswith(SAFETY_RULE) and not rule.endswith(f":{OTHER}")
            and _level_of(rule) in (UNSURE, CHECK_IN, SELF_HARM))


def _level_of(rule: str | None) -> str:
    """How worried a recorded decision was. One from the approved list is
    distress unless the floor made it."""
    if rule and rule.startswith(SAFETY_RULE):
        return rule.split(":")[1]
    return SELF_HARM if rule in CRISIS_FLOOR else DISTRESS


class CompanionError(Exception):
    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


@dataclass(frozen=True)
class CompanionReply:
    conversation_id: UUID
    member_message_id: UUID
    reply_message_id: UUID
    reply: str
    outcome: str
    policy_outcome: str
    policy_category: str | None
    sources: list[dict] = field(default_factory=list)
    context_scopes: list[str] = field(default_factory=list)
    provider: str | None = None
    model: str | None = None
    safety_result: str | None = None
    trace_id: str | None = None
    personalized: bool = False
    health_context: str = HEALTH_NONE
    # How worried the fixed rules were, when they were worried at all.
    safety_level: str | None = None
    # Emails to send once this is committed; nobody waits for a mail server.
    outbox_ids: list[UUID] = field(default_factory=list)


class CompanionService:
    def __init__(self, db: Session, runtime: Runtime, notifications: NotificationService) -> None:
        self.db = db
        self.runtime = runtime
        self.notifications = notifications
        self.settings: CompanionSettings = get_or_create_settings(db)
        self.knowledge = KnowledgeService(db, runtime.object_store, runtime.embeddings)
        self.llm: LLMProvider = runtime.llm
        self.context_service = MemberContextService(db, outside=leaves_veye(self.llm))

    # ---- conversations ---------------------------------------------------------------------
    def open_conversation(self, principal: CurrentPrincipal) -> CompanionConversation:
        conversation = (
            self.db.query(CompanionConversation)
            .filter(CompanionConversation.member_id == principal.member_id, CompanionConversation.status == "open")
            .order_by(CompanionConversation.last_message_at.desc())
            .first()
        )
        if conversation is None:
            conversation = CompanionConversation(member_id=principal.member_id)
            self.db.add(conversation)
            self.db.flush()
        return conversation

    def conversation_for_member(self, principal: CurrentPrincipal, conversation_id: UUID) -> CompanionConversation:
        conversation = self.db.get(CompanionConversation, conversation_id)
        if conversation is None or conversation.member_id != principal.member_id:
            raise CompanionError(404, "Conversation not found.")
        return conversation

    def clear_conversation(self, principal: CurrentPrincipal) -> CompanionConversation:
        current = self.open_conversation(principal)
        if current.message_count:
            current.status = "cleared"
            self.db.flush()
            current = self.open_conversation(principal)
        return current

    def has_previous_conversations(self, principal: CurrentPrincipal) -> bool:
        return (self.db.query(CompanionConversation)
                .filter(CompanionConversation.member_id == principal.member_id, CompanionConversation.message_count > 0)
                .count() > 0)

    # ---- the pipeline ----------------------------------------------------------------------------
    def ask(self, principal: CurrentPrincipal, message: str, *, conversation_id: UUID | None = None) -> CompanionReply:
        if not principal.is_member:
            raise CompanionError(403, "Sprout is available to Veye members.")
        text = " ".join((message or "").split())
        if not text:
            raise CompanionError(422, "Type a message for Sprout.")
        if len(text) > 500:
            raise CompanionError(422, "Keep messages under 500 characters.")
        # 1. Is this person all right? Before anything that can be switched off.
        assessment = self.assess(principal, text)
        if not self.settings.enabled and not assessment.urgent:
            raise CompanionError(503, "Sprout is switched off at the moment.")

        try:
            conversation = (self.conversation_for_member(principal, conversation_id) if conversation_id
                            else self.open_conversation(principal))
        except CompanionError:
            if not assessment.urgent:
                raise
            # Another account's conversation was open in this tab. What was
            # said is this member's all the same, and is not lost over it.
            conversation = self.open_conversation(principal)
        now = datetime.now(timezone.utc)
        member_message = CompanionMessage(conversation_id=conversation.id, role="member", content=text, created_at=now)
        self.db.add(member_message)
        # The conversation itself is changed at the end: until then nothing
        # else said in it waits for the model this message may have to ask.
        self.db.flush()

        # 2. Policy gate (deterministic, audited).
        decision = self._decide(assessment)
        decision_row = CompanionPolicyDecision(
            conversation_id=conversation.id, member_id=principal.member_id, outcome=decision.outcome,
            category=decision.category, matched_rule=decision.matched_rule, retrieval_scopes=list(decision.retrieval_scopes),
            member_data_scopes=list(decision.member_data_scopes), reason=decision.reason, policy_version=decision.policy_version,
        )
        self.db.add(decision_row)
        self.db.flush()
        member_message.policy_decision_id = decision_row.id

        known = known_identifiers_for(principal)
        trace = CompanionTrace(member_id=str(principal.member_id), conversation_id=str(conversation.id), message_id=None,
                               policy_outcome=decision.outcome, policy_category=decision.category, safety_result="not_generated")

        passages: list[RetrievedChunk] = []
        extra: dict = {}
        outbox_ids: list[UUID] = []
        kind = ACKNOWLEDGE.get(assessment.feeling or "", "") if assessment.level == FEELINGS else ""
        fixed = assessment.urgent or decision.outcome in (OUTCOME_ESCALATE, OUTCOME_SUPPORT)
        if decision.outcome == OUTCOME_ESCALATE:
            outcome = OUTCOME_ESCALATED
            reply_text = self._handed_over_words(assessment, decision, kind)
            if self._mark(conversation, decision):
                outbox_ids = self._notify_admins(conversation, decision, decision_row.id)
        elif decision.outcome == OUTCOME_SUPPORT:
            outcome = OUTCOME_SAFETY if assessment.urgent else OUTCOME_SUPPORT
            reply_text = self._support_words(assessment, kind, decision)
        elif decision.outcome == OUTCOME_PROHIBIT:
            reply_text, outcome = " ".join(filter(None, (kind, self.settings.safe_response))), OUTCOME_PROHIBITED
        elif decision.outcome == OUTCOME_OFF_TOPIC:
            outcome = OUTCOME_OFF_TOPIC
            reply_text = STILL_HERE if RANK[self._before(principal.member_id)[0]] >= RANK[CHECK_IN] else self.settings.fallback
        else:
            reply_text, outcome, passages, extra = self._generate(principal, conversation, member_message, decision, text, known, trace)
            trace.retrieved_sources = [p.provenance() for p in passages]
            if kind:
                # They said how they feel, so that comes first; and if the model
                # could not answer, there is still something kind to say.
                reply_text = f"{kind} {reply_text}" if outcome == OUTCOME_ANSWERED else f"{kind} {SUPPORT} {reply_text}"
        if assessment.unsure and decision.outcome != OUTCOME_ESCALATE and decision.matched_rule != SAFETY_RULE + UNSURE:
            reply_text = f"{reply_text} {UNSURE_LINE}"
        if fixed:
            extra = {"safety_result": SAFETY_COPY_VERSION}
            trace.safety_result = SAFETY_COPY_VERSION

        reply = self._store_reply(conversation, member_message, decision_row, reply_text, outcome, passages, extra, trace)
        self.runtime.telemetry.record(trace, known, session=self.db)
        level = UNSURE if assessment.unsure and RANK[assessment.level] < RANK[UNSURE] else assessment.level
        return replace(reply, safety_level=level if level != NONE else None, outbox_ids=outbox_ids)

    # ---- is this person all right? -------------------------------------------------------------
    def assess(self, principal: CurrentPrincipal, text: str, *, since: datetime | None = None) -> Assessment:
        """`since`: something else has been asked of them since then (the step a
        guide is at), so a bare "yes" answers that."""
        recent, answering, asked_at = self._before(principal.member_id)
        if since is not None and asked_at is not None and _aware(since) > asked_at:
            answering = False
        return assess(text, recent=recent, answering=answering)

    def asks_a_model(self, assessment: Assessment) -> bool:
        """Would the answer be written by one, rather than be fixed words?"""
        return self._decide(assessment).outcome == OUTCOME_ALLOW

    def hands_over(self, assessment: Assessment) -> bool:
        """Would this be handed to a person, by the rules or the approved list?"""
        return self._decide(assessment).outcome == OUTCOME_ESCALATE

    def words_for(self, assessment: Assessment) -> str:
        """What an urgent message is answered with when it cannot be stored."""
        return urgent_words(assessment, marked=False)

    def _before(self, member_id: UUID | None) -> tuple[str, bool, datetime | None]:
        """The most worrying thing this member said about themselves in the
        last day (theirs across conversations, so clearing one changes nothing);
        whether it was the message just before this one, which is when a bare
        "yes", "no" or "tonight" is an answer to it (said to anything later it
        is an answer to that instead); and when that was."""
        if member_id is None:
            return NONE, False, None
        now = datetime.now(timezone.utc)
        decisions = (self.db.query(CompanionPolicyDecision.matched_rule, CompanionPolicyDecision.outcome,
                                   CompanionPolicyDecision.category, CompanionPolicyDecision.created_at)
                     .filter(CompanionPolicyDecision.member_id == member_id, CompanionPolicyDecision.created_at >= now - RECENT)
                     .order_by(CompanionPolicyDecision.created_at.desc()).limit(500).all())
        if not decisions:
            return NONE, False, None
        # "I don't know", which Sprout could only answer with "I'm still here",
        # has not answered the question before it.
        just = next((d for d in decisions[:3] if d.outcome != OUTCOME_OFF_TOPIC), decisions[0])
        if now - _aware(just.created_at) > ANSWER_WITHIN:
            just = decisions[0]
        asked = _asked(just)
        said = [(_said(decision), decision.category) for decision in decisions]
        # What they mean comes first; a body is only in question straight after.
        worst = max((level for level, category in said if category == CRISIS_CATEGORY), key=lambda level: RANK[level], default=NONE)
        if RANK[worst] < RANK[UNSURE]:
            worst = UNSURE if asked else MEDICAL if _said(just) == MEDICAL else worst
        return worst, asked or RANK[_said(just)] >= RANK[CHECK_IN], _aware(just.created_at)

    def _decide(self, assessment: Assessment) -> PolicyDecision:
        """The approved policy, over the words that are not plainly something
        else. How worried we are comes first; the policy can still hand over
        what it lists."""
        engine = PolicyEngine(self.settings.policy)
        ordinary = engine.evaluate(assessment.residual)
        rule = SAFETY_RULE + assessment.level + (f":{TOWARDS}" if assessment.harming else f":{OTHER}" if assessment.about == OTHER else "")
        if assessment.urgent:
            medical = assessment.level == MEDICAL
            told = assessment.hand_over or (medical and ordinary.outcome == OUTCOME_ESCALATE)
            return PolicyDecision(OUTCOME_ESCALATE if told else OUTCOME_SUPPORT, MEDICAL_CATEGORY if medical else CRISIS_CATEGORY,
                                  rule, SOMEBODY_ELSE if assessment.harming else REASONS[assessment.level], policy_version=engine.version)
        if ordinary.outcome == OUTCOME_ESCALATE:
            return ordinary
        if assessment.unsure and assessment.level != DISTRESS and ordinary.outcome == OUTCOME_OFF_TOPIC:
            return PolicyDecision(OUTCOME_SUPPORT, CRISIS_CATEGORY, SAFETY_RULE + UNSURE, REASONS[UNSURE], policy_version=engine.version)
        if assessment.level == DISTRESS or assessment.steadier or (assessment.level == FEELINGS and ordinary.outcome == OUTCOME_OFF_TOPIC):
            return PolicyDecision(OUTCOME_SUPPORT, CRISIS_CATEGORY, rule, REASONS.get(assessment.level, "they said they are all right"),
                                  policy_version=engine.version)
        return ordinary

    def _handed_over_words(self, assessment: Assessment, decision: PolicyDecision, kind: str) -> str:
        if assessment.urgent:
            return urgent_words(assessment, marked=True)
        if decision.category == CRISIS_CATEGORY:
            if decision.matched_rule in CRISIS_FLOOR:  # the floor caught what the rules above it did not
                return urgent_words(Assessment(SELF_HARM), marked=True)
            return f"{DISTRESS_WORDS} {self.settings.escalation_response} {NOT_WATCHED}"
        if decision.category == MEDICAL_CATEGORY:
            return " ".join(filter(None, (kind, self.settings.escalation_response, MEDICAL_CARE, NOT_WATCHED)))
        return " ".join(filter(None, (kind, self.settings.escalation_response)))

    @staticmethod
    def _support_words(assessment: Assessment, kind: str, decision: PolicyDecision) -> str:
        if assessment.urgent:
            return urgent_words(assessment, marked=False)
        if decision.matched_rule == SAFETY_RULE + UNSURE:
            return " ".join(filter(None, (kind, UNSURE_QUESTION, PROGRAM)))
        if assessment.steadier:
            return STEADIER
        if assessment.level == DISTRESS:
            return distress_words(assessment)
        return f"{kind} {SUPPORT}".strip()

    def _mark(self, conversation: CompanionConversation, decision: PolicyDecision) -> bool:
        """Mark it for a person, and say whether the team needs telling: not
        for every message somebody in distress sends while the first is still
        waiting to be read; but when it was read, when it got worse, when it is
        another kind of worry, and when nobody has read it for half a day."""
        # As it is now: an administrator may be marking it read this moment.
        # (Not the stronger lock: a message being written to the conversation
        # already keeps its key, and that one may be waiting for a model.)
        conversation = (self.db.query(CompanionConversation).filter(CompanionConversation.id == conversation.id)
                        .populate_existing().with_for_update(key_share=True).one())
        now = datetime.now(timezone.utc)
        kind, rank = _kind(decision), RANK[_level_of(decision.matched_rule)]
        waiting = conversation.flagged and conversation.reviewed_at is None
        told = dict(conversation.alerted or {}) if waiting else {}
        # Clearing the chat starts another conversation. It is the same person,
        # and the team has the first one in front of them, until it is read or
        # the time is up: what it was emailed stands where it was sent, so the
        # clock never starts again without an email.
        elsewhere = [alerted for (alerted,) in self.db.query(CompanionConversation.alerted).filter(
            CompanionConversation.member_id == conversation.member_id, CompanionConversation.id != conversation.id,
            CompanionConversation.flagged.is_(True), CompanionConversation.reviewed_at.is_(None))]
        known = max(_emailed(record, kind, now) for record in (told, *elsewhere))
        worst = told.get("worst", -1)
        rule = decision.matched_rule or ""
        if rank >= worst:
            conversation.flag_reason = (f"Handed to a person: {decision.reason}." if rule.startswith(SAFETY_RULE)
                                        else f"Handed to a person: {decision.reason} (rule '{rule}').")
        conversation.flagged = True
        # Handed over again, so it is waiting again, whatever was done about
        # the time before.
        conversation.reviewed_at = conversation.reviewed_by = None
        conversation.resolved_at = conversation.resolved_by = None
        sent = dict(told.get("sent") or {})
        if rank > known:
            sent[kind] = [rank, now.isoformat()]
        conversation.alerted = {"worst": max(rank, worst), "sent": sent}
        self.db.flush()
        return rank > known

    def _generate(self, principal: CurrentPrincipal, conversation: CompanionConversation, member_message: CompanionMessage,
                  decision: PolicyDecision, text: str, known, trace: CompanionTrace) -> tuple[str, str, list[RetrievedChunk], dict]:
        # 3. Retrieval orchestrator -> approved knowledge only, within the policy's scopes.
        #    The query is the member's own words and the outbound privacy
        #    filter has not run yet (it runs at step 6, on the built request),
        #    so whose words these are travels with them. With the local
        #    embedding provider nothing leaves the machine; with an external
        #    one this is what decides whether the call is made at all.
        try:
            passages = self.knowledge.search(text, scopes=list(decision.retrieval_scopes),
                                             limit=self.runtime.settings.retrieval_limit,
                                             classification=classify_for(principal), before_leaving=self.db.commit)
        except SEARCH_FAILED as exc:
            # Not answered without it. An answer from no approved passage reads
            # like an answer from all of them.
            log.warning("no answer: approved knowledge could not be searched (%s): %s", exc.category, exc)
            trace.error_category = exc.category
            return NOT_REACHED if passing(exc) else NOT_CONNECTED, OUTCOME_UNAVAILABLE, [], {"error": exc.category}
        # 4. Structured member context: allowlisted summaries for the permitted scopes.
        context = self.context_service.build(principal, decision.member_data_scopes, decision)
        # 5. Prompt.
        builder = PromptBuilder(companion_name=self.settings.name)
        history, recalled, quoted = self._history(principal, conversation, member_message, builder.max_history)
        personal = bool(context.scopes) or recalled
        health = self._health_context(principal, decision, context)
        request = builder.build(
            decision=decision, passages=passages, context=context, history=history, message=text,
            # Whose conversation this is, from the session rather than from
            # anything the browser sent. A member's own message can carry health
            # information no context block mentions.
            classification=classify_for(principal), quoted=quoted,
        )
        # 6. Minimum-necessary / PII-PHI filter on everything that would leave the boundary.
        try:
            request, privacy_report = OutboundPrivacyFilter(known).filter_request(request)
        except PrivacyViolation as exc:
            trace.error_category = "privacy_violation"
            trace.safety_result = "not_generated"
            return self.settings.fallback, OUTCOME_UNAVAILABLE, passages, {"health_context": health, "error": str(exc)}
        # 7. LLMProvider. What was said is saved first, so that a model that
        # takes its time holds no database connection: the next message, and
        # an urgent one most of all, must not wait for one.
        self.db.commit()
        started = time.perf_counter()
        try:
            response = self.llm.complete(request)
        except ProviderNotConfigured as exc:
            log.warning("no answer: %s (%s)", exc, exc.category)
            trace.error_category = exc.category
            trace.provider, trace.model = self.llm.name, getattr(self.llm, "model", None)
            return NOT_CONNECTED, OUTCOME_UNAVAILABLE, passages, {"health_context": health, "error": str(exc)}
        except Exception as exc:  # provider/network failure: honest, never fabricated
            trace.error_category = getattr(exc, "category", "provider_error")
            trace.provider, trace.model = self.llm.name, getattr(self.llm, "model", None)
            trace.latency_ms = int((time.perf_counter() - started) * 1000)
            if getattr(exc, "spent", None) is not None:     # no answer, and paid for
                self._used(trace, exc.spent)
            log.warning("no answer: %s from the language model (%s)", type(exc).__name__, trace.error_category)
            return NOT_REACHED, OUTCOME_UNAVAILABLE, passages, {"health_context": health, "error": f"{type(exc).__name__}"}
        # The member may have switched personalization off while the model was
        # writing. Asked again, and held until this reply is saved: once they
        # have been told it is off, nothing written from their information
        # can still arrive.
        if personal and not self.context_service.may_use(principal, hold=True):
            trace.provider, trace.model = response.provider, response.model
            trace.error_category = "settings_changed"
            trace.safety_result = "not_shown"
            return TURNED_OFF_MEANWHILE, OUTCOME_UNAVAILABLE, passages, {"health_context": HEALTH_OFF}
        # 8. Output safety.
        safety = OutputSafety(safe_response=self.settings.safe_response, fallback=self.settings.fallback, known=known).check(response.text)
        # 9. Personalization inside the trust boundary: only the known token is replaced.
        personalized = substitute(safety.text, {MEMBER_FIRST_NAME_TOKEN: principal.first_name})
        trace.provider, trace.model = response.provider, response.model
        self._used(trace, response)
        trace.safety_result = safety.result
        trace.prompt = request.as_payload()
        trace.response_text = response.text
        extra = {
            "context_scopes": list(context.scopes), "personal": personal, "health_context": health,
            "provider": response.provider, "model": response.model,
            "latency_ms": response.latency_ms, "input_tokens": response.input_tokens, "output_tokens": response.output_tokens,
            "safety_result": safety.result, "personalized": bool(personalized.substituted), "privacy_redactions": privacy_report.redactions,
        }
        return personalized.text, OUTCOME_ANSWERED, passages, extra

    def _history(self, principal: CurrentPrincipal, conversation: CompanionConversation, member_message: CompanionMessage,
                 limit: int) -> tuple[list[tuple[str, str]], bool, bool]:
        """The turns before this one, whether any of them was written from the
        member's health information, and whether any was written from a
        document of the client's. With their Sprout choice off the first are
        left out: an answer Sprout gave yesterday is still their information in
        front of it today. What somebody said when they were not all right is
        never put in a prompt."""
        earlier = (self.db.query(CompanionMessage)
                   .filter(CompanionMessage.conversation_id == conversation.id, CompanionMessage.id != member_message.id,
                           CompanionMessage.role.in_(("member", "sprout")))
                   .order_by(CompanionMessage.created_at).all())
        if any(m.from_records for m in earlier) and not self.context_service.may_use(principal):
            earlier = [m for m in earlier if not m.from_records]
        earlier = [m for m in earlier if m.policy_decision is None or m.policy_decision.outcome not in (OUTCOME_ESCALATE, OUTCOME_SUPPORT)]
        kept = earlier[-limit:]
        return [(m.role, m.content) for m in kept], any(m.from_records for m in kept), self._quotes_the_client(earlier)

    def _quotes_the_client(self, earlier: list[CompanionMessage]) -> bool:
        """A reply may repeat what it was written from, and the replies after
        it may repeat that: so the whole conversation is looked at, not only
        what still fits. Fixed words repeat nothing, whatever had been found.
        A source that is not known any more is taken to be the client's."""
        replies = [m.id for m in earlier if m.role == "sprout" and m.outcome == OUTCOME_ANSWERED]
        if not replies:
            return False
        sources = (self.db.query(CompanionMessageSource.source_id, KnowledgeSource.is_synthetic)
                   .outerjoin(KnowledgeSource, KnowledgeSource.id == CompanionMessageSource.source_id)
                   .filter(CompanionMessageSource.message_id.in_(replies)))
        return any(not synthetic for _, synthetic in sources)

    @staticmethod
    def _used(trace: CompanionTrace, response: LLMResponse) -> None:
        trace.latency_ms, trace.input_tokens, trace.output_tokens = response.latency_ms, response.input_tokens, response.output_tokens
        trace.backend, trace.thinking_tokens, trace.attempts = response.backend, response.thinking_tokens, response.attempts
        trace.estimated_cost_usd = response.estimated_cost_usd

    def _health_context(self, principal: CurrentPrincipal, decision: PolicyDecision, context: MemberContext) -> str:
        if context.scopes:
            return HEALTH_USED
        if not decision.member_data_scopes:
            return HEALTH_NONE
        on = SproutPermissionService(self.db).personalizes(principal.member_id)
        return HEALTH_RESTRICTED if on else HEALTH_OFF

    def _store_reply(self, conversation: CompanionConversation, member_message: CompanionMessage, decision_row: CompanionPolicyDecision,
                     reply_text: str, outcome: str, passages: list[RetrievedChunk], extra: dict, trace: CompanionTrace) -> CompanionReply:
        now = datetime.now(timezone.utc)
        reply = CompanionMessage(
            conversation_id=conversation.id, role="sprout", content=reply_text, outcome=outcome, policy_decision_id=decision_row.id,
            provider=extra.get("provider"), model=extra.get("model"), latency_ms=extra.get("latency_ms"),
            input_tokens=extra.get("input_tokens"), output_tokens=extra.get("output_tokens"), safety_result=extra.get("safety_result"),
            context_scopes=extra.get("context_scopes", []), personal=bool(extra.get("personal")), trace_id=trace.trace_id, created_at=now,
        )
        self.db.add(reply)
        self.db.flush()
        for rank, chunk in enumerate(passages, start=1):
            self.db.add(CompanionMessageSource(message_id=reply.id, rank=rank, source_id=UUID(chunk.source_id),
                                               document_id=UUID(chunk.document_id), chunk_id=UUID(chunk.chunk_id),
                                               source_title=chunk.source_title, source_version=chunk.source_version, score=chunk.score))
        # Both turns, counted where the row is, whoever else is writing to it.
        conversation.message_count = CompanionConversation.message_count + 2
        conversation.last_message_at = now
        trace.message_id = str(reply.id)
        self.db.flush()
        self.db.refresh(conversation, ["message_count"])
        return CompanionReply(
            conversation_id=conversation.id, member_message_id=member_message.id, reply_message_id=reply.id, reply=reply_text,
            outcome=outcome, policy_outcome=decision_row.outcome, policy_category=decision_row.category,
            sources=[c.provenance() for c in passages], context_scopes=extra.get("context_scopes", []),
            provider=extra.get("provider"), model=extra.get("model"), safety_result=extra.get("safety_result"),
            trace_id=trace.trace_id, personalized=bool(extra.get("personalized")),
            health_context=extra.get("health_context", HEALTH_NONE),
        )

    def _notify_admins(self, conversation: CompanionConversation, decision: PolicyDecision, decision_id: UUID) -> list[UUID]:
        """Everyone who can open the console now. Queued, not sent: the member
        is not kept waiting for a mail server, and a refused email is retried."""
        admins = self.db.query(UserAccount).filter(UserAccount.admin_access.is_(True), UserAccount.is_active.is_(True)).all()
        link = f"{self.runtime.settings.web_base_url}/admin/companion/conversations?conversation={conversation.id}"
        queued = []
        for admin in admins:
            rendered = templates.companion_escalation(admin.first_name, decision.category or "sensitive", link)
            try:
                outbox = self.notifications.queue(
                    "companion_escalation", to_email=admin.email, user=admin, subject=rendered.subject, text=rendered.text,
                    html=rendered.html, idempotency_key=f"escalation:{decision_id}:{admin.id}",
                    context={"conversation_id": str(conversation.id), "category": decision.category})
            except DuplicateNotification:
                continue
            queued.append(outbox.id)
        return queued

    # ---- feedback ---------------------------------------------------------------------------------
    def submit_feedback(self, principal: CurrentPrincipal, message_id: UUID, *, rating: str, reason: str | None, comment: str | None) -> CompanionFeedback:
        message = self.db.get(CompanionMessage, message_id)
        if message is None or message.role != "sprout":
            raise CompanionError(404, "Message not found.")
        conversation = self.db.get(CompanionConversation, message.conversation_id)
        if conversation is None or conversation.member_id != principal.member_id:
            raise CompanionError(404, "Message not found.")
        if rating not in ("helpful", "not_helpful"):
            raise CompanionError(422, "Rating must be helpful or not_helpful.")
        feedback = message.feedback
        if feedback is None:
            feedback = CompanionFeedback(message_id=message.id, conversation_id=conversation.id, member_id=principal.member_id, rating=rating)
            self.db.add(feedback)
        feedback.rating = rating
        feedback.reason = (reason or "").strip()[:48] or None
        feedback.comment = (comment or "").strip()[:1000] or None
        feedback.submitted_at = datetime.now(timezone.utc)
        self.db.flush()
        if message.trace_id:
            self.runtime.telemetry.record_feedback(message.trace_id, rating, session=self.db)
        return feedback
