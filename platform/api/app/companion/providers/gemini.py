"""Gemini on Google Cloud: the selected production language model.

Two decisions shape this file more than the API call does.

**Vertex AI, not AI Studio.** A personal `GEMINI_API_KEY` is a developer
convenience and not an architecture: it belongs to a person, it is not covered
by an agreement, and it cannot be rotated or audited like a service identity.
Production addresses Gemini through Vertex AI on a named project and location,
authenticating with Application Default Credentials so the running service's
own identity is what Google sees. An API key is accepted only for local
experimentation, is refused outright in production, and never carries member
data (see below).

**Member data does not go to a live model by accident.** Sending a member's
health summaries to an external service is a disclosure, and whether it is a
permitted one is a legal question about the BAA and covered services that
nobody has answered yet. So this provider refuses any prompt carrying the
member-context section unless a deployment has explicitly declared that
clearance. The refusal is a hard failure, not a silent strip: a prompt quietly
emptied of its context would produce a confident answer about nothing.

Nothing here is reached while `VEYE_LLM_PROVIDER` is `mock`, which is the
default and what every test and local run uses.
"""

from __future__ import annotations

import logging
import time

from app.companion.providers.llm import LLMRequest, LLMResponse, ProviderNotConfigured

log = logging.getLogger("veye.companion.gemini")

# The header the prompt builder puts above a member's summaries. Its presence
# is what makes a request PHI-bearing.
MEMBER_CONTEXT_MARKER = "## MEMBER CONTEXT"

DEFAULT_MODEL = "gemini-2.0-flash"
DEFAULT_LOCATION = "us-central1"


class MemberDataNotCleared(ProviderNotConfigured):
    """Raised when a prompt carrying member context would reach a live model
    that has not been cleared for it."""


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
    """Vertex AI Gemini. Imported lazily so the SDK stays an optional extra."""

    name = "gemini"

    def __init__(self, *, project: str, location: str, model: str, timeout_seconds: float = 30.0,
                 member_data_cleared: bool = False, api_key: str | None = None,
                 production: bool = False, client=None) -> None:
        self.model = model or DEFAULT_MODEL
        self.location = location or DEFAULT_LOCATION
        self.project = project
        self.member_data_cleared = bool(member_data_cleared)
        self.timeout_seconds = timeout_seconds
        self._api_key = api_key or None
        self._client = client

        if self._api_key and production:
            raise ProviderNotConfigured(
                "An API key is a developer convenience, not a production identity. "
                "Production uses Vertex AI with VEYE_GCP_PROJECT and Application Default Credentials.")
        if not self._api_key and not project:
            raise ProviderNotConfigured("VEYE_GCP_PROJECT is required for the Gemini provider on Vertex AI.")
        if self._api_key and self.member_data_cleared:
            raise ProviderNotConfigured(
                "Member data is never sent through a personal API key. Use Vertex AI with a service "
                "identity, or leave VEYE_GEMINI_MEMBER_DATA_CLEARED off.")

    # ---- the SDK --------------------------------------------------------------
    def _ensure_client(self):
        if self._client is not None:
            return self._client
        try:  # pragma: no cover - depends on the optional extra
            from google import genai
        except ImportError as exc:  # pragma: no cover
            raise ProviderNotConfigured(
                "The 'google-genai' package is not installed (pip install 'veye-api[gemini]').") from exc
        if self._api_key:  # local experimentation only
            self._client = genai.Client(api_key=self._api_key)
        else:
            # Application Default Credentials: the service's own identity, no
            # long-lived key file anywhere near the repository.
            self._client = genai.Client(vertexai=True, project=self.project, location=self.location)
        return self._client

    # ---- completion -----------------------------------------------------------
    def complete(self, request: LLMRequest) -> LLMResponse:
        if carries_member_data(request) and not self.member_data_cleared:
            # A hard failure, never a quiet strip. An answer confidently built
            # from a prompt whose context was silently removed is worse than no
            # answer at all.
            raise MemberDataNotCleared(
                "This prompt carries member health context and this deployment has not been cleared to send it "
                "to Gemini. Confirm the BAA and the covered-service configuration, then set "
                "VEYE_GEMINI_MEMBER_DATA_CLEARED=true.")

        client = self._ensure_client()
        started = time.perf_counter()
        contents = [{"role": "user" if m.role == "user" else "model", "parts": [{"text": m.content}]}
                    for m in request.messages]
        config = {
            "system_instruction": request.system,
            "max_output_tokens": request.max_tokens,
            "temperature": request.temperature,
            # No public web grounding. Sprout answers from approved Veye
            # knowledge and the member's own summaries, and a model that can
            # reach the open web is answering from something else.
            "tools": [],
        }
        response = client.models.generate_content(model=self.model, contents=contents, config=config)
        usage = getattr(response, "usage_metadata", None)
        return LLMResponse(
            text=(getattr(response, "text", "") or "").strip(),
            provider=self.name, model=self.model,
            input_tokens=getattr(usage, "prompt_token_count", None),
            output_tokens=getattr(usage, "candidates_token_count", None),
            latency_ms=int((time.perf_counter() - started) * 1000),
            finish_reason=_finish_reason(response),
        )

    def describe(self) -> dict[str, object]:
        return {
            "provider": self.name,
            "model": self.model,
            "configured": True,
            "external": True,
            "auth": "api-key (development only)" if self._api_key else "application default credentials",
            "project": self.project or "(api key)",
            "location": self.location,
            "member_data_cleared": self.member_data_cleared,
            "web_grounding": "off",
        }


def _finish_reason(response) -> str | None:
    candidates = getattr(response, "candidates", None) or []
    if not candidates:
        return None
    reason = getattr(candidates[0], "finish_reason", None)
    return str(reason) if reason is not None else None
