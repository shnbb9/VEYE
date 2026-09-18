"""Admin: Companion → Settings → Guided Experiences.

Read-only preview of each versioned flow, plus the two safe transitions
(activate / deactivate). There is deliberately no raw-JSON editor: a new
version is published from code and reviewed here."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.admin.audit import record_audit
from app.auth.principal import CurrentPrincipal, require_admin
from app.db.session import get_db
from app.guided_flows.catalog import BUILTIN_KEYS
from app.guided_flows.engine import FlowDefinitionError, GuidedFlowDefinition
from app.guided_flows.models import SESSION_COMPLETED, SESSION_IN_PROGRESS, SESSION_PAUSED, STATUS_ACTIVE, GuidedFlow, MemberGuidedFlowSession
from app.guided_flows.schemas import AdminEdgeOut, AdminFlowDetailOut, AdminFlowGroupOut, AdminFlowVersionOut
from app.guided_flows.service import GuidedFlowError, activate_flow, deactivate_flow

router = APIRouter(prefix="/api/v1/admin/companion/guided-flows", tags=["admin-guided-flows"], dependencies=[Depends(require_admin)])


def _counts(db: Session, flow_id: UUID) -> tuple[int, int, int]:
    rows = (db.query(MemberGuidedFlowSession.status, func.count(MemberGuidedFlowSession.id))
            .filter(MemberGuidedFlowSession.flow_id == flow_id).group_by(MemberGuidedFlowSession.status).all())
    by = {status: count for status, count in rows}
    return sum(by.values()), by.get(SESSION_IN_PROGRESS, 0) + by.get(SESSION_PAUSED, 0), by.get(SESSION_COMPLETED, 0)


def version_out(db: Session, flow: GuidedFlow) -> AdminFlowVersionOut:
    total, running, completed = _counts(db, flow.id)
    meta = dict(flow.definition.get("content_meta", {}))
    return AdminFlowVersionOut(
        id=flow.id, key=flow.key, title=flow.title, version=flow.version, status=flow.status, source=flow.source,
        content_meta={k: meta.get(k) for k in ("source", "client_supplied", "clinical_review_status", "source_version", "source_date", "source_file")},
        node_count=len(flow.definition.get("nodes", {})), created_at=flow.created_at, updated_at=flow.updated_at,
        published_at=flow.published_at, published_by=flow.published_by,
        sessions_total=total, sessions_in_progress=running, sessions_completed=completed,
    )


@router.get("", response_model=list[AdminFlowGroupOut])
def list_flows(db: Session = Depends(get_db)) -> list[AdminFlowGroupOut]:
    rows = db.query(GuidedFlow).order_by(GuidedFlow.key, GuidedFlow.version.desc()).all()
    groups: dict[str, list[GuidedFlow]] = {}
    for row in rows:
        groups.setdefault(row.key, []).append(row)
    out = []
    for key, versions in groups.items():
        active = next((v.version for v in versions if v.status == STATUS_ACTIVE), None)
        out.append(AdminFlowGroupOut(key=key, title=versions[0].title, active_version=active, versions=[version_out(db, v) for v in versions]))
    return out


@router.get("/{flow_id}", response_model=AdminFlowDetailOut)
def flow_detail(flow_id: UUID, db: Session = Depends(get_db)) -> AdminFlowDetailOut:
    flow = db.get(GuidedFlow, flow_id)
    if flow is None:
        raise HTTPException(status_code=404, detail="Guided experience not found.")
    definition = GuidedFlowDefinition(flow.definition, known_flow_keys=BUILTIN_KEYS)
    try:
        definition.validate()
        validation = "valid"
    except FlowDefinitionError as exc:
        validation = str(exc)
    return AdminFlowDetailOut(flow=version_out(db, flow), definition=flow.definition,
                              edges=[AdminEdgeOut(from_node=a, via=b, to_node=c) for a, b, c in definition.edges()], validation=validation)


@router.post("/{flow_id}/activate", response_model=AdminFlowVersionOut)
def activate(flow_id: UUID, principal: CurrentPrincipal = Depends(require_admin), db: Session = Depends(get_db)) -> AdminFlowVersionOut:
    flow = db.get(GuidedFlow, flow_id)
    if flow is None:
        raise HTTPException(status_code=404, detail="Guided experience not found.")
    try:
        activate_flow(db, flow, by=principal.display_name)
    except (GuidedFlowError, FlowDefinitionError) as exc:
        db.rollback()
        raise HTTPException(status_code=getattr(exc, "status_code", 422), detail=getattr(exc, "detail", str(exc))) from exc
    record_audit(db, principal, "guided_flow.activated", "guided_flow", str(flow.id), {"key": flow.key, "version": flow.version})
    db.commit()
    db.refresh(flow)
    return version_out(db, flow)


@router.post("/{flow_id}/deactivate", response_model=AdminFlowVersionOut)
def deactivate(flow_id: UUID, principal: CurrentPrincipal = Depends(require_admin), db: Session = Depends(get_db)) -> AdminFlowVersionOut:
    flow = db.get(GuidedFlow, flow_id)
    if flow is None:
        raise HTTPException(status_code=404, detail="Guided experience not found.")
    try:
        deactivate_flow(db, flow)
    except GuidedFlowError as exc:
        db.rollback()
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    record_audit(db, principal, "guided_flow.deactivated", "guided_flow", str(flow.id), {"key": flow.key, "version": flow.version})
    db.commit()
    db.refresh(flow)
    return version_out(db, flow)
