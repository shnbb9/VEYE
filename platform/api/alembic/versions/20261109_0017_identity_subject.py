"""Link a VEYE account to its Google Identity Platform subject.

Authentication moves to Identity Platform; authorization does not move
anywhere. These two columns record only *which* Google identity signs in as
this account — `member_id` and `admin_access` stay exactly where they are and
stay the whole of what the account may do.

Nullable because the development provider needs none of it, and unique because
one Google identity is one VEYE account.
"""

from alembic import op
import sqlalchemy as sa


revision = "20261109_0017"
down_revision = "20261109_0016"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("user_accounts", sa.Column("identity_subject", sa.String(128), nullable=True))
    op.add_column("user_accounts", sa.Column("identity_linked_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_user_accounts_identity_subject", "user_accounts", ["identity_subject"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_user_accounts_identity_subject", table_name="user_accounts")
    op.drop_column("user_accounts", "identity_linked_at")
    op.drop_column("user_accounts", "identity_subject")
