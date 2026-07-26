from __future__ import annotations

from typing import Any

from fastapi import HTTPException
from supabase import Client

from app.ai.vision_service import VisionAIService, format_analysis_summary
from app.config import Settings, get_settings
from app.services.storage_service import StorageService

__all__ = [
    "analyze_album_media",
    "analyze_media_with_vision",
    "format_analysis_summary",
    "media_has_analysis",
    "save_media_analysis",
]


def _download_media_bytes(client: Client, settings: Settings, media: dict[str, Any]) -> tuple[bytes, str]:
    bucket = settings.supabase_private_storage_bucket
    path = media.get("thumbnail_path") or media.get("original_path")
    if not path:
        raise HTTPException(status_code=404, detail="미디어 파일을 찾을 수 없습니다.")
    try:
        payload = StorageService.for_supabase(client, settings).download(bucket, str(path))
    except Exception as exc:
        raise HTTPException(status_code=502, detail="미디어를 불러오지 못했습니다.") from exc
    mime_type = media.get("mime_type") or "image/jpeg"
    return payload, mime_type


def media_has_analysis(media: dict[str, Any]) -> bool:
    analysis = media.get("media_analysis")
    return isinstance(analysis, dict) and bool(analysis)


def save_media_analysis(client: Client, media_id: str, analysis: dict[str, Any]) -> None:
    client.table("album_media").update({"media_analysis": analysis}).eq("id", media_id).execute()


async def analyze_media_with_vision(
    client: Client,
    *,
    album: dict[str, Any],
    media: dict[str, Any],
    photo_index: int,
    photo_count: int,
    settings: Settings | None = None,
    actor_profile_id: str | None = None,
) -> dict[str, Any]:
    settings = settings or get_settings()
    media_type = str(media.get("media_type") or "image")
    if media_type not in {"image", "gif"}:
        raise HTTPException(status_code=400, detail="이미지 미디어만 고급 AI 분석을 지원합니다.")

    image_bytes, mime_type = _download_media_bytes(client, settings, media)
    vision = VisionAIService(settings, supabase_client=client)
    return await vision.analyze_image(
        album=album,
        image_bytes=image_bytes,
        mime_type=mime_type,
        photo_index=photo_index,
        photo_count=photo_count,
        album_id=str(album.get("id") or ""),
        family_id=str(album.get("family_id") or "") or None,
        actor_profile_id=actor_profile_id,
    )


async def analyze_album_media(
    client: Client,
    *,
    album_id: str,
    album: dict[str, Any],
    media_records: list[dict[str, Any]],
    media_id: str | None = None,
    settings: Settings | None = None,
    actor_profile_id: str | None = None,
) -> dict[str, Any]:
    settings = settings or get_settings()
    targets = media_records
    if media_id:
        targets = [row for row in media_records if str(row["id"]) == media_id]
        if not targets:
            raise HTTPException(status_code=404, detail="미디어를 찾을 수 없습니다.")

    photo_count = len(media_records)
    analyzed: list[str] = []
    skipped: list[str] = []

    for media in targets:
        current_id = str(media["id"])
        if media_has_analysis(media):
            skipped.append(current_id)
            continue
        photo_index = int(media.get("sort_order", 0)) + 1
        analysis = await analyze_media_with_vision(
            client,
            album=album,
            media=media,
            photo_index=photo_index,
            photo_count=photo_count,
            settings=settings,
            actor_profile_id=actor_profile_id,
        )
        save_media_analysis(client, current_id, analysis)
        media["media_analysis"] = analysis
        analyzed.append(current_id)

    return {"analyzed_media_ids": analyzed, "skipped_media_ids": skipped}
