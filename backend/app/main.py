import asyncio
import logging
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from app.api.admin import router as admin_router
from app.api.album import router as album_router
from app.api.auth import router as auth_router
from app.api.collaboration import router as collaboration_router
from app.api.family import album_members_router, invitations_router, router as family_router
from app.api.memory import router as memory_router
from app.api.share import router as share_router
from app.config import get_settings
from app.services.operations import get_operation_id, get_operation_stage, operation_context
from app.services.storage_service import StorageService
from app.services.supabase import get_supabase_client, warm_supabase_client

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
# Uvicorn may install handlers before this module is imported, in which case
# basicConfig intentionally does not alter the root level. Keep application
# phase diagnostics visible in Railway without changing their destination.
logging.getLogger().setLevel(logging.INFO)

logger = logging.getLogger(__name__)


def _validation_error_response(request: Request, error_count: int) -> JSONResponse:
    """Keep validation internals out of user-facing API responses."""
    logger.warning(
        "request_validation_failed method=%s path=%s operation_id=%s error_count=%s",
        request.method,
        request.url.path,
        get_operation_id(),
        error_count,
    )
    return JSONResponse(status_code=422, content={"detail": "입력 내용을 확인해주세요."})

# 연결을 몇 초마다 건드릴 것인가. 프록시·로드밸런서의 유휴 종료는 보통 60초라
# 그보다 짧게 둔다. 워커 4개 × 분당 1~2회라 부하는 없다.
SUPABASE_KEEPALIVE_SECONDS = 45


# 마지막으로 요청이 지나간 시각(단조 시계). 사용자가 쓰고 있으면 그 요청 자체가
# 연결을 살려 두므로 따로 깨울 필요가 없다.
_last_request_at = time.monotonic()


async def _keep_supabase_warm() -> None:
    """**놀 때만** 연결을 깨운다.

    ★ 부팅 때 한 번 깨우는 것으로는 **부족했다.** 운영 로그에서 첫 호출 1259ms,
      이어지는 호출 180ms 로 7배가 났다. 질의가 무거워서가 아니라 놀던 연결이
      끊겨 DNS·TLS 를 다시 맺기 때문이다. 잠깐 안 쓰면 다시 처음 상태가 된다.
    ★ **바쁠 때는 한 번도 보내지 않는다.** 지나간 요청이 이미 연결을 살려 둔다.
      그래서 이 비용은 아무도 안 쓸 때만 든다 — 그때는 부하랄 것이 없다.
    ★ 실패해도 조용히 넘어간다 — 이건 대비책이지 기능이 아니다. 다만 계속 실패하면
      알아야 하므로 **상태가 바뀔 때만** 남긴다(로그를 분당 한 줄로 채우지 않는다).
    """
    healthy = True
    while True:
        idle_for = time.monotonic() - _last_request_at
        if idle_for < SUPABASE_KEEPALIVE_SECONDS:
            # 아직 따뜻하다. 식을 때까지만 더 잔다.
            await asyncio.sleep(SUPABASE_KEEPALIVE_SECONDS - idle_for)
            continue
        ok = await asyncio.to_thread(warm_supabase_client)
        if ok != healthy:
            logger.warning("supabase_keepalive ok=%s", ok)
            healthy = ok
        await asyncio.sleep(SUPABASE_KEEPALIVE_SECONDS)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Pay the DNS + TLS handshake at boot, not on the first user's request."""
    logger.info("supabase_warmup ok=%s", await asyncio.to_thread(warm_supabase_client))
    keepalive = asyncio.create_task(_keep_supabase_warm())
    try:
        yield
    finally:
        # 워커가 내려갈 때 붙잡지 않는다 — 배포가 그만큼 늦어진다.
        keepalive.cancel()
        with suppress(asyncio.CancelledError):
            await keepalive


fastapi_app = FastAPI(
    title="우리앨범 API",
    description="카카오톡 웹뷰 기반 모임 앨범 생성 서비스",
    version="0.1.0",
    lifespan=lifespan,
)


@fastapi_app.exception_handler(RequestValidationError)
async def request_validation_error_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    return _validation_error_response(request, len(exc.errors()))


@fastapi_app.exception_handler(ValidationError)
async def pydantic_validation_error_handler(request: Request, exc: ValidationError) -> JSONResponse:
    return _validation_error_response(request, len(exc.errors()))


@fastapi_app.middleware("http")
async def add_operation_id(request: Request, call_next):
    """Correlate every API request, logs, and events without trusting client IDs."""
    # 지나간 요청이 곧 연결을 살려 두는 신호다 — 이것이 있으면 keepalive 는 쉰다.
    global _last_request_at
    _last_request_at = time.monotonic()
    with operation_context(f"{request.method} {request.url.path}") as operation_id:
        try:
            response = await call_next(request)
        except Exception as exc:
            logger.exception(
                "api_request_failed method=%s path=%s operation_id=%s stage=%s exception_type=%s exception_message=%s",
                request.method,
                request.url.path,
                operation_id,
                get_operation_stage() or "unknown",
                type(exc).__name__,
                str(exc)[:240],
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
        "unhandled_api_error method=%s path=%s operation_id=%s stage=%s exception_type=%s exception_message=%s",
        request.method,
        request.url.path,
        get_operation_id(),
        get_operation_stage() or "unknown",
        type(exc).__name__,
        str(exc)[:240],
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
