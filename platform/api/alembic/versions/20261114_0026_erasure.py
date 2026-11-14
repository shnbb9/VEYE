"""Permanent deletion of a member profile (architecture V2 §6).

  * `erasure_requests` — the minimal record that a deletion happened: subject
    ids, scope, state, stage, attempts, failure category and counts of what
    was removed. Never a health value.
  * `members.erasure_requested_at` — set the moment deletion is requested, so
    nothing reads the profile while the purge runs.

Backward compatible with the revision still serving: a new table and a new
nullable column.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20261114_0026"
down_revision = "20261114_0025"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("members", sa.Column("erasure_requested_at", sa.DateTime(timezone=True), nullable=True))
    op.create_table(
        "erasure_requests",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("subject_user_id", sa.Uuid(), nullable=False),
        sa.Column("subject_member_id", sa.Uuid(), nullable=False),
        sa.Column("scope", sa.String(24), nullable=False),
        sa.Column("state", sa.String(24), nullable=False, server_default="requested"),
        sa.Column("requested_via", sa.String(24), nullable=False, server_default="member_app"),
        sa.Column("policy_version", sa.String(64), nullable=False, server_default=""),
        sa.Column("requested_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("stage", sa.String(32), nullable=False, server_default=""),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("failure_category", sa.String(64), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("receipt", sa.JSON().with_variant(postgresql.JSONB(), "postgresql"), nullable=False),
        sa.Column("receipt_email", sa.String(320), nullable=True),
        sa.Column("receipt_outbox_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_erasure_requests_subject_user_id", "erasure_requests", ["subject_user_id"])
    op.create_index("ix_erasure_requests_subject_member_id", "erasure_requests", ["subject_member_id"])
    op.create_index("ix_erasure_requests_state", "erasure_requests", ["state", "requested_at"])


def downgrade() -> None:
    op.drop_index("ix_erasure_requests_state", table_name="erasure_requests")
    op.drop_index("ix_erasure_requests_subject_member_id", table_name="erasure_requests")
    op.drop_index("ix_erasure_requests_subject_user_id", table_name="erasure_requests")
    op.drop_table("erasure_requests")
    op.drop_column("members", "erasure_requested_at")
