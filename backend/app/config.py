from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


# ★ 운영 Supabase 프로젝트 ref. **어느 데이터를 지우게 되는지**를 정하는 값이라,
#   "지금 어디를 보고 있는가"의 판정 근거를 이것 하나로 둔다(주소나 배포 이름이 아니다 —
#   그것들은 바뀌고, 바뀌어도 지워지는 데이터는 이 프로젝트의 것이다).
#   ref 는 서명된 사진 주소에도 그대로 드러나는 공개 식별자다. 비밀이 아니다.
PRODUCTION_SUPABASE_REF = "hbywquveagumdxtjdzoh"

DEFAULT_CORS_ORIGINS = (
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "https://momento-ashen-rho.vercel.app",
)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    supabase_url: str
    supabase_service_role_key: str
    # ★ 버킷은 **하나**다 (K-1-c). 예전에는 둘이었는데 `albums` 는 빈 껍데기였고,
    # 지우면 버킷 목록을 훑는 자리(operations_service.check_storage ·
    # guest_album_cleanup.find_orphan_storage_albums)가 없는 버킷을 list 하다 실패한다.
    # 둘 다 같은 값을 가리키게 두면 그 코드가 알아서 중복을 지운다.
    supabase_storage_bucket: str = "woorialbum-private"
    supabase_private_storage_bucket: str = "woorialbum-private"

    openai_api_key: str
    openai_model: str = "gpt-4o-mini"

    # 좌표를 시·군 이름으로 바꾸는 데만 쓴다(카카오 로컬 API).
    # ★ 비어 있어도 앱은 돈다 — 장소가 안 붙을 뿐이다. 사진 업로드가 이 키 하나
    #   때문에 실패하면 안 된다(place_name_service 참고).
    kakao_rest_api_key: str = ""
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
    # so trailing photos expired to 403 and showed only their frame.
    # 24시간인 이유: 서명 URL 캐시는 TTL 앞 절반 동안 같은 URL을 재사용하므로 URL이
    # 12시간 고정된다 — 브라우저 cache-control(30일)이 세션을 넘어 재방문에도 먹는다.
    # (3600이면 URL이 30분마다 바뀌어 캐시가 세션 안에서만 유효했다.)
    # 삭제는 안전하다: 사진 삭제 시 Storage 객체도 함께 지워져(album.py) 살아 있는
    # 서명 URL도 무효가 된다 — "지웠는데 계속 보인다" 문제 없음.
    # Env: SIGNED_URL_TTL_SECONDS.
    signed_url_ttl_seconds: int = 86400
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
    # Comma-separated Supabase Auth user ids allowed to use /api/admin. Primary allowlist
    # now that Kakao login provides no email — an operator without an email is matched here.
    platform_admin_user_ids: str = ""

    @property
    def platform_admin_email_set(self) -> frozenset[str]:
        return frozenset(
            email.strip().lower()
            for email in self.platform_admin_emails.split(",")
            if email.strip()
        )

    @property
    def platform_admin_user_id_set(self) -> frozenset[str]:
        return frozenset(
            user_id.strip()
            for user_id in self.platform_admin_user_ids.split(",")
            if user_id.strip()
        )

    @property
    def cors_origin_list(self) -> list[str]:
        configured = [origin.strip().rstrip("/") for origin in self.cors_origins.split(",") if origin.strip()]
        return list(dict.fromkeys([*DEFAULT_CORS_ORIGINS, *configured]))

    @property
    def is_production(self) -> bool:
        return self.environment.strip().lower() == "production"

    @property
    def supabase_project_ref(self) -> str:
        """`https://<ref>.supabase.co` 에서 ref 만 뽑는다."""
        host = self.supabase_url.strip().rstrip("/").split("//")[-1].split("/")[0]
        return host.split(".")[0].strip().lower()

    @property
    def deployment_environment(self) -> str:
        """지금 붙어 있는 데이터가 운영인지 아닌지 — 관리자 화면이 이것을 보고 띠를 띄운다.

        ★ 위의 `environment`(ENVIRONMENT 변수)를 쓰지 않는다. 그 값은 안 넣어도 기본값이
          `development` 라, **운영에서 변수를 빠뜨리면 운영이 개발로 보인다.** 여기서는
          반대로 잡는다 — 운영 프로젝트에 붙어 있을 때만 운영이고, 모르는 곳은 전부
          개발로 본다. 헷갈릴 때 띠가 뜨는 쪽이 안전하다(지우면 되돌릴 수 없다).
        """
        return "production" if self.supabase_project_ref == PRODUCTION_SUPABASE_REF else "development"

    @property
    def should_hot_reload_prompts(self) -> bool:
        if self.prompt_hot_reload is not None:
            return self.prompt_hot_reload
        return not self.is_production


@lru_cache
def get_settings() -> Settings:
    return Settings()
