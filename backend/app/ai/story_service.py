from __future__ import annotations

import re
from typing import Any

from supabase import Client

from app.ai.ai_service import AIService
from app.ai.prompt_service import PromptManager
from app.ai.vision_service import format_analysis_summary
from app.config import Settings, get_settings
from app.models.album_styles import style_context as resolve_style_context
from app.models.categories import (
    category_context as resolve_category_context,
    category_label,
    meeting_type_for_category,
    normalize_category,
)

MEETING_TONE: dict[str, str] = {
    "family": (
        "50대 부모님도 감동할 만큼 따뜻하고 정겨운 말투로 작성해줘. "
        "가족의 사랑과 세대를 잇는 추억이 느껴지도록 표현해줘."
    ),
    "friend": (
        "오랜 친구 사이의 편안하고 다정한 말투로 작성해줘. "
        "함께한 시간의 소중함과 우정이 묻어나도록 표현해줘."
    ),
    "couple": (
        "두 사람만의 다정하고 부드러운 말투로 작성해줘. "
        "제공된 순간에만 기대어 표현하고 관계를 과장하지 마."
    ),
    "work": (
        "깔끔하고 담백하면서도 서로를 격려하는 말투로 작성해줘. "
        "동료로서의 유대감과 응원의 메시지가 담기도록 표현해줘."
    ),
    "colleague": (
        "깔끔하고 담백하면서도 서로를 격려하는 말투로 작성해줘. "
        "동료로서의 유대감과 응원의 메시지가 담기도록 표현해줘."
    ),
    "pet": (
        "반려동물과 함께한 순간을 따뜻하고 짧은 말투로 작성해줘. "
        "주어진 코멘트에 없는 감정이나 행동을 지어내지 마."
    ),
    "travel": (
        "여행의 분위기만 담백하게 담아내는 말투로 작성해줘. "
        "방문지·일정·감정을 추측하지 마."
    ),
    "other": (
        "따뜻하고 담백한 말투로 작성해줘. "
        "확인되지 않은 관계는 언급하지 마."
    ),
    "university": (
        "젊고 활기찬 말투로 작성해줘. "
        "청춘의 설렘과 생동감, 유쾌한 에너지가 느껴지도록 표현해줘."
    ),
}


def normalize_story_honorifics(text: str) -> str:
    """Keep generated album prose consistently warm and polite."""
    normalized = text.strip()
    replacements = (
        (r"했다(?=\s|[.!?…]|$)", "했어요"),
        (r"였다(?=\s|[.!?…]|$)", "였어요"),
        (r"했지(?=\s|[.!?…]|$)", "했어요"),
        (r"였지(?=\s|[.!?…]|$)", "였어요"),
        (r"([가-힣])았다(?=\s|[.!?…]|$)", r"\1았어요"),
        (r"([가-힣])었다(?=\s|[.!?…]|$)", r"\1었어요"),
        (r"([가-힣])았지(?=\s|[.!?…]|$)", r"\1았어요"),
        (r"([가-힣])었지(?=\s|[.!?…]|$)", r"\1었어요"),
        (r"한다(?=\s|[.!?…]|$)", "해요"),
    )
    for pattern, replacement in replacements:
        normalized = re.sub(pattern, replacement, normalized)
    return normalized


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

    @staticmethod
    def _resolve_category(meeting_type: str, category: str | None) -> str:
        if category and str(category).strip():
            return normalize_category(category)
        if meeting_type and meeting_type in MEETING_TONE:
            return meeting_type
        if meeting_type:
            return meeting_type_for_category(meeting_type)
        return "other"

    @staticmethod
    def _category_context_text(category: str | None, meeting_type: str = "") -> str:
        resolved = StoryAIService._resolve_category(meeting_type, category)
        return resolve_category_context(resolved)

    @staticmethod
    def _style_context_text(template_type: str | None) -> str:
        return resolve_style_context(template_type)

    def build_story_prompt(
        self,
        *,
        title: str,
        meeting_type: str,
        event_date: str,
        description: str,
        existing_answers: str,
        media_records: list[dict[str, Any]] | None = None,
        category: str | None = None,
        template_type: str | None = None,
    ) -> tuple[str, str, str]:
        resolved = self._resolve_category(meeting_type, category)
        category_context = self._category_context_text(category, meeting_type)
        style_context = self._style_context_text(template_type)
        values = {
            "album_title": title or "우리의 추억",
            "album_description": description or "없음",
            "event_date": event_date or "없음",
            "meeting_type_label": category_label(resolved),
            "category_context": category_context,
            "style_context": style_context,
            "existing_answers": existing_answers or "아직 답변이 없습니다.",
        }
        analysis_summary = self._collect_media_analysis_summary(media_records or [])
        if analysis_summary:
            values["media_analysis_summary"] = analysis_summary
            prompt, version = self._prompts.render_prompt("story_enriched", **values)
            return prompt, version, "story_enriched"
        prompt, version = self._prompts.render_prompt("story_basic", **values)
        return prompt, version, "story_basic"

    def build_story_from_photo_stories_prompt(
        self,
        photo_stories: list[dict[str, Any]],
        meeting_type: str,
        title: str,
        optional_context: str = "",
        event_date: str = "",
        category: str | None = None,
        template_type: str | None = None,
    ) -> tuple[str, str, str]:
        ordered = sorted(photo_stories, key=lambda x: int(x.get("order", 0)))
        lines: list[str] = []
        for idx, item in enumerate(ordered, start=1):
            text = str(item.get("text") or "").strip()
            if text:
                lines.append(f'[사진 {idx}] "{text}"')
            else:
                lines.append(f"[사진 {idx}] (코멘트 없음)")
        resolved = self._resolve_category(meeting_type, category)
        category_context = self._category_context_text(category, meeting_type)
        style_context = self._style_context_text(template_type)
        values = {
            "album_title": title or "우리의 추억",
            "meeting_type_label": category_label(resolved),
            "category_context": category_context,
            "style_context": style_context,
            "event_date": event_date or "없음",
            "photo_stories_block": "\n".join(lines),
            "optional_context": optional_context or "없음",
            "meeting_tone": MEETING_TONE.get(resolved, MEETING_TONE["other"]),
        }
        prompt, version = self._prompts.render_prompt("story_from_stories", **values)
        prompt += (
            "\n\nFactual requirements for photo comments:\n"
            f"- Album date: {event_date or 'not provided'}. Do not treat this as a capture date for every photo.\n"
            "- Follow the supplied photo order. Use relationships, emotions, people, places, and situations only when explicitly stated in a photo comment.\n"
            "- Never invent or infer unconfirmed facts when a comment is blank or uncertain.\n"
            "- Use warm, natural Korean honorific prose throughout. End sentences with forms such as 했어요, 였어요, or 했습니다; never use informal endings such as 했다, 였다, 했지, or 한다.\n"
            f"- Album category context: {category_context}\n"
            f"- Album style context: {style_context}"
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
        category: str | None = None,
        template_type: str | None = None,
        album_id: str | None = None,
        family_id: str | None = None,
        actor_profile_id: str | None = None,
    ) -> str:
        has_story_text = any(str(item.get("text") or "").strip() for item in photo_stories)
        optional_context = "\n".join(
            value for value in (description.strip(), existing_answers.strip()) if value
        )
        if has_story_text:
            user_prompt, user_version, prompt_name = self.build_story_from_photo_stories_prompt(
                photo_stories,
                meeting_type,
                title,
                optional_context,
                event_date,
                category,
                template_type,
            )
        else:
            user_prompt, user_version, prompt_name = self.build_story_prompt(
                title=title,
                meeting_type=meeting_type,
                event_date=event_date,
                description=description,
                existing_answers=existing_answers,
                media_records=media_records,
                category=category,
                template_type=template_type,
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
        return normalize_story_honorifics(result.content)
