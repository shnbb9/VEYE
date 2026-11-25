"""Every mapped class, in one import.

Relationships name their target by string, so a process that imports only some
models fails the first time it touches the database: "expression 'Member'
failed to locate a name". The web application imports everything through its
routes; a command-line entry point does not. Import this from any process that
opens a session (migrations, jobs, seeding).
"""

from app.admin import models as admin_models  # noqa: F401
from app.assessments import models as assessment_models  # noqa: F401
from app.auth import models as auth_models  # noqa: F401
from app.auth import throttle as auth_throttle  # noqa: F401
from app.care import models as care_models  # noqa: F401
from app.companion import models as companion_models  # noqa: F401
from app.content import models as content_models  # noqa: F401
from app.core import idempotency as idempotency_models  # noqa: F401
from app.erasure import models as erasure_models  # noqa: F401
from app.fitness import models as fitness_models  # noqa: F401
from app.food import models as food_models  # noqa: F401
from app.food_choices import models as food_choice_models  # noqa: F401
from app.guided_flows import models as guided_flow_models  # noqa: F401
from app.health_permission import models as health_permission_models  # noqa: F401
from app.jobs import models as job_models  # noqa: F401
from app.knowledge import models as knowledge_models  # noqa: F401
from app.meal_plans import models as meal_plan_models  # noqa: F401
from app.members import activity as member_activity_models, invitations as member_invitation_models  # noqa: F401
from app.members import models as member_models  # noqa: F401
from app.mood import models as mood_models  # noqa: F401
from app.notifications import models as notification_models  # noqa: F401
from app.observability import models as observability_models  # noqa: F401
from app.policies import models as policy_models  # noqa: F401
from app.product_settings import models as product_setting_models  # noqa: F401
from app.progress import starts as assessment_start_models  # noqa: F401
from app.progress.blood_markers import models as blood_marker_models  # noqa: F401
from app.progress.body_composition import models as body_composition_models  # noqa: F401
from app.progress.health_assessment import models as health_assessment_models  # noqa: F401
from app.progress.simple_quiz import models as simple_quiz_models  # noqa: F401
from app.prospects import models as prospect_models  # noqa: F401
from app.requests import models as request_models  # noqa: F401
