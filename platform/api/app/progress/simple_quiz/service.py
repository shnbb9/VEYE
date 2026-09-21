"""Simple Quiz — the deterministic domain calculation.

Source of truth: `Simple Quiz.docx` via the approved consumer engine
(`build/js/veye-calculations.js`, `VeyeCalculations.simpleQuiz`) and the
approved screen (`build/dashboard.html`, SIMPLE_QUIZ_QUESTIONS).

The source defines ONLY: 8 yes/no questions, count Yes vs No, store by date,
let the member revisit a day, and "progress is an improvement in the number
of yes answers". It defines NO health-status tiers and NO supplement dosage,
so none are produced here.

PRODUCT RULE: the Simple Quiz is a separate tracker. It never creates,
updates or recalculates a Health Number — nothing in this package touches
the Health Number tables, and a test proves a completed quiz leaves the
Health Number history untouched."""

from __future__ import annotations

from dataclasses import dataclass

SIMPLE_QUIZ_CALCULATION_VERSION = "simple-quiz-2026-08-20-v1"

QUESTIONS: tuple[tuple[str, str], ...] = (
    ("sleepy_after_meals", "Are you sleepy after meals?"),
    ("need_coffee", "Do you need coffee during the day?"),
    ("crave_sweets", "Do you crave sweets?"),
    ("overweight_10lbs", "Are you more than 10 lbs overweight?"),
    ("exercise_no_tone", "Do you exercise but lack good muscle tone or consistent fat loss?"),
    ("chronic_disease", "Do you need to manage a chronic disease?"),
    ("lose_focus", "Do you lose focus throughout the day?"),
    ("painful_arthritis", "Do you suffer from painful arthritis?"),
)
QUESTION_KEYS: tuple[str, ...] = tuple(key for key, _ in QUESTIONS)
TOTAL_QUESTIONS = len(QUESTIONS)
ANSWER_VALUES = ("yes", "no")
PROGRESS_NOTE = "Fewer Yes answers over time indicates improvement."


@dataclass(frozen=True)
class SimpleQuizResult:
    answers: dict[str, str]
    yes_count: int
    no_count: int
    summary: str
    progress_note: str


def calculate_simple_quiz(answers: dict[str, str]) -> SimpleQuizResult:
    missing = [key for key in QUESTION_KEYS if key not in answers]
    extra = [key for key in answers if key not in QUESTION_KEYS]
    if missing or extra:
        raise ValueError(f"answers must cover exactly the 8 questions (missing {missing}, unknown {extra})")
    ordered = {}
    for key in QUESTION_KEYS:
        value = str(answers[key]).strip().lower()
        if value not in ANSWER_VALUES:
            raise ValueError(f"{key}: each answer is yes or no")
        ordered[key] = value
    yes = sum(1 for value in ordered.values() if value == "yes")
    no = TOTAL_QUESTIONS - yes
    return SimpleQuizResult(answers=ordered, yes_count=yes, no_count=no, summary=f"{no} No / {yes} Yes",
                            progress_note=PROGRESS_NOTE)
