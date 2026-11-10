"""Food Choices: the member's checklist and a HOW TO plan.

`member_food_selections` is one row per member — the four client checklists,
plus the write-ins from each section's "Other: (write in)" row. A write-in is
recorded as the member wrote it and carries no tier and no portion, because
the source supplies those only for the foods on its own lists.

`member_how_to_plans` holds a HOW TO conversation as the state machine's JSON,
so a plan survives a reload. The newest row is the member's current plan;
`completed_at` records when the conversation reached its end rather than
hiding the finished day.
"""

from alembic import op
import sqlalchemy as sa


revision = "20261110_0022"
down_revision = "20261109_0021"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "member_food_selections",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("member_id", sa.Uuid(), sa.ForeignKey("members.id", ondelete="CASCADE"), nullable=False),
        # "woman" or "man"; empty until the member says, and never guessed.
        sa.Column("sex", sa.String(8), nullable=False, server_default=""),
        sa.Column("selections", sa.JSON(), nullable=False),
        sa.Column("write_ins", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("member_id", name="uq_member_food_selections_member"),
    )
    op.create_index("ix_member_food_selections_member_id", "member_food_selections", ["member_id"])

    op.create_table(
        "member_how_to_plans",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("member_id", sa.Uuid(), sa.ForeignKey("members.id", ondelete="CASCADE"), nullable=False),
        sa.Column("state", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_member_how_to_plans_member_id", "member_how_to_plans", ["member_id"])


def downgrade() -> None:
    op.drop_index("ix_member_how_to_plans_member_id", table_name="member_how_to_plans")
    op.drop_table("member_how_to_plans")
    op.drop_index("ix_member_food_selections_member_id", table_name="member_food_selections")
    op.drop_table("member_food_selections")
