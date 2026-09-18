"""Companion conversations, provenance, policy decisions, feedback and
settings; masked AI telemetry; admin audit log."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20260915_0007"
down_revision = "20260915_0006"
branch_labels = None
depends_on = None


def _json():
    return postgresql.JSONB(astext_type=sa.Text()) if op.get_bind().dialect.name == "postgresql" else sa.JSON()


def upgrade() -> None:
    op.create_table(
        "companion_settings",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("name", sa.String(48), nullable=False, server_default="Sprout"),
        sa.Column("welcome", sa.Text(), nullable=False),
        sa.Column("returning_welcome", sa.Text(), nullable=False),
        sa.Column("safe_response", sa.Text(), nullable=False),
        sa.Column("fallback", sa.Text(), nullable=False),
        sa.Column("escalation_response", sa.Text(), nullable=False),
        sa.Column("quick_prompts", _json(), nullable=False),
        sa.Column("policy", _json(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_by", sa.String(120), nullable=True),
    )
    op.create_table(
        "companion_conversations",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("member_id", sa.Uuid(), sa.ForeignKey("members.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_message_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="open"),
        sa.Column("flagged", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("flag_reason", sa.Text(), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reviewed_by", sa.String(120), nullable=True),
        sa.Column("message_count", sa.Integer(), nullable=False, server_default="0"),
    )
    op.create_table(
        "companion_policy_decisions",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("conversation_id", sa.Uuid(), nullable=False, index=True),
        sa.Column("member_id", sa.Uuid(), nullable=False, index=True),
        sa.Column("outcome", sa.String(24), nullable=False),
        sa.Column("category", sa.String(48), nullable=True),
        sa.Column("matched_rule", sa.String(120), nullable=True),
        sa.Column("retrieval_scopes", _json(), nullable=False),
        sa.Column("member_data_scopes", _json(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False, server_default=""),
        sa.Column("policy_version", sa.String(24), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "companion_messages",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("conversation_id", sa.Uuid(), sa.ForeignKey("companion_conversations.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("role", sa.String(16), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("outcome", sa.String(24), nullable=True),
        sa.Column("policy_decision_id", sa.Uuid(), sa.ForeignKey("companion_policy_decisions.id", ondelete="SET NULL"), nullable=True),
        sa.Column("provider", sa.String(32), nullable=True),
        sa.Column("model", sa.String(120), nullable=True),
        sa.Column("latency_ms", sa.Integer(), nullable=True),
        sa.Column("input_tokens", sa.Integer(), nullable=True),
        sa.Column("output_tokens", sa.Integer(), nullable=True),
        sa.Column("safety_result", sa.String(32), nullable=True),
        sa.Column("context_scopes", _json(), nullable=False),
        sa.Column("trace_id", sa.String(64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "companion_message_sources",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("message_id", sa.Uuid(), sa.ForeignKey("companion_messages.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("rank", sa.Integer(), nullable=False),
        sa.Column("source_id", sa.Uuid(), nullable=False),
        sa.Column("document_id", sa.Uuid(), nullable=False),
        sa.Column("chunk_id", sa.Uuid(), nullable=False),
        sa.Column("source_title", sa.String(200), nullable=False),
        sa.Column("source_version", sa.Integer(), nullable=False),
        sa.Column("score", sa.Float(), nullable=False),
    )
    op.create_table(
        "companion_feedback",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("message_id", sa.Uuid(), sa.ForeignKey("companion_messages.id", ondelete="CASCADE"), nullable=False, unique=True),
        sa.Column("conversation_id", sa.Uuid(), nullable=False, index=True),
        sa.Column("member_id", sa.Uuid(), nullable=False, index=True),
        sa.Column("rating", sa.String(16), nullable=False),
        sa.Column("reason", sa.String(48), nullable=True),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reviewed_by", sa.String(120), nullable=True),
    )
    op.create_table(
        "ai_trace_events",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("trace_id", sa.String(64), nullable=False, index=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("environment", sa.String(32), nullable=False),
        sa.Column("member_ref", sa.String(32), nullable=False, index=True),
        sa.Column("session_ref", sa.String(32), nullable=False, index=True),
        sa.Column("conversation_id", sa.Uuid(), nullable=True),
        sa.Column("message_id", sa.Uuid(), nullable=True),
        sa.Column("provider", sa.String(32), nullable=True),
        sa.Column("model", sa.String(120), nullable=True),
        sa.Column("latency_ms", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("input_tokens", sa.Integer(), nullable=True),
        sa.Column("output_tokens", sa.Integer(), nullable=True),
        sa.Column("policy_outcome", sa.String(24), nullable=False),
        sa.Column("policy_category", sa.String(48), nullable=True),
        sa.Column("safety_result", sa.String(32), nullable=False),
        sa.Column("retrieval_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("top_retrieval_score", sa.Float(), nullable=True),
        sa.Column("feedback", sa.String(24), nullable=True),
        sa.Column("error_category", sa.String(48), nullable=True),
        sa.Column("exporters", sa.Text(), nullable=False, server_default=""),
        sa.Column("payload", _json(), nullable=False),
    )
    op.create_table(
        "admin_audit_log",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("actor_user_id", sa.Uuid(), nullable=True),
        sa.Column("actor_name", sa.String(160), nullable=False),
        sa.Column("action", sa.String(64), nullable=False, index=True),
        sa.Column("entity_type", sa.String(48), nullable=False),
        sa.Column("entity_id", sa.String(64), nullable=True),
        sa.Column("details", _json(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    for table in ("admin_audit_log", "ai_trace_events", "companion_feedback", "companion_message_sources", "companion_messages",
                  "companion_policy_decisions", "companion_conversations", "companion_settings"):
        op.drop_table(table)
