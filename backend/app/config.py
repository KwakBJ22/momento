from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


DEFAULT_CORS_ORIGINS = (
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "https://momento-ashen-rho.vercel.app",
)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    supabase_url: str
    supabase_service_role_key: str
    supabase_storage_bucket: str = "albums"
    supabase_private_storage_bucket: str = "momento-private"

    openai_api_key: str
    openai_model: str = "gpt-4o-mini"
    vision_model: str = ""
    enable_vision_analysis: bool = False
    question_model: str = ""
    story_model: str = ""
    title_model: str = ""
    emotion_model: str = ""
    timeline_model: str = ""
    album_summary_model: str = ""

    environment: str = "development"
    prompt_hot_reload: bool | None = None

    max_photos: int = 30
    # Abuse-protection ceiling on albums a single user may own — NOT a paywall.
    # Album creation is a growth path (create → 카톡 share → new users) and album
    # count doesn't track real cost, so the free boundary lives at the OUTPUT
    # (high-res PDF / original download / physical print), not at creation. 50 is a
    # number normal users never reach; it only stops runaway/abusive creation.
    # Still the single source of truth — read it only through
    # plan_limits.get_user_limits, never inline. Env: MAX_ALBUMS_PER_USER.
    max_albums_per_user: int = 50
    max_file_size_mb: int = 10
    max_total_upload_size_mb: int = 100

    @field_validator("max_photos", mode="after")
    @classmethod
    def _product_max_photos(cls, value: int) -> int:
        """MVP album upload cap (frontend and API must stay aligned)."""
        return 30
    max_video_file_size_mb: int = 500
    max_audio_file_size_mb: int = 100
    max_document_file_size_mb: int = 50
    max_image_pixels: int = 40_000_000
    thumbnail_max_side: int = 640
    image_processing_concurrency: int = 4
    # Signed URLs are temporary links usable only by someone who already passed the
    # backend's album authorization, so they don't need to be short-lived. 5분(300s)
    # was too tight: album creation alone takes ~3.5min, and normal viewing (slow
    # scroll through 30 photos, or backgrounding the app briefly) easily exceeds it,
    # so trailing photos expired to 403 and showed only their frame. 1시간이면 여유롭다.
    # Env: SIGNED_URL_TTL_SECONDS.
    signed_url_ttl_seconds: int = 3600
    allowed_image_types: tuple[str, ...] = (
        "image/jpeg",
        "image/png",
        "image/webp",
        "image/gif",
        "image/heic",
        "image/heif",
    )

    cors_origins: str = ",".join(DEFAULT_CORS_ORIGINS)
    cors_origin_regex: str = ""
    frontend_base_url: str = "https://momento-ashen-rho.vercel.app"

    # Comma-separated Supabase Auth emails allowed to use /api/admin (platform operators).
    platform_admin_emails: str = ""

    @property
    def platform_admin_email_set(self) -> frozenset[str]:
        return frozenset(
            email.strip().lower()
            for email in self.platform_admin_emails.split(",")
            if email.strip()
        )

    @property
    def cors_origin_list(self) -> list[str]:
        configured = [origin.strip().rstrip("/") for origin in self.cors_origins.split(",") if origin.strip()]
        return list(dict.fromkeys([*DEFAULT_CORS_ORIGINS, *configured]))

    @property
    def is_production(self) -> bool:
        return self.environment.strip().lower() == "production"

    @property
    def should_hot_reload_prompts(self) -> bool:
        if self.prompt_hot_reload is not None:
            return self.prompt_hot_reload
        return not self.is_production


@lru_cache
def get_settings() -> Settings:
    return Settings()
