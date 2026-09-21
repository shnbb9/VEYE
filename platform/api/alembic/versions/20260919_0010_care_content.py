"""Care Studio content items (Fitness, Supplements, Resources metadata) and
the Content entries (Help / FAQ, member educational copy)."""

from alembic import op
import sqlalchemy as sa


revision = "20260919_0010"
down_revision = "20260919_0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "care_content_items",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("kind", sa.String(24), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("category", sa.String(80), nullable=True),
        sa.Column("content_type", sa.String(24), nullable=False, server_default="copy"),
        sa.Column("youtube_url", sa.String(300), nullable=True),
        sa.Column("external_url", sa.String(500), nullable=True),
        sa.Column("video_object_key", sa.String(300), nullable=True),
        sa.Column("body", sa.Text(), nullable=False, server_default=""),
        sa.Column("cautions", sa.Text(), nullable=True),
        sa.Column("references", sa.Text(), nullable=True),
        sa.Column("display_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("status", sa.String(16), nullable=False, server_default="Draft"),
        sa.Column("source", sa.String(200), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_by", sa.String(160), nullable=True),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("published_by", sa.String(160), nullable=True),
    )
    op.create_index("ix_care_content_items_kind", "care_content_items", ["kind"])
    op.create_index("ix_care_content_items_status", "care_content_items", ["status"])

    op.create_table(
        "content_entries",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("group", sa.String(32), nullable=False),
        sa.Column("key", sa.String(80), nullable=False),
        sa.Column("category", sa.String(80), nullable=True),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("body", sa.Text(), nullable=False, server_default=""),
        sa.Column("display_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("status", sa.String(16), nullable=False, server_default="Draft"),
        sa.Column("source", sa.String(200), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_by", sa.String(160), nullable=True),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("published_by", sa.String(160), nullable=True),
        sa.UniqueConstraint("group", "key", name="uq_content_entries_group_key"),
    )
    op.create_index("ix_content_entries_group", "content_entries", ["group"])
    op.create_index("ix_content_entries_status", "content_entries", ["status"])


def downgrade() -> None:
    op.drop_index("ix_content_entries_status", table_name="content_entries")
    op.drop_index("ix_content_entries_group", table_name="content_entries")
    op.drop_table("content_entries")
    op.drop_index("ix_care_content_items_status", table_name="care_content_items")
    op.drop_index("ix_care_content_items_kind", table_name="care_content_items")
    op.drop_table("care_content_items")
