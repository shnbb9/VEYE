from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "VEYE API"
    environment: str = "development"
    # PostgreSQL is the normal runtime shape. SQLite is supplied explicitly by
    # the test fixture only; the application must not silently create a local
    # development database in a process that was meant to be production-like.
    database_url: str
    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"
    # Where the browser application lives; used only to build links inside
    # emails (verification, password reset).
    web_base_url: str = "http://localhost:3000"

    # ---- authentication (development provider) --------------------------------
    # "development" is the only provider implemented: argon2id password hashes
    # and opaque server-side sessions in an HttpOnly cookie. The production
    # provider (Cognito or another) is a client decision and is not wired.
    auth_provider: str = "development"
    # One HttpOnly session cookie per portal, so the member application and
    # the admin console can be open in the same browser at the same time.
    member_session_cookie_name: str = "veye_member_session"
    admin_session_cookie_name: str = "veye_admin_session"
    session_cookie_secure: bool = False
    session_hours: int = 12
    session_remember_days: int = 30
    email_verification_hours: int = 48
    password_reset_minutes: int = 30
    password_min_length: int = 12

    # ---- email -----------------------------------------------------------------
    # "local-smtp" delivers to a plain SMTP endpoint (Mailpit in the optional
    # Compose profile); "memory" keeps messages in-process (tests); "none"
    # records every message as undeliverable instead of pretending it was sent.
    email_provider: str = "local-smtp"
    smtp_host: str = "127.0.0.1"
    smtp_port: int = 1025
    email_from: str = "Veye <no-reply@veye.local>"

    # ---- Companion / AI providers --------------------------------------------------
    # LLMProvider: "mock" (deterministic, offline) or "groq" (development only,
    # needs VEYE_GROQ_API_KEY). Provider absence never stops the API booting.
    llm_provider: str = "mock"
    groq_api_key: str | None = None
    groq_model: str = "llama-3.3-70b-versatile"
    llm_timeout_seconds: float = 30.0
    # EmbeddingProvider: "hashing" is the deterministic local provider used for
    # development retrieval; no external embedding provider is connected.
    embedding_provider: str = "hashing"
    embedding_dimensions: int = 256
    knowledge_object_store: str = "local"
    knowledge_object_root: str = "var/knowledge-objects"
    s3_knowledge_bucket: str | None = None
    retrieval_limit: int = 4

    # ---- member media (profile photos) -------------------------------------------
    # ObjectStorage: "local" keeps bytes under var/ (a Docker volume locally);
    # "gcs" names the probable production target but stays unconnected until
    # the client's cloud project exists. Only the object key lives in PostgreSQL.
    media_object_store: str = "local"
    media_object_root: str = "var/media-objects"
    profile_photo_max_bytes: int = 2_000_000

    # ---- observability -------------------------------------------------------------
    # Every trace is masked before it reaches any exporter. The database exporter
    # feeds the admin Advanced monitoring screens; Langfuse is optional and only
    # active when explicitly enabled with keys present.
    telemetry_pseudonym_key: str = "local-development-pseudonym-key"
    ai_telemetry_capture_content: bool = False
    langfuse_enabled: bool = False
    langfuse_public_key: str | None = None
    langfuse_secret_key: str | None = None
    langfuse_base_url: str = "https://cloud.langfuse.com"

    model_config = SettingsConfigDict(env_file=".env", env_prefix="VEYE_", extra="ignore")

    @property
    def cors_origin_list(self) -> list[str]:
        return [item.strip() for item in self.cors_origins.split(",") if item.strip()]

    @property
    def is_production(self) -> bool:
        return self.environment.lower() in {"production", "prod"}


settings = Settings()
