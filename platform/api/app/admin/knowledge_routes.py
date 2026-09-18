"""Admin Knowledge Sources: real persistence for the source lifecycle."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.admin.audit import record_audit
from app.admin.schemas import DocumentOut, KnowledgeOptionsOut, KnowledgeSourceInput, KnowledgeSourceOut
from app.auth.principal import CurrentPrincipal, require_admin
from app.core.runtime import Runtime, get_runtime
from app.db.session import get_db
from app.knowledge.models import SCOPES, SOURCE_STATUSES, SOURCE_TYPES, KnowledgeDocument, KnowledgeSource
from app.knowledge.service import KnowledgeError, KnowledgeService

router = APIRouter(prefix="/api/v1/admin/companion/knowledge-sources", tags=["admin-knowledge"], dependencies=[Depends(require_admin)])


def get_knowledge_service(db: Session = Depends(get_db), runtime: Runtime = Depends(get_runtime)) -> KnowledgeService:
    return KnowledgeService(db, runtime.object_store, runtime.embeddings)


def document_out(document: KnowledgeDocument) -> DocumentOut:
    return DocumentOut(id=document.id, source_version=document.source_version, filename=document.filename,
                       content_type=document.content_type, byte_size=document.byte_size, sha256=document.sha256,
                       is_current=document.is_current, ingestion_status=document.ingestion_status,
                       ingestion_error=document.ingestion_error, chunk_count=document.chunk_count,
                       ingested_at=document.ingested_at, created_at=document.created_at)


def source_out(source: KnowledgeSource, storage: str, *, with_documents: bool = False) -> KnowledgeSourceOut:
    current = source.current_document
    return KnowledgeSourceOut(
        id=source.id, title=source.title, type=source.type, scope_key=source.scope_key,
        scope_label=SCOPES.get(source.scope_key, source.scope_key), description=source.description,
        reference_label=source.reference_label, status=source.status, version=source.version, approved_by=source.approved_by,
        approved_at=source.approved_at, effective_date=source.effective_date, is_synthetic=source.is_synthetic,
        retrievable=source.retrievable, created_at=source.created_at, updated_at=source.updated_at, archived_at=source.archived_at,
        current_document=document_out(current) if current else None,
        documents=[document_out(d) for d in source.documents] if with_documents else [], storage=storage,
    )


def _raise(exc: KnowledgeError):
    raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.get("/options", response_model=KnowledgeOptionsOut)
def options() -> KnowledgeOptionsOut:
    return KnowledgeOptionsOut(types=list(SOURCE_TYPES), scopes=dict(SCOPES), statuses=list(SOURCE_STATUSES))


@router.get("", response_model=list[KnowledgeSourceOut])
def list_sources(service: KnowledgeService = Depends(get_knowledge_service), runtime: Runtime = Depends(get_runtime)) -> list[KnowledgeSourceOut]:
    return [source_out(s, runtime.object_store.name) for s in service.list_sources()]


@router.post("", response_model=KnowledgeSourceOut, status_code=201)
def create_source(payload: KnowledgeSourceInput, principal: CurrentPrincipal = Depends(require_admin), db: Session = Depends(get_db),
                  service: KnowledgeService = Depends(get_knowledge_service), runtime: Runtime = Depends(get_runtime)) -> KnowledgeSourceOut:
    try:
        source = service.create_source(title=payload.title, type=payload.type, scope_key=payload.scope_key, description=payload.description,
                                       reference_label=payload.reference_label, effective_date=payload.effective_date, synthetic=False)
    except KnowledgeError as exc:
        _raise(exc)
    record_audit(db, principal, "knowledge_source.created", "knowledge_source", str(source.id), {"title": source.title})
    db.commit()
    db.refresh(source)
    return source_out(source, runtime.object_store.name, with_documents=True)


@router.get("/{source_id}", response_model=KnowledgeSourceOut)
def get_source(source_id: UUID, service: KnowledgeService = Depends(get_knowledge_service), runtime: Runtime = Depends(get_runtime)) -> KnowledgeSourceOut:
    try:
        source = service.get_source(source_id)
    except KnowledgeError as exc:
        _raise(exc)
    return source_out(source, runtime.object_store.name, with_documents=True)


@router.put("/{source_id}", response_model=KnowledgeSourceOut)
def update_source(source_id: UUID, payload: KnowledgeSourceInput, principal: CurrentPrincipal = Depends(require_admin),
                  db: Session = Depends(get_db), service: KnowledgeService = Depends(get_knowledge_service),
                  runtime: Runtime = Depends(get_runtime)) -> KnowledgeSourceOut:
    try:
        source = service.update_source(service.get_source(source_id), title=payload.title, type=payload.type, scope_key=payload.scope_key,
                                       description=payload.description, reference_label=payload.reference_label, effective_date=payload.effective_date)
    except KnowledgeError as exc:
        _raise(exc)
    record_audit(db, principal, "knowledge_source.updated", "knowledge_source", str(source.id), {"title": source.title})
    db.commit()
    db.refresh(source)
    return source_out(source, runtime.object_store.name, with_documents=True)


@router.post("/{source_id}/document", response_model=KnowledgeSourceOut, status_code=201)
async def attach_document(source_id: UUID, file: UploadFile = File(...), principal: CurrentPrincipal = Depends(require_admin),
                          db: Session = Depends(get_db), service: KnowledgeService = Depends(get_knowledge_service),
                          runtime: Runtime = Depends(get_runtime)) -> KnowledgeSourceOut:
    data = await file.read()
    try:
        source = service.get_source(source_id)
        document = service.attach_document(source, filename=file.filename or "document.txt",
                                           content_type=file.content_type or "application/octet-stream", data=data)
    except KnowledgeError as exc:
        db.rollback()
        _raise(exc)
    record_audit(db, principal, "knowledge_document.attached", "knowledge_source", str(source.id),
                 {"filename": document.filename, "version": document.source_version, "ingestion_status": document.ingestion_status,
                  "storage": runtime.object_store.name})
    db.commit()
    db.refresh(source)
    return source_out(source, runtime.object_store.name, with_documents=True)


def _transition(action: str):
    def handler(source_id: UUID, principal: CurrentPrincipal = Depends(require_admin), db: Session = Depends(get_db),
                service: KnowledgeService = Depends(get_knowledge_service), runtime: Runtime = Depends(get_runtime)) -> KnowledgeSourceOut:
        try:
            source = service.get_source(source_id)
            if action == "activate":
                service.activate(source, approved_by=principal.display_name)
            elif action == "deactivate":
                service.deactivate(source)
            elif action == "archive":
                service.archive(source)
            else:
                service.restore(source)
        except KnowledgeError as exc:
            db.rollback()
            _raise(exc)
        record_audit(db, principal, f"knowledge_source.{action}d", "knowledge_source", str(source.id),
                     {"title": source.title, "status": source.status, "version": source.version})
        db.commit()
        db.refresh(source)
        return source_out(source, runtime.object_store.name, with_documents=True)

    handler.__name__ = f"{action}_source"
    return handler


for _action in ("activate", "deactivate", "archive", "restore"):
    router.add_api_route(f"/{{source_id}}/{_action}", _transition(_action), methods=["POST"], response_model=KnowledgeSourceOut)
