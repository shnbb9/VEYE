"""Health-sharing requests that reach the member, and decisions bound to terms.

  * `member_health_permissions.request_ref` / `request_outbox_id`: the open
    request's opaque reference (carried by the emailed link, granting nothing)
    and the outbox row of the email that carried it;
  * `member_health_permission_events` gains the evidence of what exactly was
    agreed to: the published terms version and hash, and a snapshot of scope,
    purpose, recipient and expiry rule, plus the request reference.

Backward compatible with the revision still serving: new nullable columns only.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20261114_0025"
down_revision = "20261114_0024"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("member_health_permissions", sa.Column("request_ref", sa.String(64), nullable=True))
    op.add_column("member_health_permissions", sa.Column("request_outbox_id", sa.Uuid(), nullable=True))
    op.create_index("ix_member_health_permissions_request_ref", "member_health_permissions", ["request_ref"])
    events = "member_health_permission_events"
    op.add_column(events, sa.Column("terms_version", sa.Integer(), nullable=True))
    op.add_column(events, sa.Column("terms_hash", sa.String(64), nullable=True))
    op.add_column(events, sa.Column("scope", sa.JSON().with_variant(postgresql.JSONB(), "postgresql"), nullable=True))
    op.add_column(events, sa.Column("purpose", sa.Text(), nullable=True))
    op.add_column(events, sa.Column("recipient", sa.String(160), nullable=True))
    op.add_column(events, sa.Column("expiry_rule", sa.String(120), nullable=True))
    op.add_column(events, sa.Column("request_ref", sa.String(64), nullable=True))


def downgrade() -> None:
    events = "member_health_permission_events"
    for column in ("request_ref", "expiry_rule", "recipient", "purpose", "scope", "terms_hash", "terms_version"):
        op.drop_column(events, column)
    op.drop_index("ix_member_health_permissions_request_ref", table_name="member_health_permissions")
    op.drop_column("member_health_permissions", "request_outbox_id")
    op.drop_column("member_health_permissions", "request_ref")
