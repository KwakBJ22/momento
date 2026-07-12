from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    supabase_url: str
    supabase_service_role_key: str
    supabase_storage_bucket: str = "albums"
    supabase_private_storage_bucket: str = "momento-private"

    openai_api_key: str
    openai_model: str = "gpt-4o-mini"

    max_photos: int = 10
    max_file_size_mb: int = 10
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

    cors_origins: str = "http://localhost:5173"
    frontend_base_url: str = "https://momento-ashen-rho.vercel.app"

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
