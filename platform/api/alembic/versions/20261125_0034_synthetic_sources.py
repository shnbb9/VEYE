"""A knowledge source is a demonstration only while everything in it is.

Until now the mark was set when a source was made and never looked at again, so
a document of the client's attached to a demonstration source still counted as
one, and could have gone out through a developer's key. Every source holding a
document that is not one of the seed's own loses the mark; and a source nobody
said it of does not have it.

Compatible with the revision still serving: it writes the column itself.
"""

from alembic import op
import sqlalchemy as sa


revision = "20261125_0034"
down_revision = "20261125_0033"
branch_labels = None
depends_on = None

# app/seed/knowledge_content, as it is and as it was.
SEED = (
    "8eaaf7ad88e98b60e35ee7112f162baac1052f1c47f91b769f8649d2738fcbbd",
    "51ffd871d9c7c9cb884138a35a66493e6f996fb39dad641b4904675be74f24e6",
    "cfe5ee5e566e76ec1cb32ce22b13da7beb4ae19a2b74f43714d27d856a8497b0",
    "d42770d37d2210e1119ac0c4afc13b44386aa23afa2d78ca305657331ee36fb2",
    "d200e1508cc788bfa4440cd5acf729da49b79c9045b2732f1a24300ca28acdff",
    "e395ea1ef1f5432c3d27471c293cc7d32841f5176368337be305b575a57f42a0",
)


def _default(value) -> None:
    if op.get_bind().dialect.name == "postgresql":
        op.alter_column("knowledge_sources", "is_synthetic", server_default=value)


def upgrade() -> None:
    known = ", ".join(f"'{sha256}'" for sha256 in SEED)
    op.execute(sa.text(
        "UPDATE knowledge_sources SET is_synthetic = false WHERE is_synthetic = true AND EXISTS ("
        "SELECT 1 FROM knowledge_documents WHERE knowledge_documents.source_id = knowledge_sources.id "
        f"AND knowledge_documents.sha256 NOT IN ({known}))"))
    _default(sa.false())


def downgrade() -> None:
    # The mark is not given back: nobody knows which of them had it wrongly.
    _default(sa.true())
