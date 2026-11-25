"""Member routes for guided experiences (Sprout's decision-tree flows)."""

from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.auth.principal import CurrentPrincipal, require_member
from app.companion.routes import admit, ask_response, deliver, get_companion_service
from app.companion.service import CompanionService
from app.core.runtime import Runtime, get_runtime
from app.db.session import get_db
from app.guided_flows.schemas import (
    ActionOut, AnswerRequest, AskInFlowRequest, AskInFlowResponse, ChoiceOut, FlowSummaryOut, NodeOut, OverviewOut, SessionSummaryOut, StepOut,
)
from app.guided_flows.service import GuidedFlowError, GuidedFlowService, Step

router = APIRouter(prefix="/api/v1/companion/guided-flows", tags=["guided-flows"])


def get_guided_flow_service(db: Session = Depends(get_db), runtime: Runtime = Depends(get_runtime)) -> GuidedFlowService:
    return GuidedFlowService(db, runtime)


def step_out(step: Step) -> StepOut:
    node = None
    if step.node is not None:
        node = NodeOut(id=step.node["id"], type=step.node["type"], section=step.node.get("section"), text=step.node["text"],
                       copy_origin=step.node.get("copy_origin", "client"),
                       choices=[ChoiceOut(**c) for c in step.node.get("choices", [])], answer_label=step.node.get("answer_label"),
                       task=step.node.get("task"))
    return StepOut(session_id=step.session_id, flow_key=step.flow_key, flow_title=step.flow_title, flow_version=step.flow_version,
                   status=step.status, messages=step.messages, node=node, actions=[ActionOut(**a) for a in step.actions],
                   clarification=step.clarification, reply=ask_response(step.reply) if step.reply else None,
                   section_title=step.section_title, steps_taken=step.steps_taken, content_meta=step.content_meta)


def _raise(exc: GuidedFlowError):
    raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.get("", response_model=OverviewOut)
def overview(principal: CurrentPrincipal = Depends(require_member), db: Session = Depends(get_db),
             service: GuidedFlowService = Depends(get_guided_flow_service)) -> OverviewOut:
    try:
        data = service.overview(principal)
    except GuidedFlowError as exc:
        _raise(exc)
    db.commit()
    return OverviewOut(flows=[FlowSummaryOut(**{**f, "session": SessionSummaryOut(**f["session"]) if f["session"] else None}) for f in data["flows"]],
                       first_arrival_offer=data["first_arrival_offer"])


def _run(db: Session, fn):
    try:
        step = fn()
    except GuidedFlowError as exc:
        db.rollback()
        _raise(exc)
    db.commit()
    return step_out(step)


@router.post("/{key}/start", response_model=StepOut)
def start(key: str, principal: CurrentPrincipal = Depends(require_member), db: Session = Depends(get_db),
          service: GuidedFlowService = Depends(get_guided_flow_service)) -> StepOut:
    return _run(db, lambda: service.start(principal, key))


@router.post("/{key}/restart", response_model=StepOut)
def restart(key: str, principal: CurrentPrincipal = Depends(require_member), db: Session = Depends(get_db),
            service: GuidedFlowService = Depends(get_guided_flow_service)) -> StepOut:
    return _run(db, lambda: service.restart(principal, key))


@router.get("/{key}/session", response_model=StepOut | None)
def current(key: str, principal: CurrentPrincipal = Depends(require_member), db: Session = Depends(get_db),
            service: GuidedFlowService = Depends(get_guided_flow_service)) -> StepOut | None:
    try:
        step = service.current(principal, key)
    except GuidedFlowError as exc:
        db.rollback()
        _raise(exc)
    db.commit()
    return step_out(step) if step else None


@router.post("/{key}/answer", response_model=StepOut)
def answer(key: str, payload: AnswerRequest, background: BackgroundTasks,
           principal: CurrentPrincipal = Depends(require_member), db: Session = Depends(get_db),
           service: GuidedFlowService = Depends(get_guided_flow_service),
           companion: CompanionService = Depends(get_companion_service)) -> StepOut:
    try:
        step = service.answer(principal, key, choice=payload.choice, text=payload.text, companion=companion)
    except GuidedFlowError as exc:
        db.rollback()
        _raise(exc)
    db.commit()
    if step.reply is not None and step.reply.outbox_ids:
        background.add_task(deliver, step.reply.outbox_ids)
    return step_out(step)


@router.post("/{key}/pause", response_model=StepOut)
def pause(key: str, principal: CurrentPrincipal = Depends(require_member), db: Session = Depends(get_db),
          service: GuidedFlowService = Depends(get_guided_flow_service)) -> StepOut:
    return _run(db, lambda: service.pause(principal, key))


@router.post("/{key}/skip", response_model=StepOut)
def skip(key: str, principal: CurrentPrincipal = Depends(require_member), db: Session = Depends(get_db),
         service: GuidedFlowService = Depends(get_guided_flow_service)) -> StepOut:
    return _run(db, lambda: service.skip(principal, key))


@router.post("/{key}/ask", response_model=AskInFlowResponse)
def ask(key: str, payload: AskInFlowRequest, request: Request, background: BackgroundTasks,
        principal: CurrentPrincipal = Depends(require_member), db: Session = Depends(get_db),
        service: GuidedFlowService = Depends(get_guided_flow_service),
        companion: CompanionService = Depends(get_companion_service)) -> AskInFlowResponse:
    # The same model, so the same allowance as asking from the chat.
    admit(db, request, principal, companion, payload.question)
    db.commit()
    try:
        reply, step = service.ask(principal, key, payload.question, companion)
    except GuidedFlowError as exc:
        db.rollback()
        _raise(exc)
    db.commit()
    if reply.outbox_ids:
        background.add_task(deliver, reply.outbox_ids)
    return AskInFlowResponse(reply=ask_response(reply), step=step_out(step))
