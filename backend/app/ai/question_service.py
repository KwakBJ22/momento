from __future__ import annotations

from typing import Any

from supabase import Client

from app.ai.ai_service import AIService
from app.ai.parsers import parse_questions_json
from app.ai.prompt_service import PromptManager
from app.ai.vision_service import format_analysis_summary
from app.config import Settings, get_settings
from app.models.schemas import MEETING_TYPE_LABELS


class QuestionAIService:
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

    def build_user_prompt(
        self,
        album: dict[str, Any],
        *,
        photo_index: int,
        photo_count: int,
        existing_answers: str,
        media_analysis: dict[str, Any] | None = None,
    ) -> tuple[str, str, str]:
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
            prompt, version = self._prompts.render_prompt(
                "question_enriched",
                media_analysis_summary=format_analysis_summary(media_analysis),
                **common,
            )
            return prompt, version, "question_enriched"
        prompt, version = self._prompts.render_prompt("question_basic", **common)
        return prompt, version, "question_basic"

    async def generate_for_media(
        self,
        *,
        album: dict[str, Any],
        media: dict[str, Any],
        photo_index: int,
        photo_count: int,
        existing_answers: str,
        album_id: str | None = None,
        family_id: str | None = None,
        actor_profile_id: str | None = None,
    ) -> tuple[list[str], str, str, str]:
        media_analysis = media.get("media_analysis") if isinstance(media.get("media_analysis"), dict) else None
        user_prompt, user_version, prompt_name = self.build_user_prompt(
            album,
            photo_index=photo_index,
            photo_count=photo_count,
            existing_answers=existing_answers,
            media_analysis=media_analysis,
        )
        system_prompt, system_version = self._prompts.render_prompt("question_system")
        result = await self._ai.chat_completion(
            feature="question",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            prompt_name=f"question_system+{prompt_name}",
            prompt_version=f"{system_version}+{user_version}",
            max_tokens=400,
            temperature=0.7,
            operation="question_generation",
            family_id=family_id,
            album_id=album_id,
            actor_profile_id=actor_profile_id,
        )
        return parse_questions_json(result.content), user_prompt, prompt_name, user_version
