"""What the document reader took, and what it left behind.

Word files and PDFs carry things the index cannot: images, charts, pages that
are scans with no text layer. The reader records what it did in its own
column rather than in `ingestion_error`, because a note is not a failure and a
console that renders it as one teaches administrators to ignore the field.
"""

from alembic import op
import sqlalchemy as sa


revision = "20261114_0023"
down_revision = "20261110_0022"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("knowledge_documents", sa.Column("extraction_note", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("knowledge_documents", "extraction_note")
