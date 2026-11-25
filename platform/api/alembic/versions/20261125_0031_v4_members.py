"""V4 (Cara's 15 and 25 Nov feedback): archive, member invitations, question
importance, resolved Sprout conversations, activity days, assessment starts.

Also corrects a fault: inviting someone as an administrator used to grant
console access at once. Access now starts when the invitation is accepted, so
every invitation still waiting loses the access it should not have had.

Backward compatible with the revision still serving: new tables and nullable
columns only.
"""

from alembic import op
import sqlalchemy as sa


revision = "20261125_0031"
down_revision = "20261115_0030"
branch_labels = None
depends_on = None

OPEN = sa.text("accepted_at IS NULL AND revoked_at IS NULL")


def upgrade() -> None:
    op.execute(sa.text("UPDATE user_accounts SET admin_access = false "
                       "WHERE admin_access AND invited_at IS NOT NULL AND invitation_accepted_at IS NULL"))
    op.add_column("members", sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("members", sa.Column("archived_by", sa.String(160), nullable=True))
    op.add_column("members", sa.Column("archive_reason", sa.String(300), nullable=True))
    op.add_column("member_requests", sa.Column("priority", sa.String(16), nullable=True))
    op.add_column("companion_conversations", sa.Column("priority", sa.String(16), nullable=True))
    op.add_column("companion_conversations", sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("companion_conversations", sa.Column("resolved_by", sa.String(120), nullable=True))
    op.create_table(
        "member_invitations",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("email", sa.String(320), nullable=False),
        sa.Column("first_name", sa.String(120), nullable=False, server_default=""),
        sa.Column("last_name", sa.String(120), nullable=False, server_default=""),
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("invited_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("invited_by_name", sa.String(160), nullable=False, server_default=""),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("sent_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("outbox_id", sa.Uuid(), nullable=True),
        sa.Column("member_id", sa.Uuid(), sa.ForeignKey("members.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("uq_member_invitations_open_email", "member_invitations", ["email"], unique=True,
                    sqlite_where=OPEN, postgresql_where=OPEN)
    op.create_index("ix_member_invitations_created_at", "member_invitations", ["created_at"])
    op.create_table(
        "member_activity_days",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("member_id", sa.Uuid(), sa.ForeignKey("members.id", ondelete="CASCADE"), nullable=False),
        sa.Column("day", sa.Date(), nullable=False),
        sa.UniqueConstraint("member_id", "day", name="uq_member_activity_days"),
    )
    op.create_index("ix_member_activity_days_member_id", "member_activity_days", ["member_id"])
    op.create_index("ix_member_activity_days_day", "member_activity_days", ["day"])
    op.create_table(
        "member_assessment_starts",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("member_id", sa.Uuid(), sa.ForeignKey("members.id", ondelete="CASCADE"), nullable=False),
        sa.Column("instrument", sa.String(32), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_member_assessment_starts_lookup", "member_assessment_starts",
                    ["member_id", "instrument", "started_at"])


def downgrade() -> None:
    op.drop_table("member_assessment_starts")
    op.drop_table("member_activity_days")
    op.drop_table("member_invitations")
    for column in ("resolved_by", "resolved_at", "priority"):
        op.drop_column("companion_conversations", column)
    op.drop_column("member_requests", "priority")
    for column in ("archive_reason", "archived_by", "archived_at"):
        op.drop_column("members", column)
