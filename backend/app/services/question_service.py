from __future__ import annotations

from typing import Any

from fastapi import HTTPException
from supabase import Client

from app.ai.parsers import parse_questions_json
from app.ai.question_service import QuestionAIService
from app.config import Settings, get_settings


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
    settings: Settings | None = None,
) -> str:
    service = QuestionAIService(settings)
    prompt, _, _ = service.build_user_prompt(
        album,
        photo_index=photo_index,
        photo_count=photo_count,
        existing_answers=existing_answers,
        media_analysis=media_analysis,
    )
    return prompt


async def generate_questions_for_media(
    client: Client,
    *,
    album: dict[str, Any],
    media: dict[str, Any],
    photo_index: int,
    photo_count: int,
    existing_answers: str,
    settings: Settings | None = None,
    actor_profile_id: str | None = None,
) -> tuple[list[str], str]:
    settings = settings or get_settings()
    service = QuestionAIService(settings, supabase_client=client)
    questions, user_prompt, _, _ = await service.generate_for_media(
        album=album,
        media=media,
        photo_index=photo_index,
        photo_count=photo_count,
        existing_answers=existing_answers,
        album_id=str(album.get("id") or ""),
        family_id=str(album.get("family_id") or "") or None,
        actor_profile_id=actor_profile_id,
    )
    return questions, user_prompt


async def generate_album_questions(
    client: Client,
    *,
    album_id: str,
    album: dict[str, Any],
    media_records: list[dict[str, Any]],
    force: bool = False,
    media_id: str | None = None,
    settings: Settings | None = None,
    actor_profile_id: str | None = None,
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
            actor_profile_id=actor_profile_id,
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


# Backward-compatible test alias
_parse_questions_json = parse_questions_json
