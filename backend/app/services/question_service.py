from __future__ import annotations

import json
import re
from typing import Any

from fastapi import HTTPException
from openai import OpenAI, OpenAIError
from supabase import Client

from app.config import Settings, get_settings
from app.models.schemas import MEETING_TYPE_LABELS
from app.services.media_analysis_service import format_analysis_summary
from app.services.prompt_loader import load_prompt, render_prompt


MIN_QUESTIONS = 3
MAX_QUESTIONS = 5


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


def format_existing_answers(client: Client, album_id: str) -> str:
    question_rows = list_album_questions(client, album_id)
    if not question_rows:
        return "아직 답변이 없습니다."
    answers = list_question_answers(client, [str(row["id"]) for row in question_rows])
    if not answers:
        return "아직 답변이 없습니다."
    lines: list[str] = []
    question_map = {str(row["id"]): row["question"] for row in question_rows}
    for answer in answers:
        if not str(answer.get("answer") or "").strip():
            continue
        profile = answer.get("profiles") or {}
        name = profile.get("display_name") or "가족"
        question = question_map.get(str(answer["question_id"]), "질문")
        lines.append(f'- {name} ({question}): "{answer["answer"]}"')
    return "\n".join(lines) if lines else "아직 답변이 없습니다."


def build_question_prompt(
    album: dict[str, Any],
    *,
    photo_index: int,
    photo_count: int,
    existing_answers: str,
    media_analysis: dict[str, Any] | None = None,
) -> str:
    meeting_type = str(album.get("meeting_type") or "family")
    common = {
        "album_title": str(album.get("title") or "우리의 모임"),
        "album_description": str(album.get("narrative") or album.get("description") or ""),
        "event_date": str(album.get("event_date") or ""),
        "meeting_type_label": MEETING_TYPE_LABELS.get(meeting_type, "모임"),
        "photo_count": str(photo_count),
        "photo_index": str(photo_index),
        "existing_answers": existing_answers,
    }
    if media_analysis:
        return render_prompt(
            "memory_questions_user_with_analysis.txt",
            media_analysis_summary=format_analysis_summary(media_analysis),
            **common,
        )
    return render_prompt("memory_questions_user.txt", **common)


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


async def generate_questions_for_media(
    client: Client,
    *,
    album: dict[str, Any],
    media: dict[str, Any],
    photo_index: int,
    photo_count: int,
    existing_answers: str,
    settings: Settings | None = None,
) -> tuple[list[str], str]:
    settings = settings or get_settings()
    openai_client = OpenAI(api_key=settings.openai_api_key)
    media_analysis = media.get("media_analysis") if isinstance(media.get("media_analysis"), dict) else None
    user_prompt = build_question_prompt(
        album,
        photo_index=photo_index,
        photo_count=photo_count,
        existing_answers=existing_answers,
        media_analysis=media_analysis,
    )
    try:
        completion = openai_client.chat.completions.create(
            model=settings.openai_model,
            max_tokens=400,
            temperature=0.7,
            messages=[
                {"role": "system", "content": load_prompt("memory_questions_system.txt")},
                {"role": "user", "content": user_prompt},
            ],
        )
    except OpenAIError as exc:
        raise HTTPException(status_code=502, detail=f"OpenAI API 호출 실패: {exc}") from exc

    content = (completion.choices[0].message.content or "").strip()
    return _parse_questions_json(content), user_prompt


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
    photo_count = len(media_records)
    existing_answers = format_existing_answers(client, album_id)

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

        photo_index = int(media.get("sort_order", 0)) + 1
        questions, user_prompt = await generate_questions_for_media(
            client,
            album=album,
            media=media,
            photo_index=photo_index,
            photo_count=photo_count,
            existing_answers=existing_answers,
            settings=settings,
        )
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
