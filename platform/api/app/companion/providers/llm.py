"""LLMProvider: the only way Sprout reaches a language model.

The provider receives an `LLMRequest` that the application has already
assembled (policy-gated, retrieval-backed, privacy-filtered). It never sees
the database, a member identifier or a raw record.

- MockLLMProvider: deterministic, offline. Used by tests and by the default
  local stack.
- GroqLLMProvider: development only, active only when a key is explicitly
  configured. Model identifier is configuration, never hard-coded.
"""

from __future__ import annotations

import re
import time
from dataclasses import dataclass, field
from typing import Protocol


@dataclass(frozen=True)
class LLMMessage:
    role: str  # system | user | assistant
    content: str


@dataclass(frozen=True)
class LLMRequest:
    system: str
    messages: tuple[LLMMessage, ...]
    max_tokens: int = 400
    temperature: float = 0.3
    metadata: dict[str, str] = field(default_factory=dict)

    def as_payload(self) -> dict:
        """The exact material that would leave the trust boundary."""
        return {
            "system": self.system,
            "messages": [{"role": m.role, "content": m.content} for m in self.messages],
            "max_tokens": self.max_tokens,
            "temperature": self.temperature,
            "metadata": dict(self.metadata),
        }


@dataclass(frozen=True)
class LLMResponse:
    text: str
    provider: str
    model: str
    input_tokens: int | None = None
    output_tokens: int | None = None
    latency_ms: int = 0
    finish_reason: str | None = None


class LLMProvider(Protocol):
    name: str
    model: str

    def complete(self, request: LLMRequest) -> LLMResponse: ...

    def describe(self) -> dict[str, object]: ...


class ProviderNotConfigured(RuntimeError):
    pass


class MockLLMProvider:
    """Deterministic stand-in. It composes an answer from the context it was
    handed — the retrieved passages and the structured summaries inside the
    request — and addresses the member through the personalization token,
    exactly as a real provider is instructed to."""

    name = "mock"
    model = "veye-mock-1"

    def __init__(self) -> None:
        self.requests: list[LLMRequest] = []

    @property
    def last_request(self) -> LLMRequest | None:
        return self.requests[-1] if self.requests else None

    def complete(self, request: LLMRequest) -> LLMResponse:
        started = time.perf_counter()
        self.requests.append(request)
        user_turn = next((m.content for m in reversed(request.messages) if m.role == "user"), "")
        passages = _section(request.system, "APPROVED KNOWLEDGE")
        context = _section(request.system, "MEMBER CONTEXT")
        parts = ["Hey {{MEMBER_FIRST_NAME}}, here is what I can share."]
        first_passage = _first_passage(passages)
        if first_passage:
            parts.append(first_passage)
        summary = _context_sentence(context)
        if summary:
            parts.append(summary)
        if not first_passage and not summary:
            parts.append("I do not have an approved Veye source for that yet, so I would rather not guess.")
        parts.append("Would you like to look at this together in My Progress?")
        text = " ".join(parts)
        latency = int((time.perf_counter() - started) * 1000)
        prompt_chars = len(request.system) + sum(len(m.content) for m in request.messages) + len(user_turn)
        return LLMResponse(text=text, provider=self.name, model=self.model, input_tokens=max(1, prompt_chars // 4),
                           output_tokens=max(1, len(text) // 4), latency_ms=latency, finish_reason="stop")

    def describe(self) -> dict[str, object]:
        return {"provider": self.name, "model": self.model, "configured": True, "external": False}


class GroqLLMProvider:
    """Development-only Groq adapter. Imported lazily so the package is optional."""

    name = "groq"

    def __init__(self, api_key: str, model: str, timeout_seconds: float = 30.0) -> None:
        if not api_key:
            raise ProviderNotConfigured("VEYE_GROQ_API_KEY is not set.")
        try:
            from groq import Groq
        except ImportError as exc:  # pragma: no cover - depends on optional extra
            raise ProviderNotConfigured("The 'groq' package is not installed (pip install 'veye-api[ai]').") from exc
        self.model = model
        self._client = Groq(api_key=api_key, timeout=timeout_seconds)

    def complete(self, request: LLMRequest) -> LLMResponse:
        started = time.perf_counter()
        messages = [{"role": "system", "content": request.system}]
        messages += [{"role": m.role, "content": m.content} for m in request.messages]
        completion = self._client.chat.completions.create(
            model=self.model, messages=messages, max_tokens=request.max_tokens, temperature=request.temperature,
        )
        choice = completion.choices[0]
        usage = getattr(completion, "usage", None)
        return LLMResponse(
            text=(choice.message.content or "").strip(), provider=self.name, model=getattr(completion, "model", self.model),
            input_tokens=getattr(usage, "prompt_tokens", None), output_tokens=getattr(usage, "completion_tokens", None),
            latency_ms=int((time.perf_counter() - started) * 1000), finish_reason=getattr(choice, "finish_reason", None),
        )

    def describe(self) -> dict[str, object]:
        return {"provider": self.name, "model": self.model, "configured": True, "external": True}


class UnconfiguredLLMProvider:
    """Explicit absence: the API boots, the Companion reports that no provider
    is available instead of inventing an answer."""

    name = "unconfigured"
    model = "none"

    def __init__(self, reason: str) -> None:
        self.reason = reason

    def complete(self, request: LLMRequest) -> LLMResponse:
        raise ProviderNotConfigured(self.reason)

    def describe(self) -> dict[str, object]:
        return {"provider": self.name, "model": None, "configured": False, "external": False, "reason": self.reason}


def build_llm_provider(kind: str, *, groq_api_key: str | None, groq_model: str, timeout_seconds: float) -> LLMProvider:
    if kind == "mock":
        return MockLLMProvider()
    if kind == "groq":
        try:
            return GroqLLMProvider(groq_api_key or "", groq_model, timeout_seconds)
        except ProviderNotConfigured as exc:
            return UnconfiguredLLMProvider(str(exc))
    return UnconfiguredLLMProvider(f"Unknown LLM provider '{kind}'.")


# ---- mock helpers ---------------------------------------------------------------------
_SECTION_RE = re.compile(r"^## (?P<name>[A-Z ]+)\n(?P<body>.*?)(?=^## |\Z)", re.S | re.M)


def _section(system: str, name: str) -> str:
    for match in _SECTION_RE.finditer(system):
        if match.group("name").strip() == name:
            return match.group("body").strip()
    return ""


def _first_passage(passages: str) -> str:
    for line in passages.splitlines():
        line = line.strip()
        if not line or line.startswith("[") and line.endswith("]"):
            continue
        if line.lower().startswith("(none"):
            return ""
        sentences = re.split(r"(?<=[.!?])\s+", line)
        return " ".join(sentences[:2]).strip()
    return ""


def _context_sentence(context: str) -> str:
    for line in context.splitlines():
        line = line.strip()
        if line.startswith("- health_number:"):
            return "From your saved results: " + line.split(":", 1)[1].strip()
    for line in context.splitlines():
        line = line.strip()
        if line.startswith("- ") and "not available" not in line:
            return "From your saved results: " + line[2:].split(":", 1)[-1].strip()
    return ""
