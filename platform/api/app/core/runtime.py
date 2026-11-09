"""Process-wide provider wiring built from settings.

Everything replaceable (authentication provider, email transport, LLM,
embeddings, object store, telemetry exporters) is constructed here once and
handed to request handlers through dependencies. Tests swap individual
providers with `configure_runtime`."""

from __future__ import annotations

import logging
from dataclasses import dataclass, replace

from app.auth.identity import IdentityVerifier, build_identity_verifier
from app.auth.provider import DevelopmentSessionAuthProvider
from app.companion.providers.embeddings import EmbeddingProvider, build_embedding_provider
from app.companion.providers.llm import LLMProvider, build_llm_provider
from app.core.config import Settings, settings
from app.knowledge.object_store import KnowledgeObjectStore, build_object_store
from app.notifications import templates
from app.notifications.email import EmailProvider, build_email_provider
from app.observability.telemetry import DatabaseTraceExporter, TelemetryExporter, TelemetryRecorder
from app.storage.object_storage import ObjectStorage, build_media_storage

log = logging.getLogger("veye.runtime")


@dataclass
class Runtime:
    settings: Settings
    auth_provider: DevelopmentSessionAuthProvider
    # Sessions stay VEYE's whichever way the person authenticated; this is the
    # verifier for Identity Platform tokens, and None for the development
    # provider, which has no token to verify.
    identity: IdentityVerifier | None
    email: EmailProvider
    llm: LLMProvider
    embeddings: EmbeddingProvider
    object_store: KnowledgeObjectStore
    media_store: ObjectStorage
    telemetry: TelemetryRecorder
    langfuse_status: str


_runtime: Runtime | None = None


def build_runtime(config: Settings | None = None) -> Runtime:
    from app.db.session import SessionLocal

    config = config or settings
    # Two authentication providers, one session layer. Identity Platform proves
    # who the person is; the sessions, the portal cookies and every
    # authorization decision below stay exactly where they were.
    identity = build_identity_verifier(config)
    auth_provider = DevelopmentSessionAuthProvider(
        cookie_names={"member": config.member_session_cookie_name, "admin": config.admin_session_cookie_name},
        session_hours=config.session_hours, remember_days=config.session_remember_days,
    )
    email = build_email_provider(config.email_provider, host=config.smtp_host, port=config.smtp_port, sender=config.email_from,
                                 production=config.is_production, tls_mode=config.smtp_tls_mode, username=config.smtp_username,
                                 password=config.smtp_password, timeout=config.smtp_timeout_seconds,
                                 reply_to=config.email_reply_to)
    # The two deployment facts every message carries: where it really came
    # from, and whether replying reaches anybody.
    templates.configure(environment=config.environment, reply_to=config.email_reply_to)
    llm = build_llm_provider(config.llm_provider, groq_api_key=config.groq_api_key, groq_model=config.groq_model,
                             timeout_seconds=config.llm_timeout_seconds,
                             gemini={"project": config.gcp_project or "", "location": config.gcp_location,
                                     "model": config.gemini_model, "api_key": config.gemini_api_key,
                                     "member_data_cleared": config.gemini_member_data_cleared,
                                     "production": config.is_production})
    embeddings = build_embedding_provider(config.embedding_provider, dimensions=config.embedding_dimensions)
    object_store = build_object_store(config.knowledge_object_store, local_root=config.knowledge_object_root,
                                      s3_bucket=config.s3_knowledge_bucket)
    media_store = build_media_storage(config.media_object_store, local_root=config.media_object_root,
                                      bucket=config.media_bucket, prefix=config.media_object_prefix)

    exporters: list[TelemetryExporter] = [DatabaseTraceExporter(SessionLocal)]
    langfuse_status = "disabled"
    if config.langfuse_enabled:
        from app.observability.langfuse_exporter import LangfuseTraceExporter

        exporter = LangfuseTraceExporter.build(public_key=config.langfuse_public_key, secret_key=config.langfuse_secret_key,
                                               base_url=config.langfuse_base_url, environment=config.environment)
        if exporter is not None:
            exporters.append(exporter)
            langfuse_status = "enabled"
        else:
            langfuse_status = "enabled-but-unavailable"
    telemetry = TelemetryRecorder(exporters, pseudonym_key=config.telemetry_pseudonym_key, environment=config.environment,
                                  capture_content=config.ai_telemetry_capture_content)
    return Runtime(settings=config, auth_provider=auth_provider, identity=identity, email=email, llm=llm, embeddings=embeddings,
                   object_store=object_store, media_store=media_store, telemetry=telemetry, langfuse_status=langfuse_status)


def get_runtime() -> Runtime:
    global _runtime
    if _runtime is None:
        _runtime = build_runtime()
    return _runtime


def configure_runtime(**overrides) -> Runtime:
    """Replace selected providers (tests). Unknown fields are rejected."""
    global _runtime
    base = get_runtime()
    _runtime = replace(base, **overrides)
    return _runtime


def reset_runtime() -> None:
    global _runtime
    _runtime = None
