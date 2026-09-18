"""Persist the result labels that were returned with each Health Number."""

from alembic import op
import sqlalchemy as sa


revision = "20260912_0002"
down_revision = "20260911_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("health_number_attempts", sa.Column("status", sa.String(48), nullable=True))
    op.add_column("health_number_attempts", sa.Column("bucket", sa.String(24), nullable=True))
    op.execute("""
        UPDATE health_number_attempts
        SET bucket = CASE
              WHEN displayed_score <= 1 THEN 'good'
              WHEN displayed_score <= 3.5 THEN 'relative'
              WHEN displayed_score <= 6 THEN 'moderate'
              ELSE 'high' END,
            status = CASE
              WHEN displayed_score <= 1 THEN 'Good Health'
              WHEN displayed_score <= 3.5 THEN 'Relatively Good Health'
              WHEN displayed_score <= 6 THEN 'Moderately Good Health'
              ELSE 'Insulin Resistance Risk' END
        WHERE status IS NULL OR bucket IS NULL
    """)
    if op.get_bind().dialect.name == "sqlite":
        with op.batch_alter_table("health_number_attempts") as batch_op:
            batch_op.alter_column("status", nullable=False)
            batch_op.alter_column("bucket", nullable=False)
    else:
        op.alter_column("health_number_attempts", "status", nullable=False)
        op.alter_column("health_number_attempts", "bucket", nullable=False)


def downgrade() -> None:
    op.drop_column("health_number_attempts", "bucket")
    op.drop_column("health_number_attempts", "status")
