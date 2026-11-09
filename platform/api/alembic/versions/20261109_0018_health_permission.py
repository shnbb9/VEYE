"""Health Data Sharing Permission: what is true now, and how it got that way.

The member decides whether the Veye team may open their health records. Until
they do, the console is not sent them. Two tables: the current state per
member, and an append-only record of every transition, which is the evidence
that the member was asked and answered.
"""

from alembic import op
import sqlalchemy as sa


revision = "20261109_0018"
down_revision = "20261109_0017"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "member_health_permissions",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("member_id", sa.Uuid(), sa.ForeignKey("members.id", ondelete="CASCADE"), nullable=False),
        # not_requested | requested | granted | declined | revoked
        sa.Column("state", sa.String(16), nullable=False, server_default="not_requested"),
        sa.Column("policy_version", sa.String(64), nullable=False, server_default=""),
        sa.Column("requested_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("requested_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("requested_by_name", sa.String(160), nullable=False, server_default=""),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_member_health_permissions_member_id", "member_health_permissions", ["member_id"], unique=True)

    op.create_table(
        "member_health_permission_events",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("permission_id", sa.Uuid(), sa.ForeignKey("member_health_permissions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("member_id", sa.Uuid(), nullable=False),
        sa.Column("from_state", sa.String(16), nullable=False),
        sa.Column("to_state", sa.String(16), nullable=False),
        sa.Column("actor", sa.String(16), nullable=False),
        sa.Column("actor_user_id", sa.Uuid(), nullable=True),
        sa.Column("actor_name", sa.String(160), nullable=False, server_default=""),
        sa.Column("source", sa.String(32), nullable=False, server_default="member_app"),
        sa.Column("policy_version", sa.String(64), nullable=False, server_default=""),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_member_health_permission_events_member", "member_health_permission_events",
                    ["member_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_member_health_permission_events_member", table_name="member_health_permission_events")
    op.drop_table("member_health_permission_events")
    op.drop_index("ix_member_health_permissions_member_id", table_name="member_health_permissions")
    op.drop_table("member_health_permissions")
