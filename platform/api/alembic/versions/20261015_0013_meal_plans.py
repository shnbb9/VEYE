"""Meal Planning: the member's saved days (meal templates assignable to a
date), as the approved prototype keeps them."""

from alembic import op
import sqlalchemy as sa


revision = "20261015_0013"
down_revision = "20261015_0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "meal_plan_days",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("member_id", sa.Uuid(), sa.ForeignKey("members.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("notes", sa.Text(), nullable=False, server_default=""),
        sa.Column("describe", sa.Text(), nullable=False, server_default=""),
        sa.Column("mode", sa.String(16), nullable=False, server_default="manual"),
        sa.Column("meals", sa.JSON(), nullable=False),
        sa.Column("assigned_date", sa.Date(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_meal_plan_days_member_id", "meal_plan_days", ["member_id"])


def downgrade() -> None:
    op.drop_index("ix_meal_plan_days_member_id", table_name="meal_plan_days")
    op.drop_table("meal_plan_days")
