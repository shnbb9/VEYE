"""Food Diary: a photo for each meal.

The prototype's "Snap a photo", "Choose file" and "Meal photo url" controls
were placeholders marked In Development; the owner asked on 15 Nov 2026 for
them to work. A meal keeps one photo: the object key and type are stored
here, the bytes in object storage (never in the database).

Backward compatible with the revision still serving: three nullable columns.
"""

from alembic import op
import sqlalchemy as sa


revision = "20261115_0029"
down_revision = "20261115_0028"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("food_diary_entries", sa.Column("photo_object_key", sa.String(300), nullable=True))
    op.add_column("food_diary_entries", sa.Column("photo_content_type", sa.String(80), nullable=True))
    op.add_column("food_diary_entries", sa.Column("photo_updated_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("food_diary_entries", "photo_updated_at")
    op.drop_column("food_diary_entries", "photo_content_type")
    op.drop_column("food_diary_entries", "photo_object_key")
