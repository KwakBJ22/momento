from __future__ import annotations

from typing import Any

from supabase import Client

from app.ai.ai_service import AIService
from app.ai.prompt_service import PromptManager
from app.ai.vision_service import format_analysis_summary
from app.config import Settings, get_settings
from app.models.schemas import MEETING_TYPE_LABELS

MEETING_TONE: dict[str, str] = {
    "family": (
        "50대 부모님도 감동할 만큼 따뜻하고 정겨운 말투로 작성해줘. "
        "가족의 사랑과 세대를 잇는 추억이 느껴지도록 표현해줘."
    ),
    "friend": (
        "오랜 친구 사이의 편안하고 다정한 말투로 작성해줘. "
        "함께한 시간의 소중함과 우정이 묻어나도록 표현해줘."
    ),
    "work": (
        "깔끔하고 담백하면서도 서로를 격려하는 말투로 작성해줘. "
        "동료로서의 유대감과 응원의 메시지가 담기도록 표현해줘."
    ),
    "university": (
        "젊고 활기찬 말투로 작성해줘. "
        "청춘의 설렘과 생동감, 유쾌한 에너지가 느껴지도록 표현해줘."
    ),
}


class StoryAIService:
    def __init__(
        self,
        settings: Settings | None = None,
        prompts: PromptManager | None = None,
        ai: AIService | None = None,
        supabase_client: Client | None = None,
    ) -> None:
        self._settings = settings or get_settings()
        self._prompts = prompts or PromptManager(self._settings)
        self._ai = ai or AIService(self._settings, supabase_client)

    @staticmethod
    def _collect_media_analysis_summary(media_records: list[dict[str, Any]]) -> str:
        chunks: list[str] = []
        for media in media_records:
            analysis = media.get("media_analysis")
            if isinstance(analysis, dict):
                summary = format_analysis_summary(analysis)
                if summary:
                    chunks.append(f"[사진 {int(media.get('sort_order', 0)) + 1}] {summary}")
        return "\n".join(chunks)

    def build_story_prompt(
        self,
        *,
        title: str,
        meeting_type: str,
        event_date: str,
        description: str,
        existing_answers: str,
        media_records: list[dict[str, Any]] | None = None,
    ) -> tuple[str, str, str]:
        meeting_type_label = MEETING_TYPE_LABELS.get(meeting_type, "모임")
        common = {
            "album_title": title,
            "album_description": description,
            "event_date": event_date,
            "meeting_type_label": meeting_type_label,
            "existing_answers": existing_answers or "아직 답변이 없습니다.",
        }
        analysis_summary = self._collect_media_analysis_summary(media_records or [])
        if analysis_summary:
            prompt, version = self._prompts.render_prompt(
                "story_enriched",
                media_analysis_summary=analysis_summary,
                **common,
            )
            return prompt, version, "story_enriched"
        prompt, version = self._prompts.render_prompt("story_basic", **common)
        return prompt, version, "story_basic"

    def build_story_from_photo_stories_prompt(
        self,
        photo_stories: list[dict[str, Any]],
        meeting_type: str,
        title: str,
    ) -> tuple[str, str, str]:
        ordered = sorted(photo_stories, key=lambda x: int(x.get("order", 0)))
        lines: list[str] = []
        for idx, item in enumerate(ordered, start=1):
            user = item.get("user") or ""
            text = item.get("text", "")
            prefix = f"{user}: " if user else ""
            lines.append(f'[사진 {idx}] {prefix}"{text}"')
        meeting_type_label = MEETING_TYPE_LABELS.get(meeting_type, "모임")
        prompt, version = self._prompts.render_prompt(
            "story_from_stories",
            album_title=title,
            meeting_type_label=meeting_type_label,
            photo_stories_block="\n".join(lines),
            meeting_tone=MEETING_TONE.get(meeting_type, MEETING_TONE["friend"]),
        )
        return prompt, version, "story_from_stories"

    async def generate_narrative(
        self,
        photo_stories: list[dict[str, Any]],
        meeting_type: str,
        title: str = "우리의 모임",
        *,
        event_date: str = "",
        description: str = "",
        existing_answers: str = "",
        media_records: list[dict[str, Any]] | None = None,
        album_id: str | None = None,
        family_id: str | None = None,
        actor_profile_id: str | None = None,
    ) -> str:
        has_story_text = any(str(item.get("text") or "").strip() for item in photo_stories)
        if has_story_text:
            user_prompt, user_version, prompt_name = self.build_story_from_photo_stories_prompt(
                photo_stories, meeting_type, title
            )
            system_prompt, system_version = self._prompts.render_prompt("story_system")
        else:
            user_prompt, user_version, prompt_name = self.build_story_prompt(
                title=title,
                meeting_type=meeting_type,
                event_date=event_date,
                description=description,
                existing_answers=existing_answers,
                media_records=media_records,
            )
            system_prompt, system_version = self._prompts.render_prompt("story_system")

        result = await self._ai.chat_completion(
            feature="story",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            prompt_name=f"story_system+{prompt_name}",
            prompt_version=f"{system_version}+{user_version}",
            max_tokens=500,
            temperature=0.8,
            operation="story_generation",
            family_id=family_id,
            album_id=album_id,
            actor_profile_id=actor_profile_id,
        )
        return result.content
