import os

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
    # How many proxies of ours sit in front of this API and append to
    # X-Forwarded-For (Cloud Run or the reference Nginx: 1). 0 = none: the
    # header is ignored, because then only a caller could have written it.
    trusted_proxy_hops: int = 0
    member_invitation_hours: int = 168  # a week: this one is an offer, not a key
    # Confirming a new email address: the link goes to the NEW address.
    email_change_hours: int = 24
    # Brute-force protection for sign-in. Counted over one rolling window: per
    # address typed (cleared by a correct password) and, higher, per client
    # address (never cleared, so spraying cannot reset itself). Set the first
    # to 0 to switch the limit off entirely.
    # Rate limits on the costly and mail-sending endpoints are multiplied by
    # this. Production runs at 1. A development stack and the acceptance suite
    # raise it, because twenty-five sign-ups from one address in one run is a
    # test fixture rather than an attack — the limits still apply, they are
    # just scaled to the traffic the environment legitimately produces. It is
    # deliberately a multiplier and not a switch: there is no "off".
    rate_limit_scale: float = 1.0

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
    # LLMProvider: "mock" (deterministic, offline), "gemini", or "groq"
    # (development only, needs VEYE_GROQ_API_KEY). Provider absence never stops
    # the API booting.
    llm_provider: str = "mock"
    # Which of Google's doors, for the model and for Google's embeddings alike:
    #   developer  the Gemini Developer API with VEYE_GEMINI_API_KEY. Local
    #              development and synthetic testing only.
    #   vertex     Vertex AI with VEYE_GCP_PROJECT and the running service's own
    #              identity (Application Default Credentials).
    # No default, and no guessing: with neither chosen nothing is sent, and one
    # is never used in place of the other because its credentials are there.
    gemini_backend: str = ""
    # gemini-3.8-flash is stable on both; gemini-2.0-flash was retired on 1 June 2026.
    gemini_model: str = "gemini-3.8-flash"
    gcp_project: str | None = None
    # Where Vertex AI answers. Google serves this model on `global` and the
    # `us` / `eu` multi-regions. `us` keeps processing inside the United States,
    # which `global` does not promise. us-central1 does not serve it at all.
    gcp_location: str = "us"
    # The developer backend's, and nothing else's. Refused outside local
    # development, and never permitted to carry member data.
    gemini_api_key: SecretStr | None = None
    # Sending a member's health summaries to an external model is a disclosure,
    # and whether it is a permitted one is a BAA/covered-service question
    # nobody has answered. Until a deployment says otherwise, a prompt carrying
    # member context is refused rather than quietly emptied.
    gemini_member_data_cleared: bool = False
    groq_api_key: SecretStr | None = None
    groq_model: str = "llama-3.3-70b-versatile"
    llm_timeout_seconds: float = 30.0
    # EmbeddingProvider: "hashing" is the deterministic local provider used for
    # development retrieval and is the default; "google" is Google's text
    # embeddings, through VEYE_GEMINI_BACKEND.
    #
    # `embedding_dimensions` is not a free choice: knowledge_chunks.embedding
    # is vector(n) fixed by migration, so changing it means migrating the
    # column and re-ingesting every source in the same move.
    embedding_provider: str = "hashing"
    embedding_dimensions: int = 256
    # Empty means the provider's own documented default.
    embedding_model: str = ""
    # Where Vertex AI embeds. Not where it answers: gemini-embedding-001 is
    # served from single regions and the language model from multi-regions.
    embedding_location: str = "us-central1"
    # "local" (development) or "gcs". Source documents live in their own
    # bucket, separate from member media: different lifecycle, different
    # audience, and one IAM grant should not cover both.
    knowledge_object_store: str = "local"
    knowledge_object_root: str = "var/knowledge-objects"
    knowledge_bucket: str | None = None
    knowledge_object_prefix: str = "knowledge/"
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
    # 10 MB since 15 Nov 2026: the original is now kept to crop from, and an
    # ordinary phone photo (3-6 MB) was being refused at 2 MB. Pixels are
    # still capped separately (images.MAX_IMAGE_PIXELS, MAX_INPUT_SIDE).
    profile_photo_max_bytes: int = 10_000_000
    # A Food Diary photo: an upload, a camera snapshot or a picture fetched
    # from a link the member pasted (app/storage/remote_image.py).
    meal_photo_max_bytes: int = 10_000_000
    # Hosts the link fetcher may reach although they resolve to a private
    # address: the local stack's own containers, so the browser suite can
    # prove the link journey without the internet (compose.local.yaml).
    # Comma-separated "host" or "host:port". Production clears it.
    remote_image_trusted_hosts: str = ""

    # ---- saved results before sign-up (prospects) -------------------------------------
    # `kid:base64(32 bytes)` entries, comma-separated; the first encrypts, all
    # decrypt (rotation). Secret Manager in a deployment. Unset locally means a
    # fixed development key that protects nothing; production refuses to save
    # anything without a configured key.
    prospect_encryption_keys: SecretStr | None = None

    # ---- maintenance jobs ---------------------------------------------------------------
    # The local stand-in for Cloud Scheduler: run every job every N seconds in
    # the API process. 0 (the default, and always in tests) switches it off; a
    # deployment schedules `python -m app.jobs run all` instead.
    jobs_interval_seconds: float = 0

    # ---- observability -------------------------------------------------------------
    # Every trace is masked before it reaches any exporter. The database exporter
    # feeds the admin Advanced monitoring screens; Langfuse is optional and only
    # active when explicitly enabled with keys present.
    telemetry_pseudonym_key: SecretStr = SecretStr("local-development-pseudonym-key")
    ai_telemetry_capture_content: bool = False
    langfuse_enabled: bool = False
    langfuse_public_key: str | None = None
    langfuse_secret_key: SecretStr | None = None
    langfuse_base_url: str = "https://cloud.langfuse.com"

    model_config = SettingsConfigDict(env_file=".env", env_prefix="VEYE_", extra="ignore")

    @field_validator("smtp_username", "smtp_password", "smtp_tls_mode", "email_reply_to",
                     "gcp_project", "gemini_api_key", "media_bucket", "knowledge_bucket",
                     "prospect_encryption_keys", mode="before")
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

    @property
    def is_local(self) -> bool:
        """Somebody's own machine, or a test run. Named one by one: a staging
        deployment, or a name nobody thought of, is not. Nor is a container on
        Cloud Run that was told nothing and took the default."""
        if os.environ.get("K_SERVICE") or os.environ.get("CLOUD_RUN_JOB"):
            return False
        return self.environment.strip().lower() in {"development", "local", "local-docker", "test"}

    @model_validator(mode="after")
    def _secure_cookies_in_production(self) -> "Settings":
        # A production deployment serves TLS, so the session cookies are
        # marked Secure whatever the env file says; HSTS follows the same flag.
        if self.is_production and not self.session_cookie_secure:
            object.__setattr__(self, "session_cookie_secure", True)
        return self

    @model_validator(mode="after")
    def _limits_as_written_in_production(self) -> "Settings":
        # The scale lets a local stack sign up a whole test suite's members
        # from one address (compose.local.yaml sets 50). Production enforces
        # every limit as written, whatever an env file copied from development
        # says.
        if self.is_production and self.rate_limit_scale != 1.0:
            object.__setattr__(self, "rate_limit_scale", 1.0)
        return self

    @model_validator(mode="after")
    def _no_private_image_hosts_in_production(self) -> "Settings":
        # A production link fetcher reaches the public internet only, whatever
        # an env file copied from development says.
        if self.is_production and self.remote_image_trusted_hosts:
            object.__setattr__(self, "remote_image_trusted_hosts", "")
        return self

    @property
    def remote_image_trusted_host_set(self) -> frozenset[str]:
        return frozenset(item.strip().lower() for item in self.remote_image_trusted_hosts.split(",") if item.strip())


def reveal(value: SecretStr | str | None) -> str | None:
    """The plain value of a secret setting, for the one call that hands it to
    a provider. Keys are SecretStr so a repr, a log line or a traceback of the
    settings never prints them."""
    if isinstance(value, SecretStr):
        return value.get_secret_value()
    return value


settings = Settings()
