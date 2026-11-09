"""Replies to a request: what the console actually sent back, and whether it
arrived.

A reply belongs to the request, not to an account — a Help question from the
public site has no account at all — so the delivery result is recorded here
rather than in the account-scoped notification outbox.
"""

from alembic import op
import sqlalchemy as sa


revision = "20261109_0016"
down_revision = "20261109_0015"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "member_request_replies",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("request_id", sa.Uuid(), sa.ForeignKey("member_requests.id", ondelete="CASCADE"), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("to_email", sa.String(320), nullable=False),
        sa.Column("sent_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("sent_by_name", sa.String(160), nullable=False, server_default=""),
        # sent | failed — kept so a reply that never left is visible as such.
        sa.Column("delivery_status", sa.String(16), nullable=False, server_default="sent"),
        sa.Column("delivery_detail", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_member_request_replies_request_id", "member_request_replies", ["request_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_member_request_replies_request_id", table_name="member_request_replies")
    op.drop_table("member_request_replies")
