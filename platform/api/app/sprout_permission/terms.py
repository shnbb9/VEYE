"""What a member reads before switching Sprout personalization on.

Constants, not console settings: every sentence is a promise the code keeps,
so changing one is a code change with a new version. Bump TERMS_VERSION and
POLICY_VERSION together; the hash covers all of the words.

ENGINEERING DRAFT, pending Cara's and counsel's approval. None of it says
"HIPAA" or "authorization": no counsel has approved those terms.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.policies.service import content_hash

TERMS_VERSION = 1
POLICY_VERSION = "sprout-personalization-2026-11-25-v1"

TITLE = "Personalize Sprout using my health information"
PURPOSE = "So Sprout can answer you about your own progress and write your Personal tip."
RECIPIENT = "Sprout, inside Veye. Not the Veye team."
# One line per summary `companion/context.py` can build, and nothing else.
INFORMATION = (
    "Health Number: your latest result, its range, and whether it went up or down",
    "Body composition: your latest BMI and body fat",
    "Blood markers: which ones are in range",
    "Moods: how often you logged each one, your Balance score and your streak",
    "Food diary and meal plans: how often you log and plan",
)
NEVER = ("From your records, Sprout never gets your notes, what you ate, your photos, exact dates, your name or "
         "your contact details.")
SEPARATE = ("This is separate from sharing with the Veye team. It does not let the team see your health information. "
            "If you don't share with the team, answers Sprout writes from it are hidden from them too.")
OUTSIDE_AI = ("This does not let an outside AI company process your health information. That would need a separate "
              "approval from you.")
WITHDRAWAL = ("You can turn this off here at any time. From your next message, Sprout answers without your health "
              "information, and your Personal tip is removed. What Sprout already told you stays in your conversation.")
WITHOUT = "If you leave this off, Sprout still answers about Veye, food and the app, without your health information."
EXPIRY_RULE = "Until you turn it off."

# The promise in OUTSIDE_AI, as a fact the code asks about. While this is
# False a real member's health information is never put in a prompt that
# leaves Veye, whatever any provider's configuration says.
COVERS_OUTSIDE_AI = False


@dataclass(frozen=True)
class SproutTerms:
    version: int
    label: str
    hash: str

    def snapshot(self) -> dict:
        return {"scope": list(INFORMATION), "purpose": PURPOSE, "recipient": RECIPIENT, "expiry_rule": EXPIRY_RULE}

    def as_dict(self) -> dict:
        return {"version": self.version, "label": self.label, "hash": self.hash, "title": TITLE, "purpose": PURPOSE,
                "recipient": RECIPIENT, "information": list(INFORMATION), "never": NEVER, "separate": SEPARATE,
                "outside_ai": OUTSIDE_AI, "withdrawal": WITHDRAWAL, "without": WITHOUT, "expiry_rule": EXPIRY_RULE}


def current_terms() -> SproutTerms:
    return SproutTerms(version=TERMS_VERSION, label=POLICY_VERSION, hash=content_hash({
        "title": TITLE, "purpose": PURPOSE, "recipient": RECIPIENT, "information": list(INFORMATION), "never": NEVER,
        "separate": SEPARATE, "outside_ai": OUTSIDE_AI, "withdrawal": WITHDRAWAL, "without": WITHOUT,
        "expiry_rule": EXPIRY_RULE}))
