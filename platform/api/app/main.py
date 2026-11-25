import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.exc import InterfaceError, OperationalError, TimeoutError as PoolTimeout

from app.admin.account_routes import peers_router as admin_peer_photos_router, router as admin_account_router
from app.admin.administrators_routes import router as admin_administrators_router
from app.admin.advanced_routes import router as admin_advanced_router
from app.admin.companion_routes import router as admin_companion_router
from app.admin.console_routes import router as admin_console_router
from app.admin.knowledge_routes import router as admin_knowledge_router
from app.assessments.routes import member_router, router as health_number_router
from app.auth.routes import router as auth_router
from app.care.routes import admin_router as admin_care_router, member_router as care_router
from app.fitness.routes import admin_router as admin_fitness_router, member_router as fitness_router
from app.companion.routes import router as companion_router
from app.content.routes import admin_router as admin_content_router, public_router as content_router
from app.auth.csrf import enforce as enforce_csrf, issue as issue_csrf
from app.core.config import settings
from app.core.runtime import get_runtime
from app.admin.qa_routes import router as admin_qa_router
from app.admin.attention_routes import router as admin_attention_router
from app.admin.member_lifecycle_routes import router as admin_member_lifecycle_router
from app.members.activity import router as member_activity_router
from app.members.invitation_routes import admin_router as admin_member_invitations_router, public_router as member_invitation_router
from app.progress.scales import router as progress_scales_router
from app.progress.starts import router as assessment_starts_router
from app.food.routes import router as food_diary_router
from app.food_choices.routes import router as food_choices_router
from app.meal_plans.routes import router as meal_plans_router
from app.members.routes import router as member_account_router
from app.mood.routes import router as mood_router
from app.product_settings.routes import admin_router as admin_settings_router, public_router as settings_router
from app.requests.routes import (
    admin_router as admin_requests_router,
    member_router as member_requests_router,
    public_router as requests_router,
)
from app.guided_flows.admin_routes import router as admin_guided_flows_router
from app.guided_flows.routes import router as guided_flows_router
from app.health_permission.routes import admin_router as health_permission_admin_router
from app.health_permission.routes import settings_router as health_sharing_settings_router
from app.health_permission.routes import member_router as health_permission_member_router
from app.erasure.routes import (
    admin_router as admin_erasure_router,
    member_router as member_erasure_router,
    public_router as erasure_status_router,
)
from app.prospects.routes import (
    admin_router as admin_prospects_router,
    member_router as member_saved_results_router,
    privacy_router as admin_privacy_settings_router,
    public_router as prospects_router,
)
from app.progress.blood_markers.routes import (
    member_router as blood_markers_member_router,
    router as blood_markers_router,
)
from app.progress.body_composition.routes import (
    member_router as body_composition_member_router,
    router as body_composition_router,
)
from app.progress.health_assessment.routes import (
    member_router as health_assessment_member_router,
    router as health_assessment_router,
)
from app.progress.simple_quiz.routes import (
    member_router as simple_quiz_member_router,
    router as simple_quiz_router,
)


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Provider absence never stops the API: an unconfigured LLM or a missing
    # Langfuse key becomes an honest status, not a boot failure.
    get_runtime()
    # The local stand-in for Cloud Scheduler (retention purge, outbox retries,
    # erasure processing). Off unless VEYE_JOBS_INTERVAL_SECONDS is set.
    loop = None
    if settings.jobs_interval_seconds and settings.jobs_interval_seconds > 0:
        from app.db.session import SessionLocal
        from app.jobs.runner import JobLoop

        loop = JobLoop(SessionLocal, settings.jobs_interval_seconds)
        loop.start()
    yield
    if loop is not None:
        loop.stop()


log = logging.getLogger("veye.api")

app = FastAPI(title=settings.app_name, version="0.2.0", lifespan=lifespan)


def _unexpected(request: Request, exc: Exception) -> JSONResponse:
    """What went wrong belongs in the log; the person gets words. Answered here,
    inside CORS: an exception left to Starlette is answered outside it, without
    the headers a browser needs to read it, and the page could only say
    "Failed to fetch"."""
    log.exception("unhandled error on %s %s", request.method, request.url.path)
    if isinstance(exc, (OperationalError, InterfaceError, PoolTimeout)):
        return JSONResponse(status_code=503, content={"detail": "Veye is not available right now. Please try again in a moment."},
                            headers={"Retry-After": "5"})
    return JSONResponse(status_code=500, content={"detail": "Something went wrong on our side. Please try again in a moment."})


@app.middleware("http")
async def csrf_and_headers(request: Request, call_next):
    """Two things every answer needs, in one pass.

    A state-changing request that carries a session cookie must also carry the
    token that only a same-origin page can read, and every response says it
    must not be sniffed, framed, or leaked through a referrer. The API serves
    JSON to one application, so these are safe to apply everywhere."""
    session_cookies = (settings.member_session_cookie_name, settings.admin_session_cookie_name)
    try:
        enforce_csrf(request, session_cookies)
    except HTTPException as exc:
        response = JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})
    else:
        try:
            response = await call_next(request)
        except Exception as exc:  # recorded and answered in words, never with what broke
            response = _unexpected(request, exc)
    issue_csrf(response, request, secure=settings.session_cookie_secure)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    response.headers.setdefault("Cache-Control", "no-store")
    if settings.session_cookie_secure:
        response.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
    return response


app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "X-Veye-Csrf"],
)
app.include_router(auth_router)
app.include_router(health_number_router)
app.include_router(member_router)
app.include_router(body_composition_router)
app.include_router(body_composition_member_router)
app.include_router(blood_markers_router)
app.include_router(blood_markers_member_router)
app.include_router(health_assessment_router)
app.include_router(health_assessment_member_router)
app.include_router(simple_quiz_router)
app.include_router(simple_quiz_member_router)
app.include_router(companion_router)
app.include_router(guided_flows_router)
app.include_router(admin_companion_router)
app.include_router(admin_guided_flows_router)
app.include_router(admin_knowledge_router)
app.include_router(admin_advanced_router)
app.include_router(admin_console_router)
app.include_router(admin_member_lifecycle_router)
app.include_router(admin_attention_router)
app.include_router(admin_member_invitations_router)
app.include_router(member_invitation_router)
app.include_router(member_activity_router)
app.include_router(assessment_starts_router)
app.include_router(progress_scales_router)
app.include_router(admin_administrators_router)
app.include_router(admin_account_router)
app.include_router(admin_peer_photos_router)
app.include_router(health_permission_member_router)
app.include_router(health_permission_admin_router)
app.include_router(health_sharing_settings_router)
app.include_router(admin_care_router)
app.include_router(care_router)
app.include_router(admin_fitness_router)
app.include_router(fitness_router)
app.include_router(admin_content_router)
app.include_router(content_router)
app.include_router(member_account_router)
app.include_router(mood_router)
app.include_router(food_diary_router)
app.include_router(food_choices_router)
app.include_router(meal_plans_router)
app.include_router(requests_router)
app.include_router(member_requests_router)
app.include_router(admin_requests_router)
app.include_router(settings_router)
app.include_router(admin_settings_router)
app.include_router(admin_qa_router)
app.include_router(prospects_router)
app.include_router(member_saved_results_router)
app.include_router(admin_prospects_router)
app.include_router(admin_privacy_settings_router)
app.include_router(member_erasure_router)
app.include_router(erasure_status_router)
app.include_router(admin_erasure_router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "veye-api"}
