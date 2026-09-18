"""Guided flows: versioned decision-tree definitions and per-member sessions
(Cara's Intro and Progress Trackers decision trees)."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20260918_0008"
down_revision = "20260915_0007"
branch_labels = None
depends_on = None


def _json():
    return postgresql.JSONB(astext_type=sa.Text()) if op.get_bind().dialect.name == "postgresql" else sa.JSON()


def upgrade() -> None:
    op.create_table(
        "guided_flows",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("key", sa.String(64), nullable=False),
        sa.Column("title", sa.String(120), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("definition", _json(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="Draft"),
        sa.Column("source", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("published_by", sa.String(120), nullable=True),
        sa.UniqueConstraint("key", "version", name="uq_guided_flows_key_version"),
    )
    op.create_index("ix_guided_flows_key", "guided_flows", ["key"])
    op.create_table(
        "member_guided_flow_sessions",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("member_id", sa.Uuid(), sa.ForeignKey("members.id", ondelete="CASCADE"), nullable=False),
        sa.Column("flow_id", sa.Uuid(), sa.ForeignKey("guided_flows.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("flow_key", sa.String(64), nullable=False),
        sa.Column("flow_version", sa.Integer(), nullable=False),
        sa.Column("current_node", sa.String(64), nullable=False),
        sa.Column("answers", _json(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="in_progress"),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_member_guided_flow_sessions_member_id", "member_guided_flow_sessions", ["member_id"])
    op.create_index("ix_member_guided_flow_sessions_flow_id", "member_guided_flow_sessions", ["flow_id"])
    op.create_index("ix_member_guided_flow_sessions_flow_key", "member_guided_flow_sessions", ["flow_key"])


def downgrade() -> None:
    op.drop_index("ix_member_guided_flow_sessions_flow_key", table_name="member_guided_flow_sessions")
    op.drop_index("ix_member_guided_flow_sessions_flow_id", table_name="member_guided_flow_sessions")
    op.drop_index("ix_member_guided_flow_sessions_member_id", table_name="member_guided_flow_sessions")
    op.drop_table("member_guided_flow_sessions")
    op.drop_index("ix_guided_flows_key", table_name="guided_flows")
    op.drop_table("guided_flows")
