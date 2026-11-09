from pydantic import SecretStr, field_validator
from pydantic import model_validator
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
    # Left False so the local http stack works; a production environment
    # turns it on by itself below, rather than relying on somebody remembering
    # to set it. Session cookies must never travel in clear text.
    session_cookie_secure: bool = False
    session_hours: int = 12
    session_remember_days: int = 30
    email_verification_hours: int = 48
    password_reset_minutes: int = 30
    password_min_length: int = 12
    # An administrator invitation is a single-use link; a working week is long
    # enough for someone to pick it up and short enough to expire on its own.
    admin_invitation_hours: int = 72
    # Confirming a new email address: the link goes to the NEW address.
    email_change_hours: int = 24
    # Brute-force protection for sign-in. Counted over one rolling window: per
    # address typed (cleared by a correct password) and, higher, per client
    # address (never cleared, so spraying cannot reset itself). Set the first
    # to 0 to switch the limit off entirely.
    sign_in_window_minutes: int = 15
    sign_in_max_failures: int = 10
    sign_in_max_failures_per_address: int = 50
    # How long a dead session, spent token or counted attempt is kept before
    # housekeeping removes it. Live rows are never touched.
    auth_retention_days: int = 7

    # ---- production identity (Google Cloud Identity Platform) --------------------
    # "development" is the isolated provider VEYE holds itself; "identity-platform"
    # verifies Google-issued ID tokens and still issues VEYE's own portal session,
    # because authentication is theirs and authorization stays here.
    identity_project_id: str | None = None
    # Identity Platform tenants (one per environment) appear in the token.
    identity_tenant_id: str | None = None
    identity_jwks_url: str = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"
    identity_clock_leeway_seconds: int = 30
    # First sign-in links the Google subject to the VEYE account that already
    # holds that address. A token never creates an account: members sign up
    # through VEYE and administrator access is provisioned.
    identity_link_by_verified_email: bool = True
    # The console is the higher-value portal, so a second factor is required
    # there. TOTP by default and deliberately not SMS; "phone" has to be added
    # on purpose by a deployment that accepts it.
    admin_mfa_required: bool = True
    admin_accepted_second_factors: str = "totp"

    # ---- email -----------------------------------------------------------------
    # "local-smtp" delivers to a plain SMTP endpoint (Mailpit in the optional
    # Compose profile); "smtp" is the authenticated, TLS-protected provider for
    # a real relay (e.g. Google Workspace); "memory" keeps messages in-process
    # (tests); "none" records every message as undeliverable instead of
    # pretending it was sent. Production refuses everything except "smtp".
    email_provider: str = "local-smtp"
    smtp_host: str = "127.0.0.1"
    smtp_port: int = 1025
    # "auto" means implicit TLS on 465 and STARTTLS on any other port; "none" is
    # refused in production and never allowed together with credentials.
    smtp_tls_mode: str = "auto"
    smtp_username: str | None = None
    # Only ever read from the environment; masked in repr, never logged.
    smtp_password: SecretStr | None = None
    smtp_timeout_seconds: float = 10.0
    email_from: str = "Veye <no-reply@veye.local>"
    # Where a reply should land. Unset locally, because there is no mailbox
    # behind the development sender and a message must not invite a reply that
    # reaches nobody; production points this at the monitored address. Set once
    # here and applied at the transport, so no caller carries it.
    email_reply_to: str | None = None

    # ---- Companion / AI providers --------------------------------------------------
    # LLMProvider: "mock" (deterministic, offline) or "groq" (development only,
    # needs VEYE_GROQ_API_KEY). Provider absence never stops the API booting.
    llm_provider: str = "mock"
    # Gemini on Google Cloud is the selected production provider (9 Nov 2026).
    # Vertex AI with the service's own identity, not a personal API key: a key
    # belongs to a person, is covered by no agreement, and cannot be rotated or
    # audited like a service identity.
    gemini_model: str = "gemini-2.0-flash"
    gcp_project: str | None = None
    gcp_location: str = "us-central1"
    # Local experimentation only. Refused in production, and never permitted to
    # carry member data.
    gemini_api_key: str | None = None
    # Sending a member's health summaries to an external model is a disclosure,
    # and whether it is a permitted one is a BAA/covered-service question
    # nobody has answered. Until a deployment says otherwise, a prompt carrying
    # member context is refused rather than quietly emptied.
    gemini_member_data_cleared: bool = False
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
    # "local" (development) or "gcs" (Google Cloud Storage, the chosen target).
    media_object_store: str = "local"
    media_object_root: str = "var/media-objects"
    media_bucket: str | None = None
    # Lets a staging deployment share a bucket without sharing objects. They
    # should not share one; this is for when they must.
    media_object_prefix: str = ""
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

    @field_validator("smtp_username", "smtp_password", "smtp_tls_mode", "email_reply_to",
                     "gcp_project", "gemini_api_key", "media_bucket", mode="before")
    @classmethod
    def _blank_smtp_value_is_unset(cls, value, info):
        # Env files list these names with empty values; empty means "not set".
        if isinstance(value, str) and not value.strip():
            return "auto" if info.field_name == "smtp_tls_mode" else None
        return value

    @property
    def admin_second_factors(self) -> frozenset[str]:
        return frozenset(item.strip().lower() for item in self.admin_accepted_second_factors.split(",") if item.strip())

    @property
    def uses_identity_platform(self) -> bool:
        return self.auth_provider == "identity-platform"

    @property
    def cors_origin_list(self) -> list[str]:
        return [item.strip() for item in self.cors_origins.split(",") if item.strip()]

    @property
    def is_production(self) -> bool:
        return self.environment.lower() in {"production", "prod"}

    @model_validator(mode="after")
    def _secure_cookies_in_production(self) -> "Settings":
        # A production deployment serves TLS, so the session cookies are
        # marked Secure whatever the env file says; HSTS follows the same flag.
        if self.is_production and not self.session_cookie_secure:
            object.__setattr__(self, "session_cookie_secure", True)
        return self


settings = Settings()
