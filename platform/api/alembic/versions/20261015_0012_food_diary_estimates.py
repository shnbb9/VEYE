"""Food Diary parity with the approved prototype: the prototype macro estimate
stored with each entry, and the day's Save (food_diary_days)."""

from alembic import op
import sqlalchemy as sa


revision = "20261015_0012"
down_revision = "20260921_0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("food_diary_entries") as batch:
        batch.add_column(sa.Column("protein_g", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("carbs_g", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("fat_g", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("kcal", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("estimate_version", sa.String(24), nullable=True))

    op.create_table(
        "food_diary_days",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("member_id", sa.Uuid(), sa.ForeignKey("members.id", ondelete="CASCADE"), nullable=False),
        sa.Column("entry_date", sa.Date(), nullable=False),
        sa.Column("saved_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("member_id", "entry_date", name="uq_food_diary_days_member_date"),
    )
    op.create_index("ix_food_diary_days_member_id", "food_diary_days", ["member_id"])


def downgrade() -> None:
    op.drop_index("ix_food_diary_days_member_id", table_name="food_diary_days")
    op.drop_table("food_diary_days")
    with op.batch_alter_table("food_diary_entries") as batch:
        batch.drop_column("estimate_version")
        batch.drop_column("kcal")
        batch.drop_column("fat_g")
        batch.drop_column("carbs_g")
        batch.drop_column("protein_g")
