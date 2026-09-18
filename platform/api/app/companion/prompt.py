"""PromptBuilder: turns policy decision + approved passages + filtered member
context + recent turns into an LLMRequest. Section headings are fixed so the
mock provider and tests can read them back."""

from __future__ import annotations

from app.companion.context import MemberContext
from app.companion.personalization import MEMBER_FIRST_NAME_TOKEN
from app.companion.policy import PolicyDecision
from app.companion.providers.llm import LLMMessage, LLMRequest
from app.knowledge.service import RetrievedChunk

ROLE = (
    "You are Sprout, the Veye Companion. Veye is a food-as-medicine health program. "
    "You help members think through meals and food choices, understand how the Veye assessments work, "
    "and reflect on their own progress. You are warm, concise and practical."
)

RULES = (
    "- Answer only from the APPROVED KNOWLEDGE passages and the MEMBER CONTEXT below. If they do not cover the question, say so and suggest the relevant part of the Veye dashboard instead of guessing.\n"
    "- Never diagnose, treat or prevent a condition, and never state or suggest an amount, dose or schedule for any supplement or medicine.\n"
    f"- Address the member only as {MEMBER_FIRST_NAME_TOKEN} (exactly that token). You do not know their name, email or contact details and must not ask for them.\n"
    "- Do not invent numbers. Only mention results that appear in MEMBER CONTEXT, and remind the member that a lower Health Number is better.\n"
    "- Keep replies under 120 words, plain language, no markdown headings, no citations inline."
)


class PromptBuilder:
    def __init__(self, *, companion_name: str = "Sprout", max_history: int = 6) -> None:
        self.companion_name = companion_name
        self.max_history = max_history

    def build(self, *, decision: PolicyDecision, passages: list[RetrievedChunk], context: MemberContext,
              history: list[tuple[str, str]], message: str) -> LLMRequest:
        knowledge_lines: list[str] = []
        for index, chunk in enumerate(passages, start=1):
            heading = f" — {chunk.heading}" if chunk.heading else ""
            knowledge_lines.append(f"[Source {index}: {chunk.source_title} v{chunk.source_version}{heading}]")
            knowledge_lines.append(chunk.text.strip())
            knowledge_lines.append("")
        knowledge = "\n".join(knowledge_lines).strip() or "(none retrieved for this topic)"
        context_lines = context.lines() or ["(no member context permitted for this topic)"]

        system = (
            f"## ROLE\n{ROLE.replace('Sprout', self.companion_name)}\n\n"
            f"## RULES\n{RULES}\n\n"
            f"## TOPIC\n{decision.category or 'general'} (policy {decision.policy_version})\n\n"
            f"## APPROVED KNOWLEDGE\n{knowledge}\n\n"
            f"## MEMBER CONTEXT\n" + "\n".join(context_lines) + "\n"
        )
        messages: list[LLMMessage] = []
        for role, content in history[-self.max_history:]:
            messages.append(LLMMessage(role="assistant" if role == "sprout" else "user", content=content))
        messages.append(LLMMessage(role="user", content=message))
        return LLMRequest(system=system, messages=tuple(messages), metadata={"topic": decision.category or "general",
                                                                            "policy_version": decision.policy_version})
