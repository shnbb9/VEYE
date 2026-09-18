"""Persist deterministic Blood Test Marker entries."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20260914_0004"
down_revision = "20260912_0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    json_type = postgresql.JSONB(astext_type=sa.Text()) if op.get_bind().dialect.name == "postgresql" else sa.JSON()
    op.create_table(
        "blood_marker_attempts",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("member_id", sa.Uuid(), sa.ForeignKey("members.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("markers", json_type, nullable=False),
        sa.Column("tg_hdl", sa.Numeric(10, 4), nullable=True),
        sa.Column("homa_ir", sa.Numeric(10, 4), nullable=True),
        sa.Column("aa_epa", sa.Numeric(10, 4), nullable=True),
        sa.Column("aa_epa_source", sa.String(16), nullable=True),
        sa.Column("results", json_type, nullable=False),
        sa.Column("calculation_version", sa.String(24), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("blood_marker_attempts")
