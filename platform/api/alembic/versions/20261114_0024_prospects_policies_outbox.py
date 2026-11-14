"""Saved results before sign-up, versioned policies, and commit-first email.

  * `platform_policy_versions` — immutable published versions of console-set
    rules (the first is the prospect retention policy);
  * `prospect_assessments`, `prospect_events`, `prospect_tokens` — a visitor's
    sealed questionnaire and result, its non-health history, and the hashed
    bearer proofs that can later join it to an account;
  * `scheduled_job_runs` — what each maintenance run did, or why it failed;
  * `notifications.user_id` becomes nullable (a visitor has no account) and
    gains a unique `idempotency_key`; `notification_outbox.next_attempt_at`
    lets the dispatcher retry with backoff.

Backward compatible with the revision still serving: only new tables, new
nullable columns and a relaxed NOT NULL.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20261114_0024"
down_revision = "20261114_0023"
branch_labels = None
depends_on = None


def _json():
    return sa.JSON().with_variant(postgresql.JSONB(), "postgresql")


def upgrade() -> None:
    op.create_table(
        "platform_policy_versions",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("key", sa.String(64), nullable=False),
        sa.Column("version", sa.Integer(), nullable=True),
        sa.Column("status", sa.String(16), nullable=False, server_default="draft"),
        sa.Column("value", _json(), nullable=False),
        sa.Column("content_hash", sa.String(64), nullable=False, server_default=""),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("created_by_name", sa.String(160), nullable=False, server_default=""),
        sa.Column("published_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("published_by_name", sa.String(160), nullable=False, server_default=""),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("key", "version", name="uq_platform_policy_key_version"),
    )
    op.create_index("ix_platform_policy_versions_key", "platform_policy_versions", ["key"])

    op.create_table(
        "prospect_assessments",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("email_normalized", sa.String(320), nullable=True),
        sa.Column("email_verified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("payload_ciphertext", sa.Text(), nullable=True),
        sa.Column("calculation_version", sa.String(32), nullable=False, server_default=""),
        sa.Column("source", sa.String(32), nullable=False, server_default="onboarding"),
        sa.Column("captured_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consent_version", sa.String(64), nullable=False),
        sa.Column("consent_notice_hash", sa.String(64), nullable=False),
        sa.Column("consent_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("retention_mode", sa.String(16), nullable=False),
        sa.Column("retention_days", sa.Integer(), nullable=True),
        sa.Column("retention_policy_version", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(16), nullable=False, server_default="unverified"),
        sa.Column("pending_member_id", sa.Uuid(), sa.ForeignKey("members.id", ondelete="SET NULL"), nullable=True),
        sa.Column("pending_attempt_id", sa.Uuid(), nullable=True),
        sa.Column("pending_proof", sa.String(16), nullable=True),
        sa.Column("claimed_member_id", sa.Uuid(), sa.ForeignKey("members.id", ondelete="SET NULL"), nullable=True),
        sa.Column("claimed_attempt_id", sa.Uuid(), nullable=True),
        sa.Column("claimed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("purged_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("erased_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("idempotency_key_hash", sa.String(64), nullable=True),
        sa.Column("is_synthetic", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("claimed_attempt_id", name="uq_prospect_assessments_claimed_attempt_id"),
        sa.UniqueConstraint("idempotency_key_hash", name="uq_prospect_assessments_idempotency_key_hash"),
    )
    op.create_index("ix_prospect_assessments_email_normalized", "prospect_assessments", ["email_normalized"])
    op.create_index("ix_prospect_assessments_status", "prospect_assessments", ["status"])
    op.create_index("ix_prospect_assessments_status_expiry", "prospect_assessments", ["status", "expires_at"])
    op.create_index("ix_prospect_assessments_pending_member_id", "prospect_assessments", ["pending_member_id"])
    op.create_index("ix_prospect_assessments_claimed_member_id", "prospect_assessments", ["claimed_member_id"])

    op.create_table(
        "prospect_events",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("prospect_id", sa.Uuid(), sa.ForeignKey("prospect_assessments.id", ondelete="CASCADE"), nullable=False),
        sa.Column("event_type", sa.String(32), nullable=False),
        sa.Column("actor_type", sa.String(16), nullable=False),
        sa.Column("actor_user_id", sa.Uuid(), nullable=True),
        sa.Column("policy_version", sa.Integer(), nullable=True),
        sa.Column("details", _json(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_prospect_events_prospect", "prospect_events", ["prospect_id", "created_at"])

    op.create_table(
        "prospect_tokens",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("prospect_id", sa.Uuid(), sa.ForeignKey("prospect_assessments.id", ondelete="CASCADE"), nullable=False),
        sa.Column("purpose", sa.String(16), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("token_hash", name="uq_prospect_tokens_token_hash"),
    )
    op.create_index("ix_prospect_tokens_prospect_id", "prospect_tokens", ["prospect_id"])

    op.create_table(
        "scheduled_job_runs",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("job", sa.String(48), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(16), nullable=False, server_default="running"),
        sa.Column("dry_run", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("triggered_by", sa.String(160), nullable=False, server_default="scheduler"),
        sa.Column("counts", _json(), nullable=False),
        sa.Column("error", sa.Text(), nullable=True),
    )
    op.create_index("ix_scheduled_job_runs_job_started", "scheduled_job_runs", ["job", "started_at"])

    op.alter_column("notifications", "user_id", existing_type=sa.Uuid(), nullable=True)
    op.add_column("notifications", sa.Column("idempotency_key", sa.String(160), nullable=True))
    op.create_unique_constraint("uq_notifications_idempotency_key", "notifications", ["idempotency_key"])
    op.add_column("notification_outbox", sa.Column("next_attempt_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_notification_outbox_next_attempt_at", "notification_outbox", ["next_attempt_at"])


def downgrade() -> None:
    op.drop_index("ix_notification_outbox_next_attempt_at", table_name="notification_outbox")
    op.drop_column("notification_outbox", "next_attempt_at")
    op.drop_constraint("uq_notifications_idempotency_key", "notifications", type_="unique")
    op.drop_column("notifications", "idempotency_key")
    # Rows written for visitors have no account; they cannot survive NOT NULL.
    op.execute("DELETE FROM notification_outbox WHERE notification_id IN (SELECT id FROM notifications WHERE user_id IS NULL)")
    op.execute("DELETE FROM notifications WHERE user_id IS NULL")
    op.alter_column("notifications", "user_id", existing_type=sa.Uuid(), nullable=False)
    op.drop_index("ix_scheduled_job_runs_job_started", table_name="scheduled_job_runs")
    op.drop_table("scheduled_job_runs")
    op.drop_index("ix_prospect_tokens_prospect_id", table_name="prospect_tokens")
    op.drop_table("prospect_tokens")
    op.drop_index("ix_prospect_events_prospect", table_name="prospect_events")
    op.drop_table("prospect_events")
    for name in ("ix_prospect_assessments_claimed_member_id", "ix_prospect_assessments_pending_member_id",
                 "ix_prospect_assessments_status_expiry", "ix_prospect_assessments_status",
                 "ix_prospect_assessments_email_normalized"):
        op.drop_index(name, table_name="prospect_assessments")
    op.drop_table("prospect_assessments")
    op.drop_index("ix_platform_policy_versions_key", table_name="platform_policy_versions")
    op.drop_table("platform_policy_versions")
