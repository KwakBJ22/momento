import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.album import router as album_router
from app.api.auth import router as auth_router
from app.api.family import album_members_router, invitations_router, router as family_router
from app.api.guest import router as guest_router
from app.api.memory import router as memory_router
from app.api.share import router as share_router
logger = logging.getLogger(__name__)

app = FastAPI(
    title="Momento API",
    description="카카오톡 웹뷰 기반 모임 앨범 생성 서비스",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    # Keep local development origins on the actual `app.main:app` object.
    # Environment variables must not be able to remove these origins.
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "https://momento-ashen-rho.vercel.app",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Return a JSON 500 inside the CORS middleware instead of hiding it as a browser CORS error."""
    logger.exception("Unhandled API error: method=%s path=%s", request.method, request.url.path)
    return JSONResponse(status_code=500, content={"detail": "앨범 생성 중 서버 오류가 발생했어요. 잠시 후 다시 시도해주세요."})

app.include_router(album_router)
app.include_router(auth_router)
app.include_router(family_router)
app.include_router(invitations_router)
app.include_router(album_members_router)
app.include_router(memory_router)
app.include_router(share_router)
app.include_router(guest_router)


@app.get("/health")
async def health_check() -> dict[str, str]:
    return {"status": "ok"}
