"""Free-text interpretation for guided-flow steps.

The flow state is server-authoritative: a member's typed reply can only ever
select one of the step's existing options. Interpretation is layered —

1. a deterministic lexicon (yes / no / option labels) that tests rely on;
2. optionally the configured LLMProvider, asked to pick one option key or say
   UNCLEAR, with its output validated against the allowed keys;
3. otherwise a clarification, and the step is repeated unchanged.

The mock provider used in tests and the default local stack never picks a
branch, so anything the lexicon cannot resolve asks for clarification."""

from __future__ import annotations

import re
from dataclasses import dataclass

from app.companion.providers.llm import LLMMessage, LLMProvider, LLMRequest

YES_WORDS = {
    "yes", "y", "yeah", "yep", "yup", "sure", "ok", "okay", "continue", "go on", "ready", "lets go", "let's go", "please",
    "absolutely", "of course", "sounds good", "im ready", "i'm ready", "yes please", "go ahead", "carry on", "next", "definitely",
}
NO_WORDS = {
    "no", "n", "nope", "not now", "later", "skip", "no thanks", "no thank you", "not yet", "maybe later", "not really",
    "no thanks.", "i'd rather not", "id rather not", "pass",
}
UNCLEAR = "UNCLEAR"


@dataclass(frozen=True)
class Interpretation:
    choice_key: str | None
    via: str  # lexicon | provider | unclear
    confidence: str = "high"


def _normalise(text: str) -> str:
    text = text.strip().lower()
    text = re.sub(r"[!.?,;:]+", " ", text)   # "yes, I know" -> "yes i know"
    text = re.sub(r"\s+", " ", text).strip()
    return text


def interpret(text: str, choices: list[dict], provider: LLMProvider | None = None) -> Interpretation:
    keys = [c["key"] for c in choices]
    if not keys:
        return Interpretation(None, "unclear")
    normalised = _normalise(text)
    if not normalised:
        return Interpretation(None, "unclear")

    # 1. lexicon: yes / no
    if "yes" in keys and "no" in keys:
        if normalised in YES_WORDS or normalised.startswith(("yes ", "yeah ", "sure ", "ok ", "okay ")):
            return Interpretation("yes", "lexicon")
        if normalised in NO_WORDS or normalised.startswith(("no ", "not ", "nope ")):
            return Interpretation("no", "lexicon")
    # 1b. lexicon: an option key (whole words only) or a distinctive word of exactly one label.
    #     yes / no are decided by the lexicon above alone — "not sure" must never read as "no".
    hits: list[str] = []
    words = set(re.findall(r"[a-z']+", normalised))
    for choice in choices:
        key = choice["key"].replace("_", " ")
        if normalised == key or normalised == _normalise(choice.get("label", "")):
            return Interpretation(choice["key"], "lexicon")
        if choice["key"] in ("yes", "no"):
            continue
        label_words = {w for w in re.findall(r"[a-z]+", choice.get("label", "").lower()) if len(w) > 3}
        label_words -= {"review", "these", "later", "them", "start", "your", "with", "that", "this", "right", "open", "again"}
        key_words = set(key.split())
        if (words & label_words) or (key_words and key_words <= words):
            hits.append(choice["key"])
    if len(set(hits)) == 1:
        return Interpretation(hits[0], "lexicon")

    # 2. provider classification, validated against the allowed keys
    if provider is not None and getattr(provider, "name", "mock") != "mock":
        options = "\n".join(f"- {c['key']}: {c.get('label', c['key'])}" for c in choices)
        request = LLMRequest(
            system=("You map a member's short reply to exactly one option key from a fixed list. "
                    "Reply with the key only. If the reply does not clearly pick one option, reply UNCLEAR. Never invent an option.\n"
                    f"Options:\n{options}"),
            messages=(LLMMessage(role="user", content=text.strip()[:300]),), max_tokens=12, temperature=0.0,
            metadata={"purpose": "guided_flow_choice"},
        )
        try:
            raw = provider.complete(request).text.strip()
            answer = raw.split()[0].strip(".,").lower() if raw else UNCLEAR
        except Exception:
            answer = UNCLEAR
        if answer in keys:
            return Interpretation(answer, "provider", confidence="high")
    return Interpretation(None, "unclear", confidence="low")
