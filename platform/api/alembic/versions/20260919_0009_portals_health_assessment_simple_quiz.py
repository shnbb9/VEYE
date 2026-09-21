"""Portal-aware authentication (administrator access as an account fact,
one session row per portal) and the Health Assessment + Simple Quiz
production slices."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20260919_0009"
down_revision = "20260918_0008"
branch_labels = None
depends_on = None


def _json():
    return postgresql.JSONB(astext_type=sa.Text()) if op.get_bind().dialect.name == "postgresql" else sa.JSON()


def upgrade() -> None:
    # ---- accounts: admin access is a fact, not a routing rule -------------------
    op.add_column("user_accounts", sa.Column("admin_access", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.execute("UPDATE user_accounts SET admin_access = TRUE WHERE role = 'admin'")

    # ---- sessions: each belongs to exactly one portal -----------------------------
    op.add_column("auth_sessions", sa.Column("portal", sa.String(16), nullable=False, server_default="member"))
    op.execute(
        "UPDATE auth_sessions SET portal = 'admin' WHERE user_id IN (SELECT id FROM user_accounts WHERE role = 'admin')"
    )

    # ---- Health Assessment ------------------------------------------------------------
    op.create_table(
        "health_assessment_attempts",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("member_id", sa.Uuid(), sa.ForeignKey("members.id", ondelete="CASCADE"), nullable=False),
        sa.Column("answers", _json(), nullable=False),
        sa.Column("total", sa.Integer(), nullable=False),
        sa.Column("bucket", sa.String(24), nullable=False),
        sa.Column("status", sa.String(48), nullable=False),
        sa.Column("interpretation", sa.Text(), nullable=False),
        sa.Column("epa_dha_dose", sa.String(16), nullable=False),
        sa.Column("calculation_version", sa.String(40), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_health_assessment_attempts_member_id", "health_assessment_attempts", ["member_id"])

    # ---- Simple Quiz ---------------------------------------------------------------------
    op.create_table(
        "simple_quiz_attempts",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("member_id", sa.Uuid(), sa.ForeignKey("members.id", ondelete="CASCADE"), nullable=False),
        sa.Column("answers", _json(), nullable=False),
        sa.Column("yes_count", sa.Integer(), nullable=False),
        sa.Column("no_count", sa.Integer(), nullable=False),
        sa.Column("calculation_version", sa.String(40), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_simple_quiz_attempts_member_id", "simple_quiz_attempts", ["member_id"])


def downgrade() -> None:
    op.drop_index("ix_simple_quiz_attempts_member_id", table_name="simple_quiz_attempts")
    op.drop_table("simple_quiz_attempts")
    op.drop_index("ix_health_assessment_attempts_member_id", table_name="health_assessment_attempts")
    op.drop_table("health_assessment_attempts")
    op.drop_column("auth_sessions", "portal")
    op.drop_column("user_accounts", "admin_access")
