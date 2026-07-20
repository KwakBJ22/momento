import json
from typing import Any

from fastapi import HTTPException
from supabase import Client

from app.ai.story_service import StoryAIService
from app.config import Settings, get_settings


def parse_stories_json(stories_raw: str) -> list[dict[str, Any]]:
    try:
        parsed = json.loads(stories_raw)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="stories 필드는 유효한 JSON 배열이어야 합니다.") from exc

    if not isinstance(parsed, list):
        raise HTTPException(status_code=400, detail="stories 필드는 JSON 배열이어야 합니다.")

    result: list[dict[str, Any]] = []
    for item in parsed:
        if not isinstance(item, dict):
            raise HTTPException(status_code=400, detail="각 story 항목은 객체여야 합니다.")
        if "order" not in item:
            raise HTTPException(status_code=400, detail="각 story 항목에 order가 필요합니다.")
        text = str(item.get("text", item.get("story", ""))).strip()
        result.append(
            {
                "order": int(item["order"]),
                "user": str(item.get("user", "")).strip(),
                "text": text,
            }
        )
    return result


def build_story_prompt(
    *,
    title: str,
    meeting_type: str,
    event_date: str,
    description: str,
    existing_answers: str,
    media_records: list[dict[str, Any]] | None = None,
    category: str | None = None,
    template_type: str | None = None,
    settings: Settings | None = None,
) -> str:
    service = StoryAIService(settings)
    prompt, _, _ = service.build_story_prompt(
        title=title,
        meeting_type=meeting_type,
        event_date=event_date,
        description=description,
        existing_answers=existing_answers,
        media_records=media_records,
        category=category,
        template_type=template_type,
    )
    return prompt


async def generate_narrative(
    photo_stories: list[dict[str, Any]],
    meeting_type: str,
    title: str = "우리의 모임",
    settings: Settings | None = None,
    *,
    event_date: str = "",
    description: str = "",
    existing_answers: str = "",
    media_records: list[dict[str, Any]] | None = None,
    category: str | None = None,
    template_type: str | None = None,
    client: Client | None = None,
    album_id: str | None = None,
    family_id: str | None = None,
    actor_profile_id: str | None = None,
) -> str:
    settings = settings or get_settings()
    service = StoryAIService(settings, supabase_client=client)
    return await service.generate_narrative(
        photo_stories,
        meeting_type,
        title,
        event_date=event_date,
        description=description,
        existing_answers=existing_answers,
        media_records=media_records,
        category=category,
        template_type=template_type,
        album_id=album_id,
        family_id=family_id,
        actor_profile_id=actor_profile_id,
    )
