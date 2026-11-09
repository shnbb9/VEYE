"""Rate-limit events for the endpoints that cost money or send mail.

In the database rather than in a process: Cloud Run runs several instances,
and a limiter that lives in one of them limits one tenth of the traffic.

Nothing here is evidence, so housekeeping prunes it.
"""

from alembic import op
import sqlalchemy as sa


revision = "20261109_0020"
down_revision = "20261109_0019"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "rate_limit_events",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("bucket", sa.String(48), nullable=False),
        sa.Column("subject", sa.String(128), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_rate_limit_events_lookup", "rate_limit_events", ["bucket", "subject", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_rate_limit_events_lookup", table_name="rate_limit_events")
    op.drop_table("rate_limit_events")
