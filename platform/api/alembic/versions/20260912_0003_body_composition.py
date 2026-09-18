"""Persist deterministic Body Composition attempts."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20260912_0003"
down_revision = "20260912_0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    measurement_type = postgresql.JSONB(astext_type=sa.Text()) if op.get_bind().dialect.name == "postgresql" else sa.JSON()
    op.create_table(
        "body_composition_attempts",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("member_id", sa.Uuid(), sa.ForeignKey("members.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("measurements", measurement_type, nullable=False),
        sa.Column("sex", sa.String(12), nullable=False),
        sa.Column("bmi", sa.Numeric(4, 1), nullable=True),
        sa.Column("body_fat_percent", sa.Integer(), nullable=True),
        sa.Column("fat_mass_lb", sa.Numeric(5, 1), nullable=True),
        sa.Column("lean_mass_lb", sa.Numeric(5, 1), nullable=True),
        sa.Column("unavailable_reason", sa.Text(), nullable=True),
        sa.Column("calculation_version", sa.String(24), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("body_composition_attempts")
