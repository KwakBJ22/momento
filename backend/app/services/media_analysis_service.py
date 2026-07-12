from __future__ import annotations

import base64
import json
import re
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException
from openai import OpenAI, OpenAIError
from supabase import Client

from app.config import Settings, get_settings
from app.services.prompt_loader import load_prompt, render_prompt


def _download_media_bytes(client: Client, settings: Settings, media: dict[str, Any]) -> tuple[bytes, str]:
    bucket = settings.supabase_private_storage_bucket
    path = media.get("thumbnail_path") or media.get("original_path")
    if not path:
        raise HTTPException(status_code=404, detail="미디어 파일을 찾을 수 없습니다.")
    try:
        payload = client.storage.from_(bucket).download(path)
    except Exception as exc:
        raise HTTPException(status_code=502, detail="미디어를 불러오지 못했습니다.") from exc
    mime_type = media.get("mime_type") or "image/jpeg"
    return payload, mime_type


def _image_data_url(image_bytes: bytes, mime_type: str) -> str:
    encoded = base64.b64encode(image_bytes).decode("ascii")
    return f"data:{mime_type};base64,{encoded}"


def media_has_analysis(media: dict[str, Any]) -> bool:
    analysis = media.get("media_analysis")
    return isinstance(analysis, dict) and bool(analysis)


def save_media_analysis(client: Client, media_id: str, analysis: dict[str, Any]) -> None:
    client.table("album_media").update({"media_analysis": analysis}).eq("id", media_id).execute()


def _parse_analysis_json(raw: str) -> dict[str, Any]:
    text = raw.strip()
    match = re.search(r"\{[\s\S]*\}", text)
    if not match:
        raise HTTPException(status_code=502, detail="AI가 유효한 분석 JSON을 반환하지 않았습니다.")
    try:
        parsed = json.loads(match.group(0))
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=502, detail="AI 분석 JSON 파싱에 실패했습니다.") from exc
    if not isinstance(parsed, dict):
        raise HTTPException(status_code=502, detail="AI 분석 응답 형식이 올바르지 않습니다.")
    return parsed


def format_analysis_summary(analysis: dict[str, Any] | None) -> str:
    if not analysis:
        return ""
    summary = str(analysis.get("summary") or "").strip()
    scene = str(analysis.get("scene") or "").strip()
    mood = str(analysis.get("mood") or "").strip()
    subjects = analysis.get("subjects") or []
    details = analysis.get("notable_details") or []
    lines = [line for line in (summary, scene, mood) if line]
    if subjects:
        lines.append("대상: " + ", ".join(str(item) for item in subjects))
    if details:
        lines.append("디테일: " + ", ".join(str(item) for item in details))
    return "\n".join(lines)


async def analyze_media_with_vision(
    client: Client,
    *,
    album: dict[str, Any],
    media: dict[str, Any],
    photo_index: int,
    photo_count: int,
    settings: Settings | None = None,
) -> dict[str, Any]:
    settings = settings or get_settings()
    media_type = str(media.get("media_type") or "image")
    if media_type not in {"image", "gif"}:
        raise HTTPException(status_code=400, detail="이미지 미디어만 고급 AI 분석을 지원합니다.")

    openai_client = OpenAI(api_key=settings.openai_api_key)
    image_bytes, mime_type = _download_media_bytes(client, settings, media)
    user_prompt = render_prompt(
        "media_analysis_user.txt",
        album_title=str(album.get("title") or "우리의 모임"),
        album_description=str(album.get("narrative") or album.get("description") or ""),
        event_date=str(album.get("event_date") or ""),
        photo_index=str(photo_index),
        photo_count=str(photo_count),
    )
    try:
        completion = openai_client.chat.completions.create(
            model=settings.openai_model,
            max_tokens=500,
            temperature=0.4,
            messages=[
                {"role": "system", "content": load_prompt("media_analysis_system.txt")},
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": user_prompt},
                        {"type": "image_url", "image_url": {"url": _image_data_url(image_bytes, mime_type)}},
                    ],
                },
            ],
        )
    except OpenAIError as exc:
        raise HTTPException(status_code=502, detail=f"OpenAI Vision API 호출 실패: {exc}") from exc

    content = (completion.choices[0].message.content or "").strip()
    parsed = _parse_analysis_json(content)
    parsed["analyzed_at"] = datetime.now(timezone.utc).isoformat()
    parsed["provider"] = "openai"
    parsed["model"] = settings.openai_model
    return parsed


async def analyze_album_media(
    client: Client,
    *,
    album_id: str,
    album: dict[str, Any],
    media_records: list[dict[str, Any]],
    media_id: str | None = None,
    settings: Settings | None = None,
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
        )
        save_media_analysis(client, current_id, analysis)
        media["media_analysis"] = analysis
        analyzed.append(current_id)

    return {"analyzed_media_ids": analyzed, "skipped_media_ids": skipped}
