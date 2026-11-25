"""Gemini: the one adapter, whichever of Google's doors it goes through.

`google_backend` decides the door and who is knocking. Everything here is the
same for both: what may be in a prompt, what is asked of the model, and what is
done with what comes back. Three decisions shape it more than the API call.

**Vertex AI in a deployment, the developer key on a laptop.** A personal API
key belongs to a person, is covered by no agreement, and cannot be rotated or
audited like a service identity; what is sent with one on Google's free tier
may be read by people and used to train. So it is refused outside local
development, it never carries a real member's data whatever else is configured,
and it never carries text from the client's own documents.

**Member data does not go to a live model by accident.** Sending a member's
health summaries to an external service is a disclosure, and whether it is a
permitted one is a legal question about the BAA and covered services. So on
Vertex AI too a real member's prompt is refused unless a deployment has
explicitly declared that clearance. The refusal is a hard failure, not a silent
strip: a prompt quietly emptied of its context would produce a confident answer
about nothing.

**The answer needs room to think.** Google counts the model's own reasoning
against `max_output_tokens`, and stops dead when it is reached. A limit set for
the length of an answer, which is what LLMRequest carries, comes back as half a
sentence or as nothing at all.

Nothing here is reached while `VEYE_LLM_PROVIDER` is `mock`, which is the
default and what every test and local run uses.
"""

from __future__ import annotations

import time
from dataclasses import replace

from app.companion.providers.google_backend import CutShort, Refused, choose_backend
from app.companion.providers.llm import (
    ClientContentNotAllowed,
    DataClassification,
    LLMRequest,
    LLMResponse,
    MemberDataNotCleared,
    carries_client_content,
)

__all__ = ["DEFAULT_LOCATION", "DEFAULT_MODEL", "GeminiLLMProvider", "MemberDataNotCleared", "carries_member_data"]

# The header the prompt builder puts above a member's summaries. Its presence
# is what makes a request PHI-bearing.
MEMBER_CONTEXT_MARKER = "## MEMBER CONTEXT"

# Checked against Google's own documentation on 25 Nov 2026. gemini-3.8-flash
# is stable on both doors (released 2 Sep 2026, no shutdown announced).
# gemini-2.0-flash, which this provider once defaulted to, was retired on
# 1 June 2026 — the default was a model that no longer existed.
DEFAULT_MODEL = "gemini-3.8-flash"

# `us` rather than `global` because this deployment is intended to carry health
# information for people in the United States, and a multi-region keeps
# processing inside that boundary where `global` does not promise to. Change it
# only with a reason, and only to a place google_backend.GENERATES_FROM lists.
DEFAULT_LOCATION = "us"

# What the model may spend thinking, on top of what the answer may come to.
THINKING_ROOM = 2048


def carries_member_data(request: LLMRequest) -> bool:
    """Whether this prompt contains a member's own summaries.

    Deliberately looks at the prompt rather than trusting a caller-supplied
    flag: a new caller that forgets to set the flag would otherwise get the
    permissive answer, which is the wrong way round for this decision.
    """
    if MEMBER_CONTEXT_MARKER in (request.system or ""):
        section = request.system.split(MEMBER_CONTEXT_MARKER, 1)[1].strip()
        # The section exists but every line may be "not available", which
        # carries nothing about the member.
        meaningful = [line for line in section.splitlines()
                      if line.strip() and "not available" not in line]
        return bool(meaningful)
    return False


class GeminiLLMProvider:
    name = "gemini"

    def __init__(self, *, backend: str, project: str = "", location: str = "", model: str = "", api_key: str | None = None,
                 member_data_cleared: bool = False, local: bool = False, timeout_seconds: float = 30.0, **extra) -> None:
        self.model = model or DEFAULT_MODEL
        self.member_data_cleared = bool(member_data_cleared)
        self.backend = choose_backend(
            backend, model=self.model, project=project, location=location or DEFAULT_LOCATION, api_key=api_key, local=local,
            member_data_cleared=self.member_data_cleared, timeout_seconds=timeout_seconds, **extra)

    # ---- completion -----------------------------------------------------------
    def complete(self, request: LLMRequest) -> LLMResponse:
        # 1. Whose data is this? Decided when the request was built, from
        #    server state. Not inferred from the prompt's text, because the
        #    Personal Tip carries a member's summaries in the user message
        #    under no heading and a member's own question can carry health
        #    information a context block never mentions.
        if request.carries_real_member_data:
            if self.backend.is_developer:
                # A developer credential never carries a real person's data, no
                # matter what else is configured.
                raise MemberDataNotCleared(
                    "This prompt carries a real member's data and this deployment is using a developer API key. "
                    "Real member data goes only through Vertex AI with the service's own identity.")
            if not self.member_data_cleared:
                # A hard failure, never a quiet strip. An answer confidently built
                # from a prompt whose context was silently removed is worse than no
                # answer at all.
                raise MemberDataNotCleared(
                    "This prompt carries a real member's data and this deployment has not been cleared to send it "
                    "to Gemini. Confirm the BAA and the covered-service configuration, then set "
                    "VEYE_GEMINI_MEMBER_DATA_CLEARED=true.")

        # 2. Belt and braces. If the prompt visibly contains member context but
        #    the caller classified it as general, something is wrong with the
        #    caller, and the safe reading of a contradiction is the strict one.
        if carries_member_data(request) and request.classification is DataClassification.GENERAL:
            raise MemberDataNotCleared(
                "This prompt contains member context but was classified as general. "
                "Classify it from the principal that built it.")

        # 3. Whose words are the passages? On the developer's key, only
        #    synthetic documents.
        if self.backend.is_developer and carries_client_content(request):
            raise ClientContentNotAllowed(
                "This prompt carries passages from documents that are not marked synthetic, and this deployment is using "
                "a developer API key. The client's own documents go only through Vertex AI.")

        started = time.perf_counter()
        contents = [{"role": "user" if m.role == "user" else "model", "parts": [{"text": m.content}]}
                    for m in request.messages]
        response, attempts = self.backend.call(lambda client, timeout_ms: client.models.generate_content(
            model=self.model, contents=contents, config=self._config(request, timeout_ms)))
        usage = getattr(response, "usage_metadata", None)
        thinking = getattr(usage, "thoughts_token_count", None)
        written = getattr(usage, "candidates_token_count", None)
        read = getattr(usage, "prompt_token_count", None)
        output = None if written is None and thinking is None else (written or 0) + (thinking or 0)
        # Counted before anything is made of the answer: an answer that was cut
        # short was paid for too.
        cost = self.backend.spent(read, output)
        text = (getattr(response, "text", None) or "").strip()
        reason = _finish_reason(response)
        answer = LLMResponse(
            text=text, provider=self.name, model=self.model, input_tokens=read, output_tokens=output,
            latency_ms=int((time.perf_counter() - started) * 1000), finish_reason=reason,
            backend=self.backend.kind, thinking_tokens=thinking, attempts=attempts, estimated_cost_usd=cost,
        )
        failure = None
        if reason == "MAX_TOKENS":
            failure = CutShort(f"{self.model} reached its limit before it had finished.")
        elif not text or reason not in (None, "STOP", "FINISH_REASON_UNSPECIFIED"):
            # A word of Google's own, and nothing of what was asked.
            failure = Refused(f"{self.model} gave no answer ({_blocked(response) or reason or 'nothing came back'}).")
        if failure is not None:
            failure.spent = replace(answer, text="")
            raise failure
        return answer

    def _config(self, request: LLMRequest, timeout_ms: int) -> dict:
        # Deliberately NOT sent:
        #   temperature / top_p / top_k — "ignored by the backend" on this model
        #     generation, and the migration guide says to remove them. The other
        #     providers still use request.temperature, so it stays on LLMRequest.
        #   thinking_level — MEDIUM is the documented default and nothing here
        #     needs to move it. (MINIMAL is rejected outright by the API.)
        #   frequency_penalty / presence_penalty / candidate_count — these do
        #     throw an API error, so they must never be added casually.
        return {
            "system_instruction": request.system,
            "max_output_tokens": request.max_tokens + THINKING_ROOM,
            # No public web grounding. Sprout answers from approved Veye
            # knowledge and the member's own summaries, and a model that can
            # reach the open web is answering from something else.
            "tools": [],
            # One answer is one request: the SDK would otherwise follow on by
            # itself, where nothing here counts it.
            "automatic_function_calling": {"disable": True},
            "automatic_continuation": False,
            "http_options": {"timeout": timeout_ms},
        }

    def describe(self) -> dict[str, object]:
        return {
            "provider": self.name, "model": self.model, "configured": True, "external": True,
            **self.backend.describe(),
            "member_data_cleared": self.member_data_cleared,
            "accepts": "general, synthetic_member" + (", real_member" if self.member_data_cleared else ""),
            "web_grounding": "off",
        }


def _word(value) -> str | None:
    """An enumeration of Google's as its own word, and nothing else."""
    return None if value is None else str(getattr(value, "value", value))[:60]


def _finish_reason(response) -> str | None:
    candidates = getattr(response, "candidates", None) or []
    return _word(getattr(candidates[0], "finish_reason", None)) if candidates else None


def _blocked(response) -> str | None:
    return _word(getattr(getattr(response, "prompt_feedback", None), "block_reason", None))
