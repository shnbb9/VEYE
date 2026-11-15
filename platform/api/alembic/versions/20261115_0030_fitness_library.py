"""The Fitness library: videos the console adds to the member Fitness screen.

The owner asked on 15 Nov 2026 for the screen's "library preview" (four goal
tabs, a big player and rows of three) to become real: the console pastes
YouTube or Vimeo links per goal, picks one main video per goal, and members
page through the rest nine at a time. Links only — never video bytes.

Backward compatible with the revision still serving: one new table.
"""

from alembic import op
import sqlalchemy as sa


revision = "20261115_0030"
down_revision = "20261115_0029"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "fitness_videos",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("goal", sa.String(24), nullable=False),
        sa.Column("provider", sa.String(16), nullable=False),
        sa.Column("video_id", sa.String(64), nullable=False),
        sa.Column("video_hash", sa.String(64), nullable=True),
        sa.Column("url", sa.String(500), nullable=False),
        sa.Column("title", sa.String(160), nullable=False),
        sa.Column("subtitle", sa.String(200), nullable=False, server_default=""),
        sa.Column("thumbnail_url", sa.String(500), nullable=True),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_main", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("published", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_by", sa.String(160), nullable=True),
        sa.UniqueConstraint("goal", "provider", "video_id", name="uq_fitness_videos_goal_video"),
    )
    op.create_index("ix_fitness_videos_goal", "fitness_videos", ["goal"])
    # One main video per goal, held by the database as well as the service.
    op.create_index("uq_fitness_videos_main", "fitness_videos", ["goal"], unique=True,
                    sqlite_where=sa.text("is_main"), postgresql_where=sa.text("is_main"))


def downgrade() -> None:
    op.drop_index("uq_fitness_videos_main", table_name="fitness_videos")
    op.drop_index("ix_fitness_videos_goal", table_name="fitness_videos")
    op.drop_table("fitness_videos")
