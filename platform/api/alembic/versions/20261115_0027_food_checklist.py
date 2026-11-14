"""Food Choices: the approved prototype's checklists.

`member_food_selections.checklist` holds what the member does on the Food
Choices screen the owner chose on 14 Nov 2026 — the prototype's four lists
(`app/food_choices/checklist.py`): ticked foods, the member's own foods with
their own Best / Fair / Limit label, and which category notes they have read.

Backward compatible with the revision still serving: one new column with a
server default, so existing rows read as an empty checklist.
"""

from alembic import op
import sqlalchemy as sa


revision = "20261115_0027"
down_revision = "20261114_0026"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("member_food_selections",
                  sa.Column("checklist", sa.JSON(), nullable=False, server_default=sa.text("'{}'")))


def downgrade() -> None:
    op.drop_column("member_food_selections", "checklist")
