"""CompanionService: the Sprout request pipeline.

Member request -> Auth (principal) -> Policy Gate -> Retrieval Orchestrator
-> Approved Knowledge Retrieval -> Structured Member Context Service
-> Minimum-Necessary / PII-PHI Filter -> Prompt Builder -> LLMProvider
-> Output Safety -> personalization inside the trust boundary
-> Member Response -> Feedback / Logging (masked telemetry).

The model never touches the database; it receives only the LLMRequest this
service assembles."""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy.orm import Session

from app.auth.models import UserAccount
from app.auth.principal import ROLE_ADMIN, CurrentPrincipal
from app.companion.context import MemberContextService
from app.companion.models import (
    CompanionConversation,
    CompanionFeedback,
    CompanionMessage,
    CompanionMessageSource,
    CompanionPolicyDecision,
    CompanionSettings,
)
from app.companion.personalization import MEMBER_FIRST_NAME_TOKEN, substitute
from app.companion.policy import OUTCOME_ALLOW, OUTCOME_ESCALATE, OUTCOME_OFF_TOPIC, OUTCOME_PROHIBIT, PolicyDecision, PolicyEngine
from app.companion.privacy import OutboundPrivacyFilter, PrivacyViolation, known_identifiers_for
from app.companion.prompt import PromptBuilder
from app.companion.providers.llm import LLMProvider, ProviderNotConfigured
from app.companion.safety import OutputSafety
from app.companion.settings import get_or_create_settings
from app.core.runtime import Runtime
from app.knowledge.service import KnowledgeService, RetrievedChunk
from app.notifications import templates
from app.notifications.service import NotificationService
from app.observability.telemetry import CompanionTrace

OUTCOME_ANSWERED = "answered"
OUTCOME_PROHIBITED = "prohibited"
OUTCOME_ESCALATED = "escalated"
OUTCOME_UNAVAILABLE = "unavailable"


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


class CompanionService:
    def __init__(self, db: Session, runtime: Runtime, notifications: NotificationService) -> None:
        self.db = db
        self.runtime = runtime
        self.notifications = notifications
        self.settings: CompanionSettings = get_or_create_settings(db)
        self.knowledge = KnowledgeService(db, runtime.object_store, runtime.embeddings)
        self.context_service = MemberContextService(db)
        self.llm: LLMProvider = runtime.llm

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
        if not self.settings.enabled:
            raise CompanionError(503, "Sprout is switched off at the moment.")

        conversation = (self.conversation_for_member(principal, conversation_id) if conversation_id
                        else self.open_conversation(principal))
        now = datetime.now(timezone.utc)
        member_message = CompanionMessage(conversation_id=conversation.id, role="member", content=text, created_at=now)
        self.db.add(member_message)
        conversation.message_count += 1
        conversation.last_message_at = now
        self.db.flush()

        # 1. Policy gate (deterministic, audited).
        decision = PolicyEngine(self.settings.policy).evaluate(text)
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

        if decision.outcome == OUTCOME_ESCALATE:
            reply_text, outcome = self.settings.escalation_response, OUTCOME_ESCALATED
            conversation.flagged = True
            conversation.flag_reason = f"Handed to a person: {decision.reason} (rule '{decision.matched_rule}')."
            self._notify_admins(conversation, decision)
        elif decision.outcome == OUTCOME_PROHIBIT:
            reply_text, outcome = self.settings.safe_response, OUTCOME_PROHIBITED
        elif decision.outcome == OUTCOME_OFF_TOPIC:
            reply_text, outcome = self.settings.fallback, OUTCOME_OFF_TOPIC
        else:
            reply_text, outcome, passages, extra = self._generate(principal, conversation, member_message, decision, text, known, trace)
            trace.retrieved_sources = [p.provenance() for p in passages]
            reply = self._store_reply(conversation, member_message, decision_row, reply_text, outcome, passages, extra, trace)
            self.runtime.telemetry.record(trace, known, session=self.db)
            return reply

        reply = self._store_reply(conversation, member_message, decision_row, reply_text, outcome, [], {}, trace)
        self.runtime.telemetry.record(trace, known, session=self.db)
        return reply

    def _generate(self, principal: CurrentPrincipal, conversation: CompanionConversation, member_message: CompanionMessage,
                  decision: PolicyDecision, text: str, known, trace: CompanionTrace) -> tuple[str, str, list[RetrievedChunk], dict]:
        # 2. Retrieval orchestrator -> approved knowledge only, within the policy's scopes.
        passages = self.knowledge.search(text, scopes=list(decision.retrieval_scopes), limit=self.runtime.settings.retrieval_limit)
        # 3. Structured member context: allowlisted summaries for the permitted scopes.
        context = self.context_service.build(principal, decision.member_data_scopes, decision)
        # 4. Prompt.
        earlier = (self.db.query(CompanionMessage)
                   .filter(CompanionMessage.conversation_id == conversation.id, CompanionMessage.id != member_message.id)
                   .order_by(CompanionMessage.created_at).all())
        history = [(m.role, m.content) for m in earlier if m.role in ("member", "sprout")]
        request = PromptBuilder(companion_name=self.settings.name).build(
            decision=decision, passages=passages, context=context, history=history, message=text,
        )
        # 5. Minimum-necessary / PII-PHI filter on everything that would leave the boundary.
        try:
            request, privacy_report = OutboundPrivacyFilter(known).filter_request(request)
        except PrivacyViolation as exc:
            trace.error_category = "privacy_violation"
            trace.safety_result = "not_generated"
            return self.settings.fallback, OUTCOME_UNAVAILABLE, passages, {"context_scopes": list(context.scopes), "error": str(exc)}
        # 6. LLMProvider.
        started = time.perf_counter()
        try:
            response = self.llm.complete(request)
        except ProviderNotConfigured as exc:
            trace.error_category = "provider_not_configured"
            trace.provider, trace.model = self.llm.name, getattr(self.llm, "model", None)
            return ("Sprout is not connected to a language model in this environment yet, so I would rather not guess. "
                    "Your saved results are in My Progress."), OUTCOME_UNAVAILABLE, passages, {"context_scopes": list(context.scopes), "error": str(exc)}
        except Exception as exc:  # provider/network failure: honest, never fabricated
            trace.error_category = "provider_error"
            trace.provider, trace.model = self.llm.name, getattr(self.llm, "model", None)
            trace.latency_ms = int((time.perf_counter() - started) * 1000)
            return ("Sprout could not reach its language model just now. Please try again in a moment."), OUTCOME_UNAVAILABLE, passages, {
                "context_scopes": list(context.scopes), "error": f"{type(exc).__name__}"}
        # 7. Output safety.
        safety = OutputSafety(safe_response=self.settings.safe_response, fallback=self.settings.fallback, known=known).check(response.text)
        # 8. Personalization inside the trust boundary: only the known token is replaced.
        personalized = substitute(safety.text, {MEMBER_FIRST_NAME_TOKEN: principal.first_name})
        trace.provider, trace.model = response.provider, response.model
        trace.latency_ms, trace.input_tokens, trace.output_tokens = response.latency_ms, response.input_tokens, response.output_tokens
        trace.safety_result = safety.result
        trace.prompt = request.as_payload()
        trace.response_text = response.text
        extra = {
            "context_scopes": list(context.scopes), "provider": response.provider, "model": response.model,
            "latency_ms": response.latency_ms, "input_tokens": response.input_tokens, "output_tokens": response.output_tokens,
            "safety_result": safety.result, "personalized": bool(personalized.substituted), "privacy_redactions": privacy_report.redactions,
        }
        return personalized.text, OUTCOME_ANSWERED, passages, extra

    def _store_reply(self, conversation: CompanionConversation, member_message: CompanionMessage, decision_row: CompanionPolicyDecision,
                     reply_text: str, outcome: str, passages: list[RetrievedChunk], extra: dict, trace: CompanionTrace) -> CompanionReply:
        now = datetime.now(timezone.utc)
        reply = CompanionMessage(
            conversation_id=conversation.id, role="sprout", content=reply_text, outcome=outcome, policy_decision_id=decision_row.id,
            provider=extra.get("provider"), model=extra.get("model"), latency_ms=extra.get("latency_ms"),
            input_tokens=extra.get("input_tokens"), output_tokens=extra.get("output_tokens"), safety_result=extra.get("safety_result"),
            context_scopes=extra.get("context_scopes", []), trace_id=trace.trace_id, created_at=now,
        )
        self.db.add(reply)
        self.db.flush()
        for rank, chunk in enumerate(passages, start=1):
            self.db.add(CompanionMessageSource(message_id=reply.id, rank=rank, source_id=UUID(chunk.source_id),
                                               document_id=UUID(chunk.document_id), chunk_id=UUID(chunk.chunk_id),
                                               source_title=chunk.source_title, source_version=chunk.source_version, score=chunk.score))
        conversation.message_count += 1
        conversation.last_message_at = now
        trace.message_id = str(reply.id)
        self.db.flush()
        return CompanionReply(
            conversation_id=conversation.id, member_message_id=member_message.id, reply_message_id=reply.id, reply=reply_text,
            outcome=outcome, policy_outcome=decision_row.outcome, policy_category=decision_row.category,
            sources=[c.provenance() for c in passages], context_scopes=extra.get("context_scopes", []),
            provider=extra.get("provider"), model=extra.get("model"), safety_result=extra.get("safety_result"),
            trace_id=trace.trace_id, personalized=bool(extra.get("personalized")),
        )

    def _notify_admins(self, conversation: CompanionConversation, decision: PolicyDecision) -> None:
        admins = self.db.query(UserAccount).filter(UserAccount.role == ROLE_ADMIN, UserAccount.is_active.is_(True)).all()
        link = f"{self.runtime.settings.web_base_url}/admin/companion/conversations?conversation={conversation.id}"
        for admin in admins:
            rendered = templates.companion_escalation(admin.first_name, decision.category or "sensitive", link)
            self.notifications.notify(admin, "companion_escalation", subject=rendered.subject, text=rendered.text, html=rendered.html,
                                      context={"conversation_id": str(conversation.id), "category": decision.category})

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
