"""Profile pictures keep their original and the person's own crop.

A picture used to be shrunk to 512 px on its long side and nothing else was
kept; every screen then centred it in a circle. The owner asked on 15 Nov
2026 for the crop to be the person's: they choose a square in a circular
frame, the avatar is cut from exactly that square, and the original stays so
the picture can be re-cropped without a new upload.

Backward compatible with the revision still serving: six nullable columns.
A picture saved before this revision has no original and cannot be
re-cropped; it keeps showing as it did.
"""

from alembic import op
import sqlalchemy as sa


revision = "20261115_0028"
down_revision = "20261115_0027"
branch_labels = None
depends_on = None

COLUMNS = (
    ("photo_original_key", sa.String(300)),
    ("photo_original_width", sa.Integer()),
    ("photo_original_height", sa.Integer()),
    ("photo_crop_x", sa.Integer()),
    ("photo_crop_y", sa.Integer()),
    ("photo_crop_size", sa.Integer()),
)


def upgrade() -> None:
    for name, kind in COLUMNS:
        op.add_column("user_accounts", sa.Column(name, kind, nullable=True))


def downgrade() -> None:
    for name, _ in reversed(COLUMNS):
        op.drop_column("user_accounts", name)
