from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.auth.dependencies import get_notification_service
from app.auth.principal import CurrentPrincipal, require_member
from app.companion.models import CompanionConversation, CompanionMessage
from app.companion.schemas import (
    AskRequest,
    AskResponse,
    CompanionSessionOut,
    ConversationOut,
    FeedbackOut,
    FeedbackRequest,
    MessageOut,
    QuickPromptOut,
    SourceOut,
)
from datetime import datetime

from pydantic import BaseModel

from app.core.idempotency import Idempotency, Replay
from app.core.rate_limit import RateLimiter, client_address
from app.companion.personal_tip import PersonalTipService
from app.companion.service import CompanionError, CompanionService
from app.core.runtime import Runtime, get_runtime
from app.db.session import get_db
from app.notifications.service import NotificationService

router = APIRouter(prefix="/api/v1/companion", tags=["companion"])


def get_companion_service(
    db: Session = Depends(get_db), runtime: Runtime = Depends(get_runtime),
    notifications: NotificationService = Depends(get_notification_service),
) -> CompanionService:
    return CompanionService(db, runtime, notifications)


def message_out(message: CompanionMessage) -> MessageOut:
    return MessageOut(
        id=message.id, role=message.role, content=message.content, outcome=message.outcome,
        sources=[SourceOut(source_id=str(s.source_id), document_id=str(s.document_id), chunk_id=str(s.chunk_id),
                           source_version=s.source_version, score=round(s.score, 4), title=s.source_title) for s in message.sources],
        feedback=FeedbackOut(rating=message.feedback.rating, reason=message.feedback.reason, comment=message.feedback.comment,
                             submitted_at=message.feedback.submitted_at) if message.feedback else None,
        created_at=message.created_at,
    )


def conversation_out(conversation: CompanionConversation) -> ConversationOut:
    return ConversationOut(id=conversation.id, started_at=conversation.started_at, message_count=conversation.message_count,
                           flagged=conversation.flagged, messages=[message_out(m) for m in conversation.messages])


def _raise(exc: CompanionError):
    raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.get("/session", response_model=CompanionSessionOut)
def session(principal: CurrentPrincipal = Depends(require_member), db: Session = Depends(get_db),
            service: CompanionService = Depends(get_companion_service)) -> CompanionSessionOut:
    conversation = service.open_conversation(principal)
    returning = conversation.message_count > 0 or service.has_previous_conversations(principal)
    settings = service.settings
    db.commit()
    db.refresh(conversation)
    return CompanionSessionOut(
        enabled=settings.enabled, name=settings.name,
        welcome=settings.returning_welcome if returning else settings.welcome,
        quick_prompts=[QuickPromptOut(id=p["id"], label=p["label"], prompt=p["prompt"]) for p in settings.quick_prompts if p.get("active", True)],
        conversation=conversation_out(conversation),
        provider=service.llm.name, model=getattr(service.llm, "model", None),
    )


@router.post("/messages", response_model=AskResponse, status_code=201)
def ask(payload: AskRequest, request: Request, principal: CurrentPrincipal = Depends(require_member),
        db: Session = Depends(get_db),
        service: CompanionService = Depends(get_companion_service)) -> AskResponse:
    # Enforced before the service is touched, so a refused message costs no
    # retrieval, no prompt assembly and no model call. Keyed on the member
    # rather than the conversation: a new conversation is not a new allowance.
    subject = str(principal.member_id or principal.user_id)
    RateLimiter(db).enforce("companion_message", subject=subject, address=client_address(request))

    idempotency = Idempotency(db)
    try:
        # Claimed before the model is reached, so a retried send pays once.
        idempotency.claim("companion_message", payload.idempotency_key, subject=subject)
    except Replay as replay:
        db.commit()
        return _answered_earlier(db, principal, replay.entity_id)
    db.commit()

    try:
        reply = service.ask(principal, payload.message, conversation_id=payload.conversation_id)
    except CompanionError as exc:
        db.rollback()
        _raise(exc)
    idempotency.complete("companion_message", payload.idempotency_key, str(reply.reply_message_id))
    db.commit()
    return AskResponse(
        conversation_id=reply.conversation_id, member_message_id=reply.member_message_id, reply_message_id=reply.reply_message_id,
        reply=reply.reply, outcome=reply.outcome, policy_outcome=reply.policy_outcome, policy_category=reply.policy_category,
        sources=[SourceOut(**s) for s in reply.sources], context_scopes=reply.context_scopes, provider=reply.provider,
        model=reply.model, safety_result=reply.safety_result, trace_id=reply.trace_id, personalized=reply.personalized,
    )


@router.post("/messages/{message_id}/feedback", response_model=FeedbackOut)
def feedback(message_id: UUID, payload: FeedbackRequest, principal: CurrentPrincipal = Depends(require_member),
             db: Session = Depends(get_db), service: CompanionService = Depends(get_companion_service)) -> FeedbackOut:
    try:
        row = service.submit_feedback(principal, message_id, rating=payload.rating, reason=payload.reason, comment=payload.comment)
    except CompanionError as exc:
        db.rollback()
        _raise(exc)
    db.commit()
    return FeedbackOut(rating=row.rating, reason=row.reason, comment=row.comment, submitted_at=row.submitted_at)


@router.post("/conversations/clear", response_model=ConversationOut)
def clear(principal: CurrentPrincipal = Depends(require_member), db: Session = Depends(get_db),
          service: CompanionService = Depends(get_companion_service)) -> ConversationOut:
    conversation = service.clear_conversation(principal)
    db.commit()
    db.refresh(conversation)
    return conversation_out(conversation)


class PersonalTipOut(BaseModel):
    """The dashboard's Personal tip. `generated` is false when this is the
    honest fallback rather than something Sprout wrote, so the screen can say
    which it is instead of passing a placeholder off as personalisation."""

    text: str
    generated: bool
    generated_at: datetime | None
    source: str
    tip_version: str


@router.get("/personal-tip", response_model=PersonalTipOut)
def personal_tip(principal: CurrentPrincipal = Depends(require_member), db: Session = Depends(get_db),
                 runtime: Runtime = Depends(get_runtime)) -> PersonalTipOut:
    """Cached per member and regenerated only when their own summaries move or
    the tip gets old — a dashboard refresh never costs a model call."""
    # A cached tip is free, so the limit is only spent when one would be
    # written: this guards the regeneration path, not the read.
    tip = PersonalTipService(db, runtime.llm, limiter=RateLimiter(db),
                             subject=str(principal.member_id or principal.user_id)).get(principal)
    db.commit()
    return PersonalTipOut(text=tip.text, generated=tip.generated, generated_at=tip.generated_at,
                          source=tip.source, tip_version=tip.context_version)


def _answered_earlier(db: Session, principal: CurrentPrincipal, reply_message_id: str) -> AskResponse:
    """The answer the first attempt produced, read back rather than stored.

    Only the message id is kept against the idempotency key, so a member's
    words are not copied into a second table; the reply is re-read from the
    conversation it belongs to, scoped to this member so one person replaying
    another's key cannot be handed their answer."""
    message = (db.query(CompanionMessage)
               .join(CompanionConversation, CompanionConversation.id == CompanionMessage.conversation_id)
               .filter(CompanionMessage.id == UUID(reply_message_id),
                       CompanionConversation.member_id == principal.member_id)
               .one_or_none())
    if message is None:
        raise HTTPException(status_code=404, detail="That earlier answer is no longer available.")
    return AskResponse(
        conversation_id=message.conversation_id, member_message_id=message.id, reply_message_id=message.id,
        reply=message.content, outcome=message.outcome or "answered",
        # The policy decision belongs to the attempt, not to the message row;
        # a replay reports the answer it is handing back, not a fresh ruling.
        policy_outcome="allow", policy_category=None,
        sources=[], context_scopes=list(message.context_scopes or []),
        provider=message.provider or "", model=message.model or "",
        safety_result=message.safety_result or "ok", trace_id=message.trace_id, personalized=False,
    )
