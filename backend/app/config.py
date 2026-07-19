from functools import lru_cache

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
    question_model: str = ""
    story_model: str = ""
    title_model: str = ""
    emotion_model: str = ""
    timeline_model: str = ""
    album_summary_model: str = ""

    environment: str = "development"
    prompt_hot_reload: bool | None = None

    max_photos: int = 10
    max_file_size_mb: int = 10
    max_video_file_size_mb: int = 500
    max_audio_file_size_mb: int = 100
    max_document_file_size_mb: int = 50
    max_image_pixels: int = 40_000_000
    thumbnail_max_side: int = 640
    signed_url_ttl_seconds: int = 300
    allowed_image_types: tuple[str, ...] = (
        "image/jpeg",
        "image/png",
        "image/webp",
        "image/gif",
        "image/heic",
        "image/heif",
    )

    cors_origins: str = ",".join(DEFAULT_CORS_ORIGINS)
    frontend_base_url: str = "https://momento-ashen-rho.vercel.app"

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
