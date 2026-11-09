"""Account administration: administrator invitations, deactivation and the
member's own pending email change.

No roles and no permission table: an administrator is still one boolean on the
account (`admin_access`). These columns only record how that access was
granted, whether the invitation has been accepted, and when an account was
switched off — the facts the Administrators page shows."""

from alembic import op
import sqlalchemy as sa


revision = "20261109_0014"
down_revision = "20261015_0013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("user_accounts", sa.Column("invited_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("user_accounts", sa.Column("invitation_accepted_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("user_accounts", sa.Column("invited_by_user_id", sa.Uuid(), nullable=True))
    op.add_column("user_accounts", sa.Column("deactivated_at", sa.DateTime(timezone=True), nullable=True))
    # The address a member asked to move to; it only becomes `email` once the
    # link sent to that address is used.
    op.add_column("user_accounts", sa.Column("pending_email", sa.String(320), nullable=True))
    op.create_index("ix_user_accounts_pending_email", "user_accounts", ["pending_email"])


def downgrade() -> None:
    op.drop_index("ix_user_accounts_pending_email", table_name="user_accounts")
    op.drop_column("user_accounts", "pending_email")
    op.drop_column("user_accounts", "deactivated_at")
    op.drop_column("user_accounts", "invited_by_user_id")
    op.drop_column("user_accounts", "invitation_accepted_at")
    op.drop_column("user_accounts", "invited_at")
