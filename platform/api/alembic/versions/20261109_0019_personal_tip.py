"""The dashboard's Personal tip, cached per member.

One row per member, rewritten in place. `context_fingerprint` is a hash of the
summaries the tip was written from, so a tip is regenerated when the member's
own data moves rather than on every page render.
"""

from alembic import op
import sqlalchemy as sa


revision = "20261109_0019"
down_revision = "20261109_0018"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "member_personal_tips",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("member_id", sa.Uuid(), sa.ForeignKey("members.id", ondelete="CASCADE"), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("context_fingerprint", sa.String(64), nullable=False, server_default=""),
        sa.Column("tip_version", sa.String(64), nullable=False, server_default=""),
        sa.Column("provider", sa.String(32), nullable=False, server_default=""),
        sa.Column("generated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_member_personal_tips_member_id", "member_personal_tips", ["member_id"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_member_personal_tips_member_id", table_name="member_personal_tips")
    op.drop_table("member_personal_tips")
