"""Companion policy gate.

Deterministic and configurable: the topic and prohibition rules live in the
`companion_settings.policy` JSON that the admin Settings screen edits. No
model is involved in the decision. The default stance for anything not
explicitly allowed is to not answer (off-topic fallback), and sensitive
categories hand the conversation to a person."""

from __future__ import annotations

import re
from dataclasses import dataclass, field

POLICY_VERSION = "1.0.0"

OUTCOME_ALLOW = "allow"
OUTCOME_PROHIBIT = "prohibit"
OUTCOME_ESCALATE = "escalate"
OUTCOME_OFF_TOPIC = "off_topic"

MEMBER_DATA_SCOPES = (
    "health_number_summary",
    "body_composition_summary",
    "blood_marker_summary",
    "mood_summary",
    "food_pattern_summary",
)


def default_policy() -> dict:
    """The approved admin-prototype topic list, expressed as rules."""
    return {
        "version": POLICY_VERSION,
        "topics": [
            {"key": "food", "label": "Food choices and meals", "allowed": True,
             "keywords": ["eat", "meal", "food", "snack", "lunch", "dinner", "breakfast", "recipe", "cook", "protein",
                          "carb", "carbohydrate", "fat", "hungry", "portion", "favorable", "unfavorable", "vegetable", "fruit",
                          "glycemic", "salmon", "shopping"],
             "retrieval_scopes": ["food_choices", "help"], "member_data_scopes": ["food_pattern_summary"]},
            {"key": "plan_diary", "label": "The member's own plan and diary", "allowed": True,
             "keywords": ["diary", "plan", "log", "week", "my day", "meal planning", "entries", "routine"],
             "retrieval_scopes": ["help"], "member_data_scopes": ["food_pattern_summary", "mood_summary"]},
            {"key": "assessments", "label": "How Veye assessments work", "allowed": True,
             "keywords": ["health number", "assessment", "score", "body composition", "body fat", "bmi", "blood", "marker",
                          "tg/hdl", "homa", "hba1c", "aa/epa", "progress", "result", "re-take", "retake", "quiz", "lower is better"],
             "retrieval_scopes": ["health_number", "assessments", "help"],
             "member_data_scopes": ["health_number_summary", "body_composition_summary", "blood_marker_summary"]},
            {"key": "mood", "label": "Mood and daily check-ins", "allowed": True,
             "keywords": ["mood", "stress", "stressed", "tired", "energy", "sleep", "anxious", "feeling", "check-in", "calm", "focus"],
             "retrieval_scopes": ["help", "companion"], "member_data_scopes": ["mood_summary"]},
            {"key": "using_veye", "label": "Using Veye", "allowed": True,
             "keywords": ["veye", "sprout", "companion", "dashboard", "sign in", "password", "account", "subscription",
                          "how do i", "where do i", "what can you"],
             "retrieval_scopes": ["help", "companion"], "member_data_scopes": []},
        ],
        "prohibited": [
            {"key": "supplement_amounts", "label": "Supplement amounts", "action": OUTCOME_PROHIBIT,
             "keywords": ["how much", "how many", "dose", "dosage", "mg", "milligram", "grams of", "capsule", "iu", "should i take",
                          "magnesium at night", "take together"],
             "why": "Amounts are set by condition and confirmed by a coach."},
            {"key": "medical", "label": "Diagnosis, symptoms and medication", "action": OUTCOME_ESCALATE,
             "keywords": ["diagnos", "symptom", "medication", "medicine", "prescription", "pill", "drug", "chest pain", "bleeding",
                          "infection", "doctor said", "disease", "injection", "metformin", "statin", "pregnan"],
             "why": "Always handed to a person."},
            {"key": "wellbeing_concern", "label": "Sustained difficulty or distress", "action": OUTCOME_ESCALATE,
             "keywords": ["can't go on", "cant go on", "nothing is working", "hopeless", "hurt myself", "self-harm", "suicid",
                          "give up", "haven't slept properly in a week", "not slept properly in a week"],
             "why": "Policy is to hand this to a person."},
        ],
        "member_data_scopes_enabled": list(MEMBER_DATA_SCOPES),
        "escalation_categories": ["medical", "wellbeing_concern"],
    }


@dataclass(frozen=True)
class PolicyDecision:
    outcome: str
    category: str | None
    matched_rule: str | None
    reason: str
    retrieval_scopes: tuple[str, ...] = ()
    member_data_scopes: tuple[str, ...] = ()
    policy_version: str = POLICY_VERSION
    hits: dict[str, int] = field(default_factory=dict)

    @property
    def allowed(self) -> bool:
        return self.outcome == OUTCOME_ALLOW


def _matches(text: str, keyword: str) -> bool:
    keyword = keyword.lower().strip()
    if not keyword:
        return False
    if re.fullmatch(r"[a-z0-9]+", keyword):
        return re.search(rf"(?<![a-z0-9]){re.escape(keyword)}(?![a-z0-9])", text) is not None
    if keyword.endswith("*"):
        return keyword[:-1] in text
    return keyword in text


class PolicyEngine:
    def __init__(self, policy: dict | None = None) -> None:
        self.policy = policy or default_policy()
        self.version = str(self.policy.get("version") or POLICY_VERSION)

    def evaluate(self, message: str) -> PolicyDecision:
        text = " ".join(message.lower().split())
        if not text:
            return PolicyDecision(OUTCOME_OFF_TOPIC, None, None, "Empty message.", policy_version=self.version)

        # Sensitive categories first: escalation wins over prohibition, both win over any allowed topic.
        matched: list[tuple[dict, str]] = []
        for rule in self.policy.get("prohibited", []):
            for keyword in rule.get("keywords", []):
                if _matches(text, keyword):
                    matched.append((rule, keyword))
                    break
        escalations = [m for m in matched if m[0].get("action") == OUTCOME_ESCALATE]
        if escalations:
            rule, keyword = escalations[0]
            return PolicyDecision(OUTCOME_ESCALATE, rule["key"], keyword, rule.get("why", "Handed to a person."), policy_version=self.version)
        if matched:
            rule, keyword = matched[0]
            return PolicyDecision(OUTCOME_PROHIBIT, rule["key"], keyword, rule.get("why", "Not answered by Sprout."), policy_version=self.version)

        enabled_scopes = set(self.policy.get("member_data_scopes_enabled", MEMBER_DATA_SCOPES))
        best: tuple[int, dict, str] | None = None
        hits: dict[str, int] = {}
        for topic in self.policy.get("topics", []):
            count = 0
            first: str | None = None
            for keyword in topic.get("keywords", []):
                if _matches(text, keyword):
                    count += 1
                    first = first or keyword
            if count:
                hits[topic["key"]] = count
            if count and (best is None or count > best[0]):
                best = (count, topic, first or "")
        if best is None:
            return PolicyDecision(OUTCOME_OFF_TOPIC, None, None, "No allowed topic matched.", policy_version=self.version, hits=hits)
        count, topic, keyword = best
        if not topic.get("allowed", True):
            return PolicyDecision(OUTCOME_PROHIBIT, topic["key"], keyword, topic.get("why") or "This topic is switched off.",
                                  policy_version=self.version, hits=hits)
        scopes = tuple(s for s in topic.get("member_data_scopes", []) if s in enabled_scopes)
        return PolicyDecision(OUTCOME_ALLOW, topic["key"], keyword, f"Allowed topic '{topic['label']}'.",
                              retrieval_scopes=tuple(topic.get("retrieval_scopes", [])), member_data_scopes=scopes,
                              policy_version=self.version, hits=hits)
