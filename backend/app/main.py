import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.album import router as album_router
from app.api.auth import router as auth_router
from app.api.collaboration import router as collaboration_router
from app.api.family import album_members_router, invitations_router, router as family_router
from app.api.guest import router as guest_router
from app.api.memory import router as memory_router
from app.api.share import router as share_router
from app.config import get_settings

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

@fastapi_app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Return a JSON 500 inside the CORS middleware instead of hiding it as a browser CORS error."""
    logger.exception("Unhandled API error: method=%s path=%s", request.method, request.url.path)
    return JSONResponse(status_code=500, content={"detail": "앨범 생성 중 서버 오류가 발생했어요. 잠시 후 다시 시도해주세요."})

fastapi_app.include_router(album_router)
fastapi_app.include_router(auth_router)
fastapi_app.include_router(family_router)
fastapi_app.include_router(invitations_router)
fastapi_app.include_router(album_members_router)
fastapi_app.include_router(memory_router)
fastapi_app.include_router(share_router)
fastapi_app.include_router(guest_router)
fastapi_app.include_router(collaboration_router)


@fastapi_app.get("/health")
async def health_check() -> dict[str, str]:
    return {"status": "ok"}


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
)
