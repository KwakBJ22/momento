from __future__ import annotations

import base64
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException
from supabase import Client

from app.ai.ai_service import AIService
from app.ai.parsers import parse_analysis_json
from app.ai.prompt_service import PromptManager
from app.config import Settings, get_settings


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


class VisionAIService:
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
    def _image_data_url(image_bytes: bytes, mime_type: str) -> str:
        encoded = base64.b64encode(image_bytes).decode("ascii")
        return f"data:{mime_type};base64,{encoded}"

    async def analyze_image(
        self,
        *,
        album: dict[str, Any],
        image_bytes: bytes,
        mime_type: str,
        photo_index: int,
        photo_count: int,
        album_id: str | None = None,
        family_id: str | None = None,
        actor_profile_id: str | None = None,
    ) -> dict[str, Any]:
        system_prompt, system_version = self._prompts.render_prompt("vision_analysis")
        user_prompt, user_version = self._prompts.render_prompt(
            "vision_analysis_user",
            album_title=str(album.get("title") or "우리의 모임"),
            album_description=str(album.get("narrative") or album.get("description") or ""),
            event_date=str(album.get("event_date") or ""),
            photo_index=str(photo_index),
            photo_count=str(photo_count),
        )
        result = await self._ai.vision_completion(
            messages=[
                {"role": "system", "content": system_prompt},
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": user_prompt},
                        {"type": "image_url", "image_url": {"url": self._image_data_url(image_bytes, mime_type)}},
                    ],
                },
            ],
            system_prompt_name="vision_analysis",
            system_prompt_version=system_version,
            user_prompt_name="vision_analysis_user",
            user_prompt_version=user_version,
            family_id=family_id,
            album_id=album_id,
            actor_profile_id=actor_profile_id,
        )
        parsed = parse_analysis_json(result.content)
        parsed["analyzed_at"] = datetime.now(timezone.utc).isoformat()
        parsed["provider"] = "openai"
        parsed["model"] = result.model
        parsed["prompt_name"] = result.prompt_name
        parsed["prompt_version"] = result.prompt_version
        return parsed
