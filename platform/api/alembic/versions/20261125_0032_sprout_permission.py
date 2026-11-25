"""Sprout personalization becomes its own choice (owner decision, 25 Nov 2026).

New tables only, and nobody is carried over: sharing with the Veye team used to
cover Sprout as well, and that yes is not a yes to this. Every member starts
switched off.

`companion_messages.personal` marks a reply written with the member's health
information in front of Sprout, so the console can withhold it from a team the
member does not share with. Earlier replies are marked if they listed any
health topic at all: some of those were written without the information, but
hiding one too many is the safe side of that mistake.

The Personal tips on file were written from health information under the old
combined choice, so they are removed. They are rewritten for a member who
switches Sprout personalization on.

Backward compatible with the revision still serving: new tables, and a column
with a default.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20261125_0032"
down_revision = "20261125_0031"
branch_labels = None
depends_on = None

Json = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")


def upgrade() -> None:
    op.create_table(
        "member_sprout_permissions",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("member_id", sa.Uuid(), sa.ForeignKey("members.id", ondelete="CASCADE"), nullable=False),
        sa.Column("state", sa.String(16), nullable=False, server_default="off"),
        sa.Column("policy_version", sa.String(64), nullable=False, server_default=""),
        sa.Column("authorized_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_member_sprout_permissions_member_id", "member_sprout_permissions", ["member_id"], unique=True)
    op.create_table(
        "member_sprout_permission_events",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("permission_id", sa.Uuid(), sa.ForeignKey("member_sprout_permissions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("member_id", sa.Uuid(), nullable=False),
        sa.Column("from_state", sa.String(16), nullable=False),
        sa.Column("to_state", sa.String(16), nullable=False),
        sa.Column("actor_user_id", sa.Uuid(), nullable=True),
        sa.Column("actor_name", sa.String(160), nullable=False, server_default=""),
        sa.Column("source", sa.String(32), nullable=False, server_default="member_app"),
        sa.Column("policy_version", sa.String(64), nullable=False, server_default=""),
        sa.Column("terms_version", sa.Integer(), nullable=True),
        sa.Column("terms_hash", sa.String(64), nullable=True),
        sa.Column("scope", Json, nullable=True),
        sa.Column("purpose", sa.Text(), nullable=True),
        sa.Column("recipient", sa.String(160), nullable=True),
        sa.Column("expiry_rule", sa.String(120), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_member_sprout_permission_events_member", "member_sprout_permission_events",
                    ["member_id", "created_at"])
    op.add_column("companion_messages",
                  sa.Column("personal", sa.Boolean(), nullable=False, server_default=sa.false()))
    kind, length = (("jsonb_typeof", "jsonb_array_length") if op.get_bind().dialect.name == "postgresql"
                    else ("json_type", "json_array_length"))
    op.execute(sa.text("UPDATE companion_messages SET personal = true WHERE role = 'sprout' AND "
                       f"CASE WHEN {kind}(context_scopes) = 'array' THEN {length}(context_scopes) > 0 ELSE false END"))
    op.execute(sa.text("DELETE FROM member_personal_tips"))


def downgrade() -> None:
    op.drop_column("companion_messages", "personal")
    op.drop_table("member_sprout_permission_events")
    op.drop_table("member_sprout_permissions")
