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
from app.models.schemas import MEETING_TYPE_LABELS
from app.services.prompt_loader import load_prompt, render_prompt


MIN_QUESTIONS = 3
MAX_QUESTIONS = 5


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def media_has_active_questions(client: Client, media_id: str) -> bool:
    result = (
        client.table("memory_questions")
        .select("id")
        .eq("media_id", media_id)
        .eq("status", "active")
        .limit(1)
        .execute()
    )
    return bool(result.data)


def archive_media_questions(client: Client, album_id: str, media_id: str) -> None:
    client.table("memory_questions").update({"status": "archived"}).eq("album_id", album_id).eq(
        "media_id", media_id
    ).eq("status", "active").execute()


def list_album_questions(client: Client, album_id: str) -> list[dict[str, Any]]:
    result = (
        client.table("memory_questions")
        .select("id, album_id, media_id, question, sort_order, ai_prompt, status, created_at")
        .eq("album_id", album_id)
        .eq("status", "active")
        .order("media_id")
        .order("sort_order")
        .execute()
    )
    return result.data or []


def list_question_answers(client: Client, question_ids: list[str]) -> list[dict[str, Any]]:
    if not question_ids:
        return []
    result = (
        client.table("memory_answers")
        .select("id, question_id, profile_id, answer, answer_type, voice_url, created_at, updated_at, profiles(display_name)")
        .in_("question_id", question_ids)
        .order("created_at")
        .execute()
    )
    return result.data or []


def get_answer_by_id(client: Client, answer_id: str) -> dict[str, Any] | None:
    result = (
        client.table("memory_answers")
        .select("id, question_id, profile_id, answer, answer_type, voice_url, created_at, updated_at")
        .eq("id", answer_id)
        .limit(1)
        .execute()
    )
    data = result.data or []
    return data[0] if data else None


def get_question_by_id(client: Client, question_id: str) -> dict[str, Any] | None:
    result = (
        client.table("memory_questions")
        .select("id, album_id, media_id, question, sort_order, status")
        .eq("id", question_id)
        .limit(1)
        .execute()
    )
    data = result.data or []
    return data[0] if data else None


def upsert_answer(
    client: Client,
    *,
    question_id: str,
    profile_id: str,
    answer: str,
    answer_type: str = "text",
    voice_url: str | None = None,
) -> dict[str, Any]:
    record = {
        "question_id": question_id,
        "profile_id": profile_id,
        "answer": answer.strip(),
        "answer_type": answer_type,
        "voice_url": voice_url,
    }
    result = client.table("memory_answers").upsert(record, on_conflict="question_id,profile_id").execute()
    data = result.data or []
    if data:
        return data[0]
    existing = (
        client.table("memory_answers")
        .select("*")
        .eq("question_id", question_id)
        .eq("profile_id", profile_id)
        .limit(1)
        .execute()
    )
    rows = existing.data or []
    return rows[0] if rows else record


def update_answer_record(client: Client, answer_id: str, patch: dict[str, Any]) -> dict[str, Any] | None:
    result = client.table("memory_answers").update(patch).eq("id", answer_id).execute()
    data = result.data or []
    return data[0] if data else None


def delete_answer_record(client: Client, answer_id: str) -> None:
    client.table("memory_answers").delete().eq("id", answer_id).execute()


def save_generated_questions(
    client: Client,
    *,
    album_id: str,
    media_id: str,
    questions: list[str],
    ai_prompt: str,
) -> list[dict[str, Any]]:
    rows = [
        {
            "album_id": album_id,
            "media_id": media_id,
            "question": question,
            "sort_order": index,
            "ai_prompt": ai_prompt,
            "status": "active",
        }
        for index, question in enumerate(questions)
    ]
    result = client.table("memory_questions").insert(rows).execute()
    return result.data or rows


def _parse_questions_json(raw: str) -> list[str]:
    text = raw.strip()
    match = re.search(r"\[[\s\S]*\]", text)
    if not match:
        raise HTTPException(status_code=502, detail="AI가 유효한 질문 목록을 반환하지 않았습니다.")
    try:
        parsed = json.loads(match.group(0))
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=502, detail="AI 질문 JSON 파싱에 실패했습니다.") from exc
    if not isinstance(parsed, list):
        raise HTTPException(status_code=502, detail="AI 질문 응답 형식이 올바르지 않습니다.")
    questions = [str(item).strip() for item in parsed if str(item).strip()]
    if len(questions) < MIN_QUESTIONS:
        raise HTTPException(status_code=502, detail="AI가 충분한 질문을 생성하지 못했습니다.")
    return questions[:MAX_QUESTIONS]


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


async def generate_questions_for_media(
    client: Client,
    *,
    album: dict[str, Any],
    media: dict[str, Any],
    settings: Settings | None = None,
) -> list[str]:
    settings = settings or get_settings()
    openai_client = OpenAI(api_key=settings.openai_api_key)
    meeting_type = str(album.get("meeting_type") or "family")
    user_prompt = render_prompt(
        "memory_questions_user.txt",
        album_title=str(album.get("title") or "우리의 모임"),
        event_date=str(album.get("event_date") or ""),
        meeting_type_label=MEETING_TYPE_LABELS.get(meeting_type, "모임"),
        media_type=str(media.get("media_type") or "image"),
        original_filename=str(media.get("original_filename") or ""),
    )
    system_prompt = load_prompt("memory_questions_system.txt")
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": system_prompt},
    ]

    media_type = str(media.get("media_type") or "image")
    if media_type in {"image", "gif"}:
        image_bytes, mime_type = _download_media_bytes(client, settings, media)
        messages.append(
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": user_prompt},
                    {"type": "image_url", "image_url": {"url": _image_data_url(image_bytes, mime_type)}},
                ],
            }
        )
    else:
        messages.append({"role": "user", "content": user_prompt})

    try:
        completion = openai_client.chat.completions.create(
            model=settings.openai_model,
            max_tokens=400,
            temperature=0.7,
            messages=messages,
        )
    except OpenAIError as exc:
        raise HTTPException(status_code=502, detail=f"OpenAI API 호출 실패: {exc}") from exc

    content = (completion.choices[0].message.content or "").strip()
    return _parse_questions_json(content)


async def generate_album_questions(
    client: Client,
    *,
    album_id: str,
    album: dict[str, Any],
    media_records: list[dict[str, Any]],
    force: bool = False,
    media_id: str | None = None,
    settings: Settings | None = None,
) -> dict[str, Any]:
    settings = settings or get_settings()
    generated_for: list[str] = []
    skipped: list[str] = []
    created_count = 0

    targets = media_records
    if media_id:
        targets = [row for row in media_records if str(row["id"]) == media_id]
        if not targets:
            raise HTTPException(status_code=404, detail="미디어를 찾을 수 없습니다.")

    for media in targets:
        current_media_id = str(media["id"])
        if not force and media_has_active_questions(client, current_media_id):
            skipped.append(current_media_id)
            continue
        if force and media_has_active_questions(client, current_media_id):
            archive_media_questions(client, album_id, current_media_id)

        user_prompt = render_prompt(
            "memory_questions_user.txt",
            album_title=str(album.get("title") or "우리의 모임"),
            event_date=str(album.get("event_date") or ""),
            meeting_type_label=MEETING_TYPE_LABELS.get(str(album.get("meeting_type") or "family"), "모임"),
            media_type=str(media.get("media_type") or "image"),
            original_filename=str(media.get("original_filename") or ""),
        )
        questions = await generate_questions_for_media(client, album=album, media=media, settings=settings)
        save_generated_questions(
            client,
            album_id=album_id,
            media_id=current_media_id,
            questions=questions,
            ai_prompt=user_prompt,
        )
        generated_for.append(current_media_id)
        created_count += len(questions)

    return {
        "generated_media_ids": generated_for,
        "skipped_media_ids": skipped,
        "question_count": created_count,
    }
