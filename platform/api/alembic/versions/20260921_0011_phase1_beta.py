"""Phase 1 local beta: profile photo columns, Requests & Inbox, Mood Tracker,
Food Diary and product settings."""

from alembic import op
import sqlalchemy as sa


revision = "20260921_0011"
down_revision = "20260919_0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("user_accounts") as batch:
        batch.add_column(sa.Column("photo_object_key", sa.String(300), nullable=True))
        batch.add_column(sa.Column("photo_content_type", sa.String(80), nullable=True))
        batch.add_column(sa.Column("photo_updated_at", sa.DateTime(timezone=True), nullable=True))

    op.create_table(
        "member_requests",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("kind", sa.String(24), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="new"),
        sa.Column("source", sa.String(16), nullable=False, server_default="public"),
        sa.Column("member_id", sa.Uuid(), sa.ForeignKey("members.id", ondelete="SET NULL"), nullable=True),
        sa.Column("name", sa.String(160), nullable=False, server_default=""),
        sa.Column("email", sa.String(320), nullable=False, server_default=""),
        sa.Column("subject", sa.String(200), nullable=False, server_default=""),
        sa.Column("message", sa.Text(), nullable=False, server_default=""),
        sa.Column("page", sa.String(200), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("handled_by", sa.String(160), nullable=True),
        sa.Column("handled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolution_note", sa.Text(), nullable=False, server_default=""),
    )
    op.create_index("ix_member_requests_kind", "member_requests", ["kind"])
    op.create_index("ix_member_requests_status", "member_requests", ["status"])
    op.create_index("ix_member_requests_member_id", "member_requests", ["member_id"])

    op.create_table(
        "mood_entries",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("member_id", sa.Uuid(), sa.ForeignKey("members.id", ondelete="CASCADE"), nullable=False),
        sa.Column("entry_date", sa.Date(), nullable=False),
        sa.Column("mood", sa.String(16), nullable=False),
        sa.Column("note", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("member_id", "entry_date", name="uq_mood_entries_member_day"),
    )
    op.create_index("ix_mood_entries_member_id", "mood_entries", ["member_id"])
    op.create_index("ix_mood_entries_entry_date", "mood_entries", ["entry_date"])

    op.create_table(
        "food_diary_entries",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("member_id", sa.Uuid(), sa.ForeignKey("members.id", ondelete="CASCADE"), nullable=False),
        sa.Column("entry_date", sa.Date(), nullable=False),
        sa.Column("meal_time", sa.String(5), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("feelings", sa.JSON(), nullable=False),
        sa.Column("notes", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_food_diary_entries_member_id", "food_diary_entries", ["member_id"])
    op.create_index("ix_food_diary_entries_entry_date", "food_diary_entries", ["entry_date"])

    op.create_table(
        "product_settings",
        sa.Column("key", sa.String(64), primary_key=True),
        sa.Column("value", sa.JSON(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_by", sa.String(160), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("product_settings")
    op.drop_index("ix_food_diary_entries_entry_date", table_name="food_diary_entries")
    op.drop_index("ix_food_diary_entries_member_id", table_name="food_diary_entries")
    op.drop_table("food_diary_entries")
    op.drop_index("ix_mood_entries_entry_date", table_name="mood_entries")
    op.drop_index("ix_mood_entries_member_id", table_name="mood_entries")
    op.drop_table("mood_entries")
    op.drop_index("ix_member_requests_member_id", table_name="member_requests")
    op.drop_index("ix_member_requests_status", table_name="member_requests")
    op.drop_index("ix_member_requests_kind", table_name="member_requests")
    op.drop_table("member_requests")
    with op.batch_alter_table("user_accounts") as batch:
        batch.drop_column("photo_updated_at")
        batch.drop_column("photo_content_type")
        batch.drop_column("photo_object_key")
