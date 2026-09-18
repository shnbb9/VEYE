"""Companion settings: the one row the admin Settings screen edits, seeded
with the approved prototype wording (member welcome copy from the consumer
prototype; safe/fallback/topic wording from the admin prototype)."""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.companion.models import CompanionSettings
from app.companion.policy import default_policy

DEFAULT_WELCOME = (
    "Welcome to the Veye program — I look forward to working with you. How would you like to begin? "
    "I can start with the why to — the reasons behind the program and its basics — or go straight to the how to and begin meal planning."
)
DEFAULT_RETURNING_WELCOME = "Welcome back — I'm Sprout, your Veye companion. What would you like to work on today?"
DEFAULT_SAFE_RESPONSE = (
    "I can share what your plan already says, but anything about an amount or a medical question needs your coach to confirm."
)
DEFAULT_FALLBACK = "That is outside what I can help with, but your coach can pick it up. Would you like me to pass it on?"
DEFAULT_ESCALATION = (
    "Thank you for telling me. This is something a person from the Veye team should pick up with you, "
    "so I have handed this conversation to them and they will follow up."
)
DEFAULT_QUICK_PROMPTS = [
    {"id": "QP-1", "label": "\U0001F37D️ What should I eat?", "prompt": "What should I eat for lunch today?", "active": True},
    {"id": "QP-2", "label": "\U0001F613 I'm feeling stressed", "prompt": "I'm feeling a bit stressed today.", "active": True},
    {"id": "QP-3", "label": "\U0001F4CA My progress this month", "prompt": "How is my health progress this month?", "active": True},
    {"id": "QP-4", "label": "\U0001F34E Suggest a snack", "prompt": "Can you suggest a low-glycemic snack?", "active": True},
    {"id": "QP-5", "label": "\U0001F634 I'm tired today", "prompt": "I'm tired today, what should I do?", "active": True},
]


def get_or_create_settings(db: Session) -> CompanionSettings:
    row = db.get(CompanionSettings, 1)
    if row is None:
        row = CompanionSettings(
            id=1, enabled=True, name="Sprout", welcome=DEFAULT_WELCOME, returning_welcome=DEFAULT_RETURNING_WELCOME,
            safe_response=DEFAULT_SAFE_RESPONSE, fallback=DEFAULT_FALLBACK, escalation_response=DEFAULT_ESCALATION,
            quick_prompts=DEFAULT_QUICK_PROMPTS, policy=default_policy(),
        )
        db.add(row)
        db.flush()
    return row
