"""Admin Companion -> Settings -> Advanced: AI Monitoring, Retrieval
Diagnostics, Safety Analytics, Provider Status and Audit.

Operational information only. No API keys, no vector internals beyond the
model name and chunk counts."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, text
from sqlalchemy.orm import Session, selectinload

from app.admin.companion_routes import summary_out
from app.admin.models import AdminAuditEntry
from app.admin.schemas import (
    AiMonitoringOut,
    AuditEntryOut,
    AuditPage,
    DiagnosticHitOut,
    DiagnosticQueryIn,
    ProviderStatusOut,
    RetrievalDiagnosticsOut,
    SafetyAnalyticsOut,
    TraceRowOut,
)
from app.auth.principal import require_admin
from app.companion.models import CompanionConversation, CompanionMessage, CompanionPolicyDecision
from app.companion.settings import get_or_create_settings
from app.core.config import Settings
from app.core.runtime import Runtime, get_runtime
from app.db.session import get_db
from app.knowledge.service import KnowledgeService
from app.observability.models import AiTraceEvent

router = APIRouter(prefix="/api/v1/admin/companion/advanced", tags=["admin-advanced"], dependencies=[Depends(require_admin)])


def trace_row(event: AiTraceEvent) -> TraceRowOut:
    return TraceRowOut(
        trace_id=event.trace_id, created_at=event.created_at, member_ref=event.member_ref, session_ref=event.session_ref,
        conversation_id=event.conversation_id, provider=event.provider, model=event.model, latency_ms=event.latency_ms,
        input_tokens=event.input_tokens, output_tokens=event.output_tokens, policy_outcome=event.policy_outcome,
        policy_category=event.policy_category, safety_result=event.safety_result, retrieval_count=event.retrieval_count,
        top_retrieval_score=event.top_retrieval_score, feedback=event.feedback, error_category=event.error_category,
        exporters=event.exporters,
    )


def _count_by(rows, attr: str) -> dict[str, int]:
    counts: dict[str, int] = {}
    for row in rows:
        key = getattr(row, attr) or "none"
        counts[key] = counts.get(key, 0) + 1
    return dict(sorted(counts.items()))


@router.get("/ai-monitoring", response_model=AiMonitoringOut)
def ai_monitoring(days: int = Query(default=30, ge=1, le=365), db: Session = Depends(get_db), runtime: Runtime = Depends(get_runtime)) -> AiMonitoringOut:
    since = datetime.now(timezone.utc) - timedelta(days=days)
    events = db.query(AiTraceEvent).filter(AiTraceEvent.created_at >= since).order_by(AiTraceEvent.created_at.desc()).all()
    answered = [e for e in events if e.provider and e.error_category is None and e.policy_outcome == "allow"]
    latencies = sorted(e.latency_ms for e in answered)
    p95 = latencies[min(len(latencies) - 1, int(round(0.95 * (len(latencies) - 1))))] if latencies else None
    return AiMonitoringOut(
        window_days=days, traces=len(events), answered=len(answered),
        average_latency_ms=int(sum(latencies) / len(latencies)) if latencies else None, p95_latency_ms=p95,
        input_tokens=sum(e.input_tokens or 0 for e in events), output_tokens=sum(e.output_tokens or 0 for e in events),
        by_provider=_count_by(answered, "provider"), by_outcome=_count_by(events, "policy_outcome"),
        by_error=_count_by([e for e in events if e.error_category], "error_category"), feedback=_count_by([e for e in events if e.feedback], "feedback"),
        telemetry=runtime.telemetry.describe(), langfuse_status=runtime.langfuse_status, recent=[trace_row(e) for e in events[:50]],
    )


@router.get("/retrieval-diagnostics", response_model=RetrievalDiagnosticsOut)
def retrieval_diagnostics(db: Session = Depends(get_db), runtime: Runtime = Depends(get_runtime)) -> RetrievalDiagnosticsOut:
    service = KnowledgeService(db, runtime.object_store, runtime.embeddings)
    events = (db.query(AiTraceEvent).filter(AiTraceEvent.policy_outcome == "allow")
              .order_by(AiTraceEvent.created_at.desc()).limit(50).all())
    scores = [e.top_retrieval_score for e in events if e.top_retrieval_score is not None]
    return RetrievalDiagnosticsOut(
        index=service.index_stats(), recent=[trace_row(e) for e in events],
        average_top_score=round(sum(scores) / len(scores), 4) if scores else None,
        empty_retrievals=sum(1 for e in events if e.retrieval_count == 0),
    )


@router.post("/retrieval-diagnostics/query", response_model=list[DiagnosticHitOut])
def retrieval_query(payload: DiagnosticQueryIn, db: Session = Depends(get_db), runtime: Runtime = Depends(get_runtime)) -> list[DiagnosticHitOut]:
    """Run a synthetic query against the approved index (administrator text only, never member data)."""
    service = KnowledgeService(db, runtime.object_store, runtime.embeddings)
    hits = service.search(payload.query, scopes=payload.scopes or None, limit=payload.limit)
    return [DiagnosticHitOut(source_id=h.source_id, document_id=h.document_id, chunk_id=h.chunk_id, title=h.source_title,
                             source_version=h.source_version, scope_key=h.scope_key, heading=h.heading, score=round(h.score, 4),
                             excerpt=h.text[:280]) for h in hits]


@router.get("/safety-analytics", response_model=SafetyAnalyticsOut)
def safety_analytics(days: int = Query(default=30, ge=1, le=365), db: Session = Depends(get_db)) -> SafetyAnalyticsOut:
    since = datetime.now(timezone.utc) - timedelta(days=days)
    decisions = db.query(CompanionPolicyDecision).filter(CompanionPolicyDecision.created_at >= since).all()
    replies = db.query(CompanionMessage).filter(CompanionMessage.role == "sprout", CompanionMessage.created_at >= since).all()
    escalated = (db.query(CompanionConversation).options(selectinload(CompanionConversation.messages))
                 .filter(CompanionConversation.flagged.is_(True)).order_by(CompanionConversation.last_message_at.desc()).limit(50).all())
    return SafetyAnalyticsOut(
        window_days=days, decisions_by_outcome=_count_by(decisions, "outcome"), decisions_by_category=_count_by(decisions, "category"),
        safety_results=_count_by(replies, "safety_result"), escalations=[summary_out(db, c) for c in escalated],
        policy_version=str(get_or_create_settings(db).policy.get("version", "")),
    )


def _auth_status(runtime: Runtime, settings: Settings) -> dict:
    """What actually authenticates people, and what still guards them.

    The split matters more than either half: Identity Platform proves who
    somebody is, and every authorization decision — the member profile, the
    administrator boolean, the portal cookie, the session revocation — stays
    in this API whichever provider is in use. The console should be able to
    show that, not a sentence someone wrote once.
    """
    identity = runtime.identity
    return {
        "provider": runtime.auth_provider.name if identity is None else identity.name,
        "sessions": "VEYE server-side, one HttpOnly cookie per portal",
        "authorization": "VEYE (member_id, admin_access, portal isolation)",
        "production_provider": "Google Cloud Identity Platform",
        "identity_verifier": "connected" if identity is not None else "not configured",
        "admin_mfa_required": settings.admin_mfa_required,
        "admin_accepted_second_factors": ", ".join(sorted(settings.admin_second_factors)) or "(none)",
    } | ({} if identity is None else identity.describe())


def _email_status(runtime: Runtime, settings: Settings) -> dict:
    """Derived from what is actually configured.

    This used to say "development / undecided" whatever was running, which
    stopped being true the moment a real relay was configured — a console that
    misreports its own transport is worse than one that says nothing. The
    provider's own describe() never contains the password.
    """
    described = runtime.email.describe()
    live = runtime.email.name == "smtp"
    return described | {
        "mode": "production" if live else "development",
        "production_transport": "Google Workspace SMTP (smtp.gmail.com:587, STARTTLS)",
        "production_ready": live,
        "reply_to_configured": bool(settings.email_reply_to),
        "environment_footer": "suppressed" if settings.is_production else "marks the message as non-production",
    }


@router.get("/provider-status", response_model=ProviderStatusOut)
def provider_status(db: Session = Depends(get_db), runtime: Runtime = Depends(get_runtime)) -> ProviderStatusOut:
    bind = db.get_bind()
    database = {"dialect": bind.dialect.name, "pgvector": None}
    if bind.dialect.name == "postgresql":
        version = db.execute(text("SELECT extversion FROM pg_extension WHERE extname = 'vector'")).scalar()
        database["pgvector"] = version or "not installed"
    settings = runtime.settings
    return ProviderStatusOut(
        environment=settings.environment,
        auth_provider=_auth_status(runtime, settings),
        email=_email_status(runtime, settings),
        llm=runtime.llm.describe(), embeddings=runtime.embeddings.describe(),
        object_store=runtime.object_store.describe() | {"production_target": "Google Cloud Storage"},
        telemetry=runtime.telemetry.describe(),
        langfuse={"status": runtime.langfuse_status, "enabled": settings.langfuse_enabled, "base_url": settings.langfuse_base_url if settings.langfuse_enabled else None,
                  "keys_present": bool(settings.langfuse_public_key and settings.langfuse_secret_key)},
        database=database,
    )


@router.get("/audit", response_model=AuditPage)
def audit(
    limit: int = Query(default=100, ge=1, le=500),
    page: int = Query(default=1, ge=1),
    db: Session = Depends(get_db),
) -> AuditPage:
    """Return one window of the audit log, and the size of the whole log.

    `total` is counted rather than inferred from the window: a screen that only
    receives rows cannot tell a full page from the end of the log, which is how
    a hundred-entry cap came to be rendered as if it were everything.
    """
    total = db.query(func.count(AdminAuditEntry.id)).scalar() or 0
    rows = (db.query(AdminAuditEntry)
            .order_by(AdminAuditEntry.created_at.desc(), AdminAuditEntry.id.desc())
            .offset((page - 1) * limit).limit(limit).all())
    return AuditPage(
        rows=[AuditEntryOut(id=r.id, actor_name=r.actor_name, action=r.action, entity_type=r.entity_type,
                            entity_id=r.entity_id, details=r.details, created_at=r.created_at) for r in rows],
        total=total, page=page, page_size=limit,
    )
