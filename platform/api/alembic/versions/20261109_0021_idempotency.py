"""Idempotency records: a retried POST must not send a second email.

The unique constraint on (scope, idempotency_key) is the mechanism, and it is
claimed BEFORE the side effect so it prevents damage rather than reporting it.
A row with a NULL entity_id is an attempt still in flight.
"""

from alembic import op
import sqlalchemy as sa


revision = "20261109_0021"
down_revision = "20261109_0020"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "idempotency_records",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("scope", sa.String(48), nullable=False),
        sa.Column("idempotency_key", sa.String(128), nullable=False),
        sa.Column("subject", sa.String(128), nullable=False),
        sa.Column("entity_id", sa.String(64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("scope", "idempotency_key", name="uq_idempotency_scope_key"),
    )


def downgrade() -> None:
    op.drop_table("idempotency_records")
