from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
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
def ask(payload: AskRequest, principal: CurrentPrincipal = Depends(require_member), db: Session = Depends(get_db),
        service: CompanionService = Depends(get_companion_service)) -> AskResponse:
    try:
        reply = service.ask(principal, payload.message, conversation_id=payload.conversation_id)
    except CompanionError as exc:
        db.rollback()
        _raise(exc)
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
