"""Companion telemetry: one production-safe record per Sprout turn.

`TelemetryRecorder.record` builds the payload, masks it, and hands the same
masked payload to every exporter. Raw prompt/response text is included only
when `VEYE_AI_TELEMETRY_CAPTURE_CONTENT=true` (a development setting for
synthetic conversations) and even then it is scrubbed first."""

from __future__ import annotations

import hashlib
import hmac
import logging
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Protocol

from app.observability.masking import KnownIdentifiers, mask_payload

log = logging.getLogger("veye.telemetry")


@dataclass
class CompanionTrace:
    member_id: str
    conversation_id: str
    message_id: str | None
    policy_outcome: str
    policy_category: str | None
    safety_result: str
    provider: str | None = None
    model: str | None = None
    latency_ms: int = 0
    input_tokens: int | None = None
    output_tokens: int | None = None
    retrieved_sources: list[dict] = field(default_factory=list)  # {source_id, document_id, chunk_id, score}
    feedback: str | None = None
    error_category: str | None = None
    prompt: dict | None = None
    response_text: str | None = None
    trace_id: str = field(default_factory=lambda: uuid.uuid4().hex)


class TelemetryExporter(Protocol):
    name: str

    def export(self, payload: dict, internal: dict) -> str | None:
        """Export one masked payload; may return the exporter's own trace id."""
        ...

    def record_feedback(self, trace_id: str, external_id: str | None, rating: str, value: float) -> None: ...


class InMemoryTraceExporter:
    name = "memory"

    def __init__(self) -> None:
        self.payloads: list[dict] = []
        self.internal: list[dict] = []

    def export(self, payload: dict, internal: dict) -> str | None:
        self.payloads.append(payload)
        self.internal.append(internal)
        return f"memory-{len(self.payloads)}"

    def record_feedback(self, trace_id: str, external_id: str | None, rating: str, value: float) -> None:
        for payload in self.payloads:
            if payload["trace_id"] == trace_id:
                payload["feedback"] = rating


class DatabaseTraceExporter:
    """Writes the masked payload to `ai_trace_events` using its own short
    session so telemetry never rides on a request transaction."""

    name = "database"

    def __init__(self, session_factory) -> None:
        self._session_factory = session_factory

    def record_feedback(self, trace_id: str, external_id: str | None, rating: str, value: float, session=None) -> None:
        from app.observability.models import AiTraceEvent

        def apply(target) -> None:
            for row in target.query(AiTraceEvent).filter(AiTraceEvent.trace_id == trace_id).all():
                row.feedback = rating
                payload = dict(row.payload)
                payload["feedback"] = rating
                row.payload = payload

        if session is not None:
            apply(session)
            session.flush()
            return
        with self._session_factory() as own:
            apply(own)
            own.commit()

    def export(self, payload: dict, internal: dict) -> str | None:
        from app.observability.models import AiTraceEvent

        # Inside a request the trace joins the request transaction (atomic with
        # the message it describes); outside one it uses a short session.
        session = internal.get("session")
        if session is not None:
            session.add(self._row(payload, internal, AiTraceEvent))
            session.flush()
            return payload["trace_id"]
        with self._session_factory() as session:
            session.add(self._row(payload, internal, AiTraceEvent))
            session.commit()
        return payload["trace_id"]

    @staticmethod
    def _row(payload: dict, internal: dict, AiTraceEvent):
        return AiTraceEvent(
                trace_id=payload["trace_id"], environment=payload["environment"], member_ref=payload["member_ref"],
                session_ref=payload["session_ref"],
                conversation_id=uuid.UUID(internal["conversation_id"]) if internal.get("conversation_id") else None,
                message_id=uuid.UUID(internal["message_id"]) if internal.get("message_id") else None,
                provider=payload.get("provider"), model=payload.get("model"), latency_ms=payload.get("latency_ms", 0),
                input_tokens=payload.get("input_tokens"), output_tokens=payload.get("output_tokens"),
                policy_outcome=payload["policy"]["outcome"], policy_category=payload["policy"].get("category"),
                safety_result=payload["safety_result"], retrieval_count=len(payload.get("retrieved_sources", [])),
                top_retrieval_score=(payload["retrieved_sources"][0]["score"] if payload.get("retrieved_sources") else None),
                feedback=payload.get("feedback"), error_category=payload.get("error_category"),
                exporters=",".join(internal.get("exporters", [])), payload=payload,
            )


class TelemetryRecorder:
    def __init__(self, exporters: list[TelemetryExporter], *, pseudonym_key: str, environment: str,
                 capture_content: bool = False) -> None:
        self.exporters = exporters
        self.pseudonym_key = pseudonym_key.encode("utf-8")
        self.environment = environment
        self.capture_content = capture_content
        self._external_ids: dict[str, dict[str, str]] = {}

    def pseudonym(self, value: str) -> str:
        return hmac.new(self.pseudonym_key, value.encode("utf-8"), hashlib.sha256).hexdigest()[:16]

    def build_payload(self, trace: CompanionTrace, known: KnownIdentifiers) -> dict:
        payload: dict = {
            "trace_id": trace.trace_id,
            "recorded_at": datetime.now(timezone.utc).isoformat(),
            "environment": self.environment,
            "member_ref": self.pseudonym("member:" + trace.member_id),
            "session_ref": self.pseudonym("conversation:" + trace.conversation_id),
            "provider": trace.provider,
            "model": trace.model,
            "latency_ms": trace.latency_ms,
            "input_tokens": trace.input_tokens,
            "output_tokens": trace.output_tokens,
            "retrieved_sources": [
                {"source_id": s.get("source_id"), "document_id": s.get("document_id"), "chunk_id": s.get("chunk_id"),
                 "source_version": s.get("source_version"), "score": s.get("score")}
                for s in trace.retrieved_sources
            ],
            "policy": {"outcome": trace.policy_outcome, "category": trace.policy_category},
            "safety_result": trace.safety_result,
            "feedback": trace.feedback,
            "error_category": trace.error_category,
        }
        if self.capture_content and (trace.prompt is not None or trace.response_text is not None):
            payload["content"] = {"prompt": trace.prompt, "response": trace.response_text, "capture": "development-only"}
        return mask_payload(payload, known)

    def record(self, trace: CompanionTrace, known: KnownIdentifiers, *, session=None) -> dict:
        payload = self.build_payload(trace, known)
        internal = {"conversation_id": trace.conversation_id, "message_id": trace.message_id,
                    "exporters": [e.name for e in self.exporters], "session": session}
        for exporter in self.exporters:
            try:
                external_id = exporter.export(payload, internal)
                if external_id:
                    self._external_ids.setdefault(trace.trace_id, {})[exporter.name] = external_id
            except Exception as exc:  # telemetry must never break a member response
                log.warning("telemetry exporter %s failed: %s", exporter.name, exc)
        return payload

    def record_feedback(self, trace_id: str, rating: str, *, session=None) -> None:
        value = 1.0 if rating == "helpful" else 0.0
        for exporter in self.exporters:
            try:
                external_id = self._external_ids.get(trace_id, {}).get(exporter.name)
                if exporter.name == "database":
                    exporter.record_feedback(trace_id, external_id, rating, value, session=session)
                else:
                    exporter.record_feedback(trace_id, external_id, rating, value)
            except Exception as exc:
                log.warning("telemetry exporter %s feedback failed: %s", exporter.name, exc)

    def describe(self) -> dict[str, object]:
        return {"exporters": [e.name for e in self.exporters], "capture_content": self.capture_content,
                "environment": self.environment}
