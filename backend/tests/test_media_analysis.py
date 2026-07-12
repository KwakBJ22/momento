from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import MagicMock, patch

from app.services.media_analysis_service import format_analysis_summary
from app.services.openai_service import build_story_prompt


class StoryGenerationTests(TestCase):
    def test_story_without_analysis_uses_context_prompt(self) -> None:
        prompt = build_story_prompt(
            title="제주 여행",
            meeting_type="family",
            event_date="2026-07-12",
            description="가족 바다 여행",
            existing_answers="엄마: 좋았어요",
            media_records=[],
        )
        self.assertIn("제주 여행", prompt)
        self.assertNotIn("AI 사진 분석", prompt)

    def test_story_with_analysis_uses_analysis_prompt(self) -> None:
        prompt = build_story_prompt(
            title="제주 여행",
            meeting_type="family",
            event_date="2026-07-12",
            description="가족 바다 여행",
            existing_answers="엄마: 좋았어요",
            media_records=[
                {
                    "sort_order": 0,
                    "media_analysis": {
                        "summary": "맑은 바다",
                        "scene": "해변",
                    },
                }
            ],
        )
        self.assertIn("AI 사진 분석", prompt)
        self.assertIn("맑은 바다", prompt)

    def test_format_analysis_summary(self) -> None:
        text = format_analysis_summary(
            {"summary": "웃는 가족", "subjects": ["엄마", "아이"], "mood": "행복"}
        )
        self.assertIn("웃는 가족", text)
        self.assertIn("엄마", text)
