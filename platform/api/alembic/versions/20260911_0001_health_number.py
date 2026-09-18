"""Create the first VEYE member and Health Number tables."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20260911_0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # pgvector remains reserved for the production PostgreSQL deployment. The
    # isolated SQLite test fixture intentionally has no extension support.
    is_postgresql = op.get_bind().dialect.name == "postgresql"
    if is_postgresql:
        op.execute("CREATE EXTENSION IF NOT EXISTS vector;")
    op.create_table(
        "members",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("email", sa.String(320), nullable=False, unique=True),
        sa.Column("display_name", sa.String(120), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "health_number_attempts",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("member_id", sa.Uuid(), sa.ForeignKey("members.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("answers", postgresql.JSONB(astext_type=sa.Text()) if is_postgresql else sa.JSON(), nullable=False),
        sa.Column("raw_score", sa.Numeric(4, 1), nullable=False),
        sa.Column("displayed_score", sa.Numeric(3, 1), nullable=False),
        sa.Column("category", sa.String(24), nullable=False),
        sa.Column("interpretation", sa.Text(), nullable=False),
        sa.Column("calculation_version", sa.String(24), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("health_number_attempts")
    op.drop_table("members")
