import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.admin import router as admin_router
from app.api.album import router as album_router
from app.api.auth import router as auth_router
from app.api.collaboration import router as collaboration_router
from app.api.family import album_members_router, invitations_router, router as family_router
from app.api.memory import router as memory_router
from app.api.share import router as share_router
from app.config import get_settings
from app.services.operations import get_operation_id, operation_context
from app.services.storage_service import StorageService
from app.services.supabase import get_supabase_client

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)

logger = logging.getLogger(__name__)

fastapi_app = FastAPI(
    title="Momento API",
    description="카카오톡 웹뷰 기반 모임 앨범 생성 서비스",
    version="0.1.0",
)


@fastapi_app.middleware("http")
async def add_operation_id(request: Request, call_next):
    """Correlate every API request, logs, and events without trusting client IDs."""
    with operation_context(f"{request.method} {request.url.path}") as operation_id:
        try:
            response = await call_next(request)
        except Exception as exc:
            logger.exception(
                "api_request_failed method=%s path=%s operation_id=%s exception_type=%s",
                request.method,
                request.url.path,
                operation_id,
                type(exc).__name__,
            )
            response = JSONResponse(
                status_code=500,
                content={"detail": "서버 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요."},
            )
    response.headers["X-Operation-Id"] = operation_id
    return response

@fastapi_app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Return a JSON 500 inside the CORS middleware instead of hiding it as a browser CORS error."""
    logger.exception(
        "unhandled_api_error method=%s path=%s operation_id=%s exception_type=%s",
        request.method,
        request.url.path,
        get_operation_id(),
        type(exc).__name__,
    )
    return JSONResponse(status_code=500, content={"detail": "앨범 생성 중 서버 오류가 발생했어요. 잠시 후 다시 시도해주세요."})

fastapi_app.include_router(album_router)
fastapi_app.include_router(auth_router)
fastapi_app.include_router(family_router)
fastapi_app.include_router(invitations_router)
fastapi_app.include_router(album_members_router)
fastapi_app.include_router(memory_router)
fastapi_app.include_router(share_router)
fastapi_app.include_router(collaboration_router)
fastapi_app.include_router(admin_router)


@fastapi_app.get("/health")
async def health_check() -> dict[str, str]:
    return {"status": "ok"}


@fastapi_app.get("/health/storage")
async def storage_health_check() -> dict[str, str]:
    """Read-only provider connectivity check for Railway health diagnostics."""
    try:
        client = get_supabase_client(get_settings())
        storage = StorageService.for_supabase(client, get_settings())
        storage.list(get_settings().supabase_private_storage_bucket, "albums")
    except Exception as exc:
        logger.warning("storage_health_check_failed error_type=%s message=%s", type(exc).__name__, str(exc)[:240])
        return JSONResponse(status_code=503, content={"status": "degraded", "storage": "unavailable"})
    return {"status": "ok", "storage": "ok"}


# Wrap the fully configured FastAPI application. This makes CORS headers apply
# even when an unhandled exception is converted to a 500 by Starlette.
settings = get_settings()

app = CORSMiddleware(
    app=fastapi_app,
    allow_origins=settings.cors_origin_list,
    allow_origin_regex=settings.cors_origin_regex or None,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Operation-Id"],
)
