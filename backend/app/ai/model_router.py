from __future__ import annotations

from typing import Literal

from app.config import Settings, get_settings

AIFeature = Literal["default", "vision", "question", "story", "title", "emotion", "timeline", "album_summary"]


class ModelRouter:
    def __init__(self, settings: Settings | None = None) -> None:
        self._settings = settings or get_settings()

    def resolve(self, feature: AIFeature) -> str:
        mapping = {
            "vision": self._settings.vision_model,
            "question": self._settings.question_model,
            "story": self._settings.story_model,
            "title": self._settings.title_model,
            "emotion": self._settings.emotion_model,
            "timeline": self._settings.timeline_model,
            "album_summary": self._settings.album_summary_model,
            "default": self._settings.openai_model,
        }
        selected = mapping.get(feature) or ""
        return selected.strip() or self._settings.openai_model
