"""Sign-in attempts: the record brute-force protection counts.

One row per attempt, kept only long enough to answer "how many failures from
this identity / this address in the last window". Housekeeping prunes them;
nothing else reads them.
"""

from alembic import op
import sqlalchemy as sa


revision = "20261109_0015"
down_revision = "20261109_0014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "auth_sign_in_attempts",
        sa.Column("id", sa.Uuid(), primary_key=True),
        # The address as it was typed (normalised). It is not a foreign key:
        # attempts against an address that does not exist must be counted too.
        sa.Column("email", sa.String(320), nullable=False),
        sa.Column("client_ip", sa.String(64), nullable=False, server_default=""),
        sa.Column("portal", sa.String(16), nullable=False),
        sa.Column("succeeded", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_auth_sign_in_attempts_email", "auth_sign_in_attempts", ["email", "created_at"])
    op.create_index("ix_auth_sign_in_attempts_ip", "auth_sign_in_attempts", ["client_ip", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_auth_sign_in_attempts_ip", table_name="auth_sign_in_attempts")
    op.drop_index("ix_auth_sign_in_attempts_email", table_name="auth_sign_in_attempts")
    op.drop_table("auth_sign_in_attempts")
