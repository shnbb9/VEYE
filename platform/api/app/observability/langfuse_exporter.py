"""Optional Langfuse exporter (development observability).

Disabled unless `VEYE_LANGFUSE_ENABLED=true` and both keys are present. The
exporter receives only the already-masked payload from `TelemetryRecorder`;
as a second line of defence the Langfuse client is constructed with a `mask`
callback that scrubs every value the SDK is about to send. Any SDK failure is
logged and swallowed — Sprout never depends on Langfuse being reachable."""

from __future__ import annotations

import logging
from typing import Any

from app.observability.masking import mask_payload

log = logging.getLogger("veye.telemetry.langfuse")


def sdk_mask(*, data: Any, **_: Any) -> Any:
    """Langfuse `mask` hook: same masking as the recorder, applied again."""
    return mask_payload(data)


class LangfuseTraceExporter:
    name = "langfuse"

    def __init__(self, client) -> None:
        self.client = client

    @classmethod
    def build(cls, *, public_key: str | None, secret_key: str | None, base_url: str, environment: str):
        """Returns an exporter or None when Langfuse cannot be used."""
        if not public_key or not secret_key:
            log.info("Langfuse enabled but keys are missing; exporter not started.")
            return None
        try:
            from langfuse import Langfuse
        except ImportError:
            log.warning("Langfuse enabled but the 'langfuse' package is not installed (pip install 'veye-api[ai]').")
            return None
        try:
            client = Langfuse(public_key=public_key, secret_key=secret_key, base_url=base_url,
                              environment=environment, mask=sdk_mask, tracing_enabled=True)
        except Exception as exc:  # pragma: no cover - depends on the SDK/network
            log.warning("Langfuse client could not be created: %s", exc)
            return None
        return cls(client)

    def export(self, payload: dict, internal: dict) -> str | None:
        span = self.client.start_observation(
            name="sprout.turn", as_type="span",
            input={"policy": payload.get("policy"), "retrieved_sources": payload.get("retrieved_sources")},
            metadata={
                "trace_id": payload["trace_id"], "member_ref": payload["member_ref"], "session_ref": payload["session_ref"],
                "environment": payload["environment"], "safety_result": payload["safety_result"],
                "feedback": payload.get("feedback"), "error_category": payload.get("error_category"),
            },
        )
        try:
            content = payload.get("content") or {}
            generation = span.start_observation(
                name="sprout.generation", as_type="generation", model=payload.get("model"),
                input=content.get("prompt"), output=content.get("response"),
                metadata={"provider": payload.get("provider"), "latency_ms": payload.get("latency_ms")},
                usage_details={k: v for k, v in (("input", payload.get("input_tokens")), ("output", payload.get("output_tokens"))) if v is not None} or None,
            )
            generation.end()
            span.update(output={"safety_result": payload["safety_result"], "policy_outcome": payload["policy"]["outcome"]})
        finally:
            span.end()
        self.client.flush()
        return getattr(span, "trace_id", None)

    def record_feedback(self, trace_id: str, external_id: str | None, rating: str, value: float) -> None:
        if not external_id:
            return
        self.client.create_score(name="member_feedback", value=value, trace_id=external_id, data_type="NUMERIC",
                                 comment=rating)
        self.client.flush()

    def describe(self) -> dict[str, object]:
        return {"exporter": self.name, "configured": True}
