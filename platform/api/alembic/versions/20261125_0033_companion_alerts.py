"""What the team has already been told about a conversation that is waiting.

`alerted` is how grave the worst of it is and, per kind of worry (the member
themselves, a body, somebody they are worried about, the approved list), how
grave the last email was and when it went. Suppressing a repeat used to be
worked out from everything the conversation had ever held, so last month's could
keep this month's from being sent.

Also: a reply a model wrote after one written from the member's health
information may repeat it, because earlier turns used to be in the prompt
whatever they held. Those are marked personal too.

Backward compatible with the revision still serving: one column, with a default.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20261125_0033"
down_revision = "20261125_0032"
branch_labels = None
depends_on = None

Json = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")


def upgrade() -> None:
    op.add_column("companion_conversations", sa.Column("alerted", Json, nullable=False, server_default="{}"))
    op.execute(sa.text(
        "UPDATE companion_messages SET personal = true WHERE role = 'sprout' AND provider IS NOT NULL AND EXISTS ("
        "SELECT 1 FROM companion_messages AS earlier WHERE earlier.conversation_id = companion_messages.conversation_id "
        "AND earlier.role = 'sprout' AND earlier.personal = true AND earlier.created_at < companion_messages.created_at)"))


def downgrade() -> None:
    op.drop_column("companion_conversations", "alerted")
