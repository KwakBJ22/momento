from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.album import router as album_router
from app.api.auth import router as auth_router
from app.api.family import album_members_router, invitations_router, router as family_router
from app.config import get_settings

settings = get_settings()

app = FastAPI(
    title="Momento API",
    description="카카오톡 웹뷰 기반 모임 앨범 생성 서비스",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(album_router)
app.include_router(auth_router)
app.include_router(family_router)
app.include_router(invitations_router)
app.include_router(album_members_router)


@app.get("/health")
async def health_check() -> dict[str, str]:
    return {"status": "ok"}
