"""Admin Companion: overview, conversations (review), feedback and settings."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session, selectinload

from app.admin.audit import record_audit
from app.admin.schemas import (
    AdminMessageOut,
    ConversationDetailOut,
    ConversationSummaryOut,
    FeedbackRowOut,
    MemberContextCardOut,
    OverviewOut,
    PolicyDecisionOut,
    ReviewRequest,
    SettingsIn,
    SettingsOut,
)
from app.assessments.repository import health_number_history
from app.auth.models import UserAccount
from app.auth.principal import CurrentPrincipal, require_admin
from app.companion.models import CompanionConversation, CompanionFeedback, CompanionMessage, CompanionPolicyDecision
from app.companion.policy import MEMBER_DATA_SCOPES, POLICY_VERSION
from app.companion.routes import message_out
from app.companion.settings import get_or_create_settings
from app.core.runtime import Runtime, get_runtime
from app.db.session import get_db
from app.knowledge.models import SCOPES, KnowledgeSource
from app.knowledge.service import KnowledgeService
from app.members.models import Member
from app.observability.models import AiTraceEvent

router = APIRouter(prefix="/api/v1/admin/companion", tags=["admin-companion"], dependencies=[Depends(require_admin)])


def _member_user(db: Session, member_id: UUID) -> tuple[Member | None, UserAccount | None]:
    member = db.get(Member, member_id)
    user = db.query(UserAccount).filter(UserAccount.member_id == member_id).one_or_none()
    return member, user


def summary_out(db: Session, conversation: CompanionConversation) -> ConversationSummaryOut:
    member, user = _member_user(db, conversation.member_id)
    messages = conversation.messages
    first = next((m.content for m in messages if m.role == "member"), "")
    feedback = next((m.feedback.rating for m in messages if m.feedback is not None), None)
    outcomes = sorted({m.outcome for m in messages if m.outcome})
    return ConversationSummaryOut(
        id=conversation.id, member_name=(user.display_name if user else member.display_name if member else "Member"),
        member_email=(user.email if user else member.email if member else ""), started_at=conversation.started_at,
        last_message_at=conversation.last_message_at, message_count=conversation.message_count, flagged=conversation.flagged,
        flag_reason=conversation.flag_reason, reviewed_at=conversation.reviewed_at, reviewed_by=conversation.reviewed_by,
        first_message=first[:160], feedback_rating=feedback, outcomes=outcomes,
    )


@router.get("/overview", response_model=OverviewOut)
def overview(db: Session = Depends(get_db), runtime: Runtime = Depends(get_runtime)) -> OverviewOut:
    week_ago = datetime.now(timezone.utc) - timedelta(days=7)
    sources = db.query(KnowledgeSource).options(selectinload(KnowledgeSource.documents)).all()
    return OverviewOut(
        conversations_total=db.query(func.count(CompanionConversation.id)).scalar() or 0,
        conversations_needing_review=db.query(func.count(CompanionConversation.id)).filter(
            CompanionConversation.flagged.is_(True), CompanionConversation.reviewed_at.is_(None)).scalar() or 0,
        feedback_total=db.query(func.count(CompanionFeedback.id)).scalar() or 0,
        feedback_unreviewed=db.query(func.count(CompanionFeedback.id)).filter(CompanionFeedback.reviewed_at.is_(None)).scalar() or 0,
        knowledge_sources_active=sum(1 for s in sources if s.retrievable), knowledge_sources_total=len(sources),
        traces_last_7_days=db.query(func.count(AiTraceEvent.id)).filter(AiTraceEvent.created_at >= week_ago).scalar() or 0,
        escalations_last_7_days=db.query(func.count(CompanionPolicyDecision.id)).filter(
            CompanionPolicyDecision.outcome == "escalate", CompanionPolicyDecision.created_at >= week_ago).scalar() or 0,
        llm_provider=runtime.llm.name, llm_model=getattr(runtime.llm, "model", None), langfuse_status=runtime.langfuse_status,
    )


@router.get("/conversations", response_model=list[ConversationSummaryOut])
def conversations(filter: str = Query(default="needs_review", pattern="^(needs_review|reviewed|all)$"), q: str = "",
                  db: Session = Depends(get_db)) -> list[ConversationSummaryOut]:
    query = (db.query(CompanionConversation).options(selectinload(CompanionConversation.messages))
             .filter(CompanionConversation.message_count > 0))
    if filter == "needs_review":
        query = query.filter(CompanionConversation.flagged.is_(True), CompanionConversation.reviewed_at.is_(None))
    elif filter == "reviewed":
        query = query.filter(CompanionConversation.reviewed_at.is_not(None))
    rows = [summary_out(db, c) for c in query.order_by(CompanionConversation.last_message_at.desc()).limit(200).all()]
    needle = q.strip().lower()
    if needle:
        rows = [r for r in rows if needle in r.member_name.lower() or needle in r.first_message.lower()]
    return rows


def _decision_out(decision: CompanionPolicyDecision | None) -> PolicyDecisionOut | None:
    if decision is None:
        return None
    return PolicyDecisionOut(id=decision.id, outcome=decision.outcome, category=decision.category, matched_rule=decision.matched_rule,
                             retrieval_scopes=decision.retrieval_scopes, member_data_scopes=decision.member_data_scopes,
                             reason=decision.reason, policy_version=decision.policy_version, created_at=decision.created_at)


@router.get("/conversations/{conversation_id}", response_model=ConversationDetailOut)
def conversation_detail(conversation_id: UUID, db: Session = Depends(get_db)) -> ConversationDetailOut:
    conversation = db.get(CompanionConversation, conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found.")
    member, user = _member_user(db, conversation.member_id)
    latest = health_number_history(db, conversation.member_id)
    hn = f"{float(latest[0].displayed_score):.1f} — {latest[0].status}" if latest else "Not completed"
    messages = []
    for m in conversation.messages:
        base = message_out(m)
        messages.append(AdminMessageOut(**base.model_dump(), provider=m.provider, model=m.model, latency_ms=m.latency_ms,
                                        safety_result=m.safety_result, context_scopes=m.context_scopes, trace_id=m.trace_id,
                                        policy_decision=_decision_out(m.policy_decision)))
    return ConversationDetailOut(
        summary=summary_out(db, conversation),
        member=MemberContextCardOut(name=user.display_name if user else (member.display_name if member else "Member"),
                                    email=user.email if user else (member.email if member else ""),
                                    member_since=member.created_at if member else conversation.started_at, health_number=hn,
                                    email_verified=bool(user and user.email_verified_at), is_synthetic=bool(user and user.is_synthetic)),
        messages=messages,
    )


@router.post("/conversations/{conversation_id}/review", response_model=ConversationSummaryOut)
def review_conversation(conversation_id: UUID, payload: ReviewRequest, principal: CurrentPrincipal = Depends(require_admin),
                        db: Session = Depends(get_db)) -> ConversationSummaryOut:
    conversation = db.get(CompanionConversation, conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found.")
    conversation.reviewed_at = datetime.now(timezone.utc)
    conversation.reviewed_by = principal.display_name
    record_audit(db, principal, "conversation.reviewed", "companion_conversation", str(conversation.id), {"note": payload.note})
    db.commit()
    db.refresh(conversation)
    return summary_out(db, conversation)


@router.get("/feedback", response_model=list[FeedbackRowOut])
def feedback(filter: str = Query(default="all", pattern="^(all|unreviewed|reviewed)$"), db: Session = Depends(get_db)) -> list[FeedbackRowOut]:
    query = db.query(CompanionFeedback).options(selectinload(CompanionFeedback.message))
    if filter == "unreviewed":
        query = query.filter(CompanionFeedback.reviewed_at.is_(None))
    elif filter == "reviewed":
        query = query.filter(CompanionFeedback.reviewed_at.is_not(None))
    rows = []
    for fb in query.order_by(CompanionFeedback.submitted_at.desc()).limit(200).all():
        member, user = _member_user(db, fb.member_id)
        rows.append(FeedbackRowOut(
            id=fb.id, conversation_id=fb.conversation_id, message_id=fb.message_id,
            member_name=user.display_name if user else (member.display_name if member else "Member"), rating=fb.rating,
            reason=fb.reason, comment=fb.comment, submitted_at=fb.submitted_at, reviewed_at=fb.reviewed_at, reviewed_by=fb.reviewed_by,
            reply_excerpt=(fb.message.content[:160] if fb.message else ""),
        ))
    return rows


@router.post("/feedback/{feedback_id}/review", response_model=FeedbackRowOut)
def review_feedback(feedback_id: UUID, principal: CurrentPrincipal = Depends(require_admin), db: Session = Depends(get_db)) -> FeedbackRowOut:
    fb = db.get(CompanionFeedback, feedback_id)
    if fb is None:
        raise HTTPException(status_code=404, detail="Feedback not found.")
    fb.reviewed_at = datetime.now(timezone.utc)
    fb.reviewed_by = principal.display_name
    record_audit(db, principal, "feedback.reviewed", "companion_feedback", str(fb.id), {"rating": fb.rating})
    db.commit()
    member, user = _member_user(db, fb.member_id)
    return FeedbackRowOut(id=fb.id, conversation_id=fb.conversation_id, message_id=fb.message_id,
                          member_name=user.display_name if user else (member.display_name if member else "Member"), rating=fb.rating,
                          reason=fb.reason, comment=fb.comment, submitted_at=fb.submitted_at, reviewed_at=fb.reviewed_at,
                          reviewed_by=fb.reviewed_by, reply_excerpt=(fb.message.content[:160] if fb.message else ""))


def settings_out(row) -> SettingsOut:
    return SettingsOut(
        enabled=row.enabled, name=row.name, welcome=row.welcome, returning_welcome=row.returning_welcome,
        safe_response=row.safe_response, fallback=row.fallback, escalation_response=row.escalation_response,
        quick_prompts=row.quick_prompts, policy=row.policy, member_data_scope_options=list(MEMBER_DATA_SCOPES),
        retrieval_scope_options=dict(SCOPES), updated_at=row.updated_at, updated_by=row.updated_by,
    )


@router.get("/settings", response_model=SettingsOut)
def get_settings(db: Session = Depends(get_db)) -> SettingsOut:
    row = get_or_create_settings(db)
    db.commit()
    return settings_out(row)


@router.put("/settings", response_model=SettingsOut)
def update_settings(payload: SettingsIn, principal: CurrentPrincipal = Depends(require_admin), db: Session = Depends(get_db)) -> SettingsOut:
    row = get_or_create_settings(db)
    policy = payload.policy.model_dump()
    policy["version"] = policy.get("version") or POLICY_VERSION
    unknown_scopes = {s for t in policy["topics"] for s in t["member_data_scopes"]} - set(MEMBER_DATA_SCOPES)
    unknown_retrieval = {s for t in policy["topics"] for s in t["retrieval_scopes"]} - set(SCOPES)
    if unknown_scopes or unknown_retrieval:
        raise HTTPException(status_code=422, detail=f"Unknown scopes: {sorted(unknown_scopes | unknown_retrieval)}")
    changed = [k for k in ("enabled", "name", "welcome", "returning_welcome", "safe_response", "fallback", "escalation_response")
               if getattr(row, k) != getattr(payload, k)]
    row.enabled, row.name, row.welcome, row.returning_welcome = payload.enabled, payload.name, payload.welcome, payload.returning_welcome
    row.safe_response, row.fallback, row.escalation_response = payload.safe_response, payload.fallback, payload.escalation_response
    row.quick_prompts = [p.model_dump() for p in payload.quick_prompts]
    row.policy = policy
    row.updated_by = principal.display_name
    record_audit(db, principal, "settings.updated", "companion_settings", "1",
                 {"changed": changed + ["quick_prompts", "policy"], "topics_allowed": [t["key"] for t in policy["topics"] if t["allowed"]]})
    db.commit()
    db.refresh(row)
    return settings_out(row)
