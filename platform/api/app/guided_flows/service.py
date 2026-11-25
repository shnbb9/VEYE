"""GuidedFlowService: runs Cara's decision trees for a member.

- Only Active flows can be started; a session pins the flow id and version it
  started with and keeps running that version even after a newer one is
  published.
- The engine decides every transition. Free text can only select one of the
  current step's options (see interpreter.py); anything unclear asks for
  clarification and leaves the state untouched.
- A member may pause, resume, skip (explore on their own) or restart.
- An explanatory question in the middle of a step goes through the existing
  CompanionService pipeline (policy → approved knowledge → provider → safety)
  and the flow returns to the same step afterwards."""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from uuid import UUID, uuid4

from sqlalchemy.orm import Session

from app.auth.principal import CurrentPrincipal
from app.companion.distress import DISTRESS, RANK, Assessment
from app.companion.safety_copy import UNSURE_LINE
from app.companion.service import CompanionError, CompanionReply, CompanionService, passing
from app.core.rate_limit import RateLimiter
from app.core.runtime import Runtime
from app.guided_flows.catalog import BUILTIN_KEYS
from app.guided_flows.engine import (
    AI_TASK, CHECK_MEMBER_STATE, CHOICE, COMPLETE, INTERACTIVE, KNOWLEDGE, MESSAGE, NAVIGATION, QUESTION,
    FlowDefinitionError, GuidedFlowDefinition,
)
from app.companion.providers.llm import DataClassification, classify_for
from app.guided_flows.interpreter import interpret
from app.guided_flows.member_state import MemberStateService
from app.guided_flows.models import (
    SESSION_COMPLETED, SESSION_IN_PROGRESS, SESSION_PAUSED, SESSION_SKIPPED, STATUS_ACTIVE, STATUS_ARCHIVED, STATUS_DRAFT,
    GuidedFlow, MemberGuidedFlowSession,
)
from app.knowledge.service import SEARCH_FAILED, KnowledgeService

log = logging.getLogger("veye.guides")

FIRST_TIME_FLOW = "first_time_user"
PROGRESS_GUIDE_FLOW = "progress_tracker_guide"
MAX_HOPS = 60

CLARIFICATION = "I want to be sure I follow you — please choose one of the options below."


class GuidedFlowError(Exception):
    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


@dataclass
class Step:
    session_id: UUID
    flow_key: str
    flow_title: str
    flow_version: int
    status: str
    messages: list[str] = field(default_factory=list)
    node: dict | None = None
    actions: list[dict] = field(default_factory=list)
    clarification: str | None = None
    # Sprout's answer, when what was typed was not an answer to the step but
    # somebody saying they may not be all right. The step has not moved.
    reply: CompanionReply | None = None
    section_title: str = ""
    steps_taken: int = 0
    content_meta: dict = field(default_factory=dict)


def _now() -> datetime:
    return datetime.now(timezone.utc)


class GuidedFlowService:
    def __init__(self, db: Session, runtime: Runtime) -> None:
        self.db = db
        self.runtime = runtime
        self.member_state = MemberStateService(db)
        self.knowledge = KnowledgeService(db, runtime.object_store, runtime.embeddings)

    # ---- flows --------------------------------------------------------------------------------
    def active_flow(self, key: str) -> GuidedFlow:
        row = db_active(self.db, key)
        if row is None:
            exists = self.db.query(GuidedFlow).filter(GuidedFlow.key == key).count() > 0
            raise GuidedFlowError(409 if exists else 404, "This guided experience is not available at the moment." if exists
                                  else "Unknown guided experience.")
        return row

    def active_flows(self) -> list[GuidedFlow]:
        return self.db.query(GuidedFlow).filter(GuidedFlow.status == STATUS_ACTIVE).order_by(GuidedFlow.key).all()

    def definition_for(self, flow: GuidedFlow) -> GuidedFlowDefinition:
        return GuidedFlowDefinition(flow.definition, known_flow_keys=BUILTIN_KEYS)

    # ---- sessions -----------------------------------------------------------------------------
    def latest_session(self, principal: CurrentPrincipal, key: str) -> MemberGuidedFlowSession | None:
        return (self.db.query(MemberGuidedFlowSession)
                .filter(MemberGuidedFlowSession.member_id == principal.member_id, MemberGuidedFlowSession.flow_key == key)
                .order_by(MemberGuidedFlowSession.started_at.desc()).first())

    def has_any_session(self, principal: CurrentPrincipal) -> bool:
        return self.db.query(MemberGuidedFlowSession).filter(MemberGuidedFlowSession.member_id == principal.member_id).count() > 0

    def overview(self, principal: CurrentPrincipal) -> dict:
        self._require_member(principal)
        flows = []
        for flow in self.active_flows():
            session = self.latest_session(principal, flow.key)
            definition = self.definition_for(flow)
            flows.append({
                "key": flow.key, "title": flow.title, "version": flow.version, "description": definition.data.get("description", ""),
                "session": self._session_summary(session, definition) if session else None,
            })
        first_time_active = db_active(self.db, FIRST_TIME_FLOW) is not None
        return {
            "flows": flows,
            # Cara: a genuinely new member is offered the guide once; choosing either way settles it.
            "first_arrival_offer": first_time_active and not self.has_any_session(principal),
        }

    def start(self, principal: CurrentPrincipal, key: str) -> Step:
        self._require_member(principal)
        session = self.latest_session(principal, key)
        if session is not None and session.status in (SESSION_IN_PROGRESS, SESSION_PAUSED):
            # resume: the pinned version keeps running even if the flow was re-published or archived since
            if session.status == SESSION_PAUSED:
                session.status = SESSION_IN_PROGRESS
                session.answers = {**session.answers, "resumed_at": _now().isoformat()}
            return self._render(session, resumed=True)
        flow = self.active_flow(key)  # a new session always needs an Active flow
        definition = self.definition_for(flow)
        session = MemberGuidedFlowSession(member_id=principal.member_id, flow_id=flow.id, flow_key=flow.key, flow_version=flow.version,
                                          current_node=definition.start, answers={"history": [], "questions_asked": 0, "pauses": 0},
                                          status=SESSION_IN_PROGRESS)
        self.db.add(session)
        self.db.flush()
        return self._render(session)

    def restart(self, principal: CurrentPrincipal, key: str) -> Step:
        self._require_member(principal)
        session = self.latest_session(principal, key)
        if session is not None and session.status in (SESSION_IN_PROGRESS, SESSION_PAUSED):
            session.status = SESSION_SKIPPED
            self.db.flush()
        return self.start(principal, key)

    def current(self, principal: CurrentPrincipal, key: str) -> Step | None:
        self._require_member(principal)
        session = self.latest_session(principal, key)
        if session is None:
            return None
        return self._render(session)

    def pause(self, principal: CurrentPrincipal, key: str) -> Step:
        session = self._open_session(principal, key)
        session.status = SESSION_PAUSED
        session.answers = {**session.answers, "pauses": int(session.answers.get("pauses", 0)) + 1}
        self.db.flush()
        return self._render(session)

    def skip(self, principal: CurrentPrincipal, key: str) -> Step:
        """Explore on my own: nothing more is asked; the member can start later."""
        self._require_member(principal)
        session = self.latest_session(principal, key)
        if session is None or session.status in (SESSION_COMPLETED, SESSION_SKIPPED):
            flow = self.active_flow(key)
            definition = self.definition_for(flow)
            session = MemberGuidedFlowSession(member_id=principal.member_id, flow_id=flow.id, flow_key=flow.key, flow_version=flow.version,
                                              current_node=definition.start, answers={"history": [], "questions_asked": 0, "pauses": 0},
                                              status=SESSION_SKIPPED)
            self.db.add(session)
        else:
            session.status = SESSION_SKIPPED
        self.db.flush()
        definition = self.definition_for(session.flow)
        step = self._render(session)
        explore = definition.content_meta.get("explore_message")
        if explore:
            step.messages = [explore]
        return step

    def answer(self, principal: CurrentPrincipal, key: str, *, choice: str | None = None, text: str | None = None,
               companion: CompanionService | None = None) -> Step:
        # Every typed reply is read for that first, before anything about the
        # guide: "I can't go on" is not "yes, continue", and a guide that was
        # finished on another device must not refuse to hear it.
        unsure = listed = False
        if text is not None and companion is not None:
            assessment = self._assess(principal, key, text, companion)
            # "No" to what Sprout just asked is not "no" to the step.
            if RANK[assessment.level] >= RANK[DISTRESS] or assessment.steadier:
                return self._heard(principal, key, text, companion, assessment)
            unsure, listed = assessment.unsure, companion.hands_over(assessment)
        session = self._open_session(principal, key)
        definition = self.definition_for(session.flow)
        node = definition.node(session.current_node)
        kind = node["type"]
        via = "choice"
        if kind == COMPLETE:
            raise GuidedFlowError(409, "This guided experience is complete. Start it again if you would like to review it.")
        if kind in (CHOICE, AI_TASK):
            keys = [c["key"] for c in node.get("choices", [])]
            if choice is not None:
                if choice not in keys:
                    raise GuidedFlowError(422, "That is not one of the options for this step.")
            elif text is not None:
                asked_at, asked = session.current_node, []
                result = interpret(text, node.get("choices", []), provider=self.runtime.llm, classification=classify_for(principal),
                                   may_ask=lambda: self._may_ask(principal, asked))
                if result.choice_key is None and (unsure or listed):
                    return self._heard(principal, key, text, companion, assessment)
                if any(asked):
                    # A model was waited for, with nothing held. If the guide was
                    # answered elsewhere meanwhile, this was not its step; what
                    # was said was said all the same.
                    self.db.refresh(session)
                    if session.current_node != asked_at or session.status != SESSION_IN_PROGRESS:
                        return self._heard(principal, key, text, companion, assessment) if unsure or listed else self._render(session)
                if result.choice_key is None:
                    step = self._render(session)
                    step.clarification = CLARIFICATION
                    return step
                choice, via = result.choice_key, result.via
            else:
                raise GuidedFlowError(422, "Choose an option or type a reply.")
        elif kind == QUESTION:
            if listed:  # what the team asked to be handed is, wherever it is said
                return self._heard(principal, key, text, companion, assessment)
            choice, via = None, "response"  # every response advances; the text itself is not stored
        else:  # MESSAGE / NAVIGATION / CHECK never wait for input; treat as continue
            choice, via = None, "continue"
        try:
            transition = definition.transition(session.current_node, choice, state=self.member_state.snapshot(principal.member_id))
        except FlowDefinitionError as exc:
            raise GuidedFlowError(422, str(exc)) from exc
        history = list(session.answers.get("history", []))
        history.append({"node": session.current_node, "choice": choice, "via": via, "at": _now().isoformat()})
        session.answers = {**session.answers, "history": history}
        if transition.next_node is None:
            step = self._complete(session)
        else:
            session.current_node = transition.next_node
            self.db.flush()
            step = self._render(session)
        if unsure:  # it was an answer, so the guide goes on, and this is said as well
            step.messages = [UNSURE_LINE, *step.messages]
        return step

    def _may_ask(self, principal: CurrentPrincipal, asked: list[bool]) -> bool:
        """The same model as the chat's, so the same allowance. Past it nobody
        is refused: they are asked to choose, as when the model cannot tell."""
        limiter, subject = RateLimiter(self.db), str(principal.member_id)
        allowed = limiter.check("companion_message", subject=subject) is None
        if allowed:
            limiter.record("companion_message", subject=subject)
            self.db.commit()    # nothing is held while a model is waited for
        asked.append(allowed)
        return allowed

    def _assess(self, principal: CurrentPrincipal, key: str, text: str, companion: CompanionService):
        """Read as Sprout reads it, except that "yes" after a step of the guide
        is an answer to the step."""
        self._require_member(principal)
        session = self.latest_session(principal, key)
        return companion.assess(principal, " ".join(text.split()), since=session.updated_at if session is not None else None)

    def _heard(self, principal: CurrentPrincipal, key: str, text: str, companion: CompanionService, assessment: Assessment) -> Step:
        """It was not an answer to the step: Sprout answers it, and the step
        waits, if there is one. Nothing that is answered from fixed words, or
        handed to a person, is ever held to an allowance; an answer the model
        would write is, as in the chat, and past it they are still told where
        help is."""
        reply: CompanionReply | None = None
        if not companion.asks_a_model(assessment) or self._may_ask(principal, []):
            try:
                reply = companion.ask(principal, text)
            except CompanionError as exc:
                raise GuidedFlowError(exc.status_code, exc.detail) from exc
        session = self.latest_session(principal, key)
        step = (Step(session_id=uuid4(), flow_key=key, flow_title="", flow_version=0, status=SESSION_SKIPPED) if session is None
                else self._render(session))
        step.reply = reply
        if reply is None:
            step.clarification = f"{UNSURE_LINE} {CLARIFICATION}" if assessment.unsure else CLARIFICATION
        return step

    def ask(self, principal: CurrentPrincipal, key: str, question: str, companion: CompanionService) -> tuple[CompanionReply, Step]:
        """An explanatory question mid-step: the Companion pipeline answers, the
        flow state is untouched, and the same step is returned."""
        assessment = self._assess(principal, key, question, companion)
        if RANK[assessment.level] >= RANK[DISTRESS] or assessment.steadier:
            step = self._heard(principal, key, question, companion, assessment)
            assert step.reply is not None
            return step.reply, step
        session = self._open_session(principal, key)
        try:
            reply = companion.ask(principal, question)
        except CompanionError as exc:
            raise GuidedFlowError(exc.status_code, exc.detail) from exc
        session.answers = {**session.answers, "questions_asked": int(session.answers.get("questions_asked", 0)) + 1}
        self.db.flush()
        return reply, self._render(session)

    # ---- rendering ----------------------------------------------------------------------------
    def _render(self, session: MemberGuidedFlowSession, *, resumed: bool = False) -> Step:
        flow = session.flow
        definition = self.definition_for(flow)
        step = Step(session_id=session.id, flow_key=flow.key, flow_title=flow.title, flow_version=flow.version, status=session.status,
                    steps_taken=len(session.answers.get("history", [])), content_meta=self._public_meta(definition))
        if session.status in (SESSION_SKIPPED,):
            step.section_title = definition.section_title(session.current_node)
            return step
        state: dict[str, bool] | None = None
        hops = 0
        while True:
            hops += 1
            if hops > MAX_HOPS:
                raise GuidedFlowError(500, "The guided experience did not reach a step.")
            node = definition.node(session.current_node)
            kind = node["type"]
            if kind == CHECK_MEMBER_STATE:
                state = state or self.member_state.snapshot(session.member_id)
                session.current_node = definition.transition(session.current_node, state=state).next_node
                continue
            if kind == MESSAGE:
                step.messages.append(node["text"])
                session.current_node = node["next"]
                if node.get("pause"):
                    session.status = SESSION_PAUSED
                    session.answers = {**session.answers, "pauses": int(session.answers.get("pauses", 0)) + 1}
                    step.status = session.status
                    step.section_title = definition.section_title(session.current_node)
                    self.db.flush()
                    return step
                continue
            if kind == NAVIGATION:
                step.messages.append(node["text"])
                step.actions.append(dict(node["action"]))
                session.current_node = node["next"]
                continue
            if kind == KNOWLEDGE:
                step.messages.append(node["text"])
                try:
                    # The guide's own words, published by the team: nobody's
                    # personal data.
                    # Not saved half way: if it cannot be found, the answer that
                    # led here was not given.
                    passages = self.knowledge.search(node["query"], scopes=list(node.get("scopes", [])) or None, limit=2,
                                                     classification=DataClassification.GENERAL)
                except SEARCH_FAILED as exc:
                    log.warning("guide stopped: approved knowledge could not be searched (%s): %s", exc.category, exc)
                    raise GuidedFlowError(503, "This part of the guide is not available just now. Please try again in a moment." if passing(exc)
                                          else "This part of the guide is not available in this environment yet.") from None
                step.messages.extend(p.text.strip() for p in passages)
                session.current_node = node["next"]
                continue
            # interactive: stop here
            if kind == COMPLETE and session.status != SESSION_COMPLETED:
                session.status = SESSION_COMPLETED
                session.completed_at = _now()
            step.status = session.status
            step.node = self._node_out(node, session.current_node)
            step.section_title = definition.section_title(session.current_node)
            self.db.flush()
            return step

    def _complete(self, session: MemberGuidedFlowSession) -> Step:
        session.status = SESSION_COMPLETED
        session.completed_at = _now()
        self.db.flush()
        return self._render(session)

    @staticmethod
    def _node_out(node: dict, node_id: str) -> dict:
        out = {"id": node_id, "type": node["type"], "section": node.get("section"), "text": node["text"], "copy_origin": node.get("copy_origin", "client")}
        if node["type"] in (CHOICE, AI_TASK):
            out["choices"] = [{"key": c["key"], "label": c["label"]} for c in node.get("choices", [])]
        if node["type"] == QUESTION:
            out["answer_label"] = node.get("answer_label", "Continue")
        if node["type"] == AI_TASK:
            out["task"] = node.get("task")
        return out

    @staticmethod
    def _public_meta(definition: GuidedFlowDefinition) -> dict:
        meta = definition.content_meta
        return {k: meta.get(k) for k in ("source", "client_supplied", "clinical_review_status", "source_version", "source_date") if k in meta}

    def _session_summary(self, session: MemberGuidedFlowSession, definition: GuidedFlowDefinition) -> dict:
        return {
            "id": str(session.id), "status": session.status, "flow_version": session.flow_version, "current_node": session.current_node,
            "section_title": definition.section_title(session.current_node) if session.current_node in definition.nodes else "",
            "steps_taken": len(session.answers.get("history", [])), "started_at": session.started_at.isoformat(),
            "updated_at": session.updated_at.isoformat(), "completed_at": session.completed_at.isoformat() if session.completed_at else None,
        }

    def _open_session(self, principal: CurrentPrincipal, key: str) -> MemberGuidedFlowSession:
        self._require_member(principal)
        session = self.latest_session(principal, key)
        if session is None or session.status in (SESSION_COMPLETED, SESSION_SKIPPED):
            raise GuidedFlowError(409, "Start the guided experience first.")
        if session.status == SESSION_PAUSED:
            session.status = SESSION_IN_PROGRESS
        return session

    @staticmethod
    def _require_member(principal: CurrentPrincipal) -> None:
        if not principal.is_member or principal.member_id is None:
            raise GuidedFlowError(403, "Guided experiences are for Veye members.")


# ---- shared helpers -------------------------------------------------------------------------
def db_active(db: Session, key: str) -> GuidedFlow | None:
    return db.query(GuidedFlow).filter(GuidedFlow.key == key, GuidedFlow.status == STATUS_ACTIVE).one_or_none()


def activate_flow(db: Session, flow: GuidedFlow, *, by: str) -> GuidedFlow:
    """Draft -> Active; the previously Active version of the same key becomes
    Archived. Sessions already running on it are untouched (pinned)."""
    if flow.status == STATUS_ARCHIVED:
        raise GuidedFlowError(409, "An archived version cannot be activated; publish a new version instead.")
    GuidedFlowDefinition(flow.definition, known_flow_keys=BUILTIN_KEYS).validate()
    for other in db.query(GuidedFlow).filter(GuidedFlow.key == flow.key, GuidedFlow.status == STATUS_ACTIVE, GuidedFlow.id != flow.id).all():
        other.status = STATUS_ARCHIVED
    flow.status = STATUS_ACTIVE
    flow.published_at = _now()
    flow.published_by = by
    db.flush()
    return flow


def deactivate_flow(db: Session, flow: GuidedFlow) -> GuidedFlow:
    """Active -> Draft: members can no longer start it; running sessions keep their pinned version."""
    if flow.status != STATUS_ACTIVE:
        raise GuidedFlowError(409, "Only an Active version can be deactivated.")
    flow.status = STATUS_DRAFT
    db.flush()
    return flow
