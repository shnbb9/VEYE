from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.auth.principal import CurrentPrincipal, require_member, resolve_member_route
from app.db.session import get_db
from app.progress.simple_quiz.models import SimpleQuizAttempt
from app.progress.simple_quiz.repository import record_simple_quiz_attempt, simple_quiz_history as load_history
from app.progress.simple_quiz.schemas import (
    SimpleQuizDefinition,
    SimpleQuizHistoryItem,
    SimpleQuizHistoryResponse,
    SimpleQuizRequest,
    SimpleQuizResult,
)
from app.progress.simple_quiz.service import PROGRESS_NOTE, QUESTIONS, SIMPLE_QUIZ_CALCULATION_VERSION, TOTAL_QUESTIONS

router = APIRouter(prefix="/api/v1/simple-quiz", tags=["simple-quiz"])
member_router = APIRouter(prefix="/api/v1/members", tags=["members"])


def history_item(attempt: SimpleQuizAttempt) -> SimpleQuizHistoryItem:
    return SimpleQuizHistoryItem(
        attempt_id=attempt.id, answers=attempt.answers, yes_count=attempt.yes_count, no_count=attempt.no_count,
        summary=f"{attempt.no_count} No / {attempt.yes_count} Yes", progress_note=PROGRESS_NOTE,
        calculation_version=attempt.calculation_version, completed_at=attempt.completed_at,
    )


@router.get("/definition", response_model=SimpleQuizDefinition)
def definition(principal: CurrentPrincipal = Depends(require_member)) -> SimpleQuizDefinition:
    return SimpleQuizDefinition(
        questions=[{"key": key, "label": label} for key, label in QUESTIONS], total_questions=TOTAL_QUESTIONS,
        progress_note=PROGRESS_NOTE, calculation_version=SIMPLE_QUIZ_CALCULATION_VERSION,
    )


@router.post("/calculate", response_model=SimpleQuizResult, status_code=201)
def calculate(
    payload: SimpleQuizRequest, principal: CurrentPrincipal = Depends(require_member), db: Session = Depends(get_db)
) -> SimpleQuizResult:
    attempt = record_simple_quiz_attempt(db, principal.member_id, payload.input)
    db.commit()
    db.refresh(attempt)
    return SimpleQuizResult(member_id=principal.member_id, **history_item(attempt).model_dump())


@member_router.get("/{member_ref}/simple-quiz", response_model=SimpleQuizHistoryResponse)
def simple_quiz_history(
    member_ref: str, principal: CurrentPrincipal = Depends(require_member), db: Session = Depends(get_db)
) -> SimpleQuizHistoryResponse:
    member_id = resolve_member_route(member_ref, principal)
    history = [history_item(attempt) for attempt in load_history(db, member_id)]
    return SimpleQuizHistoryResponse(member_id=member_id, latest=history[0] if history else None, history=history)
