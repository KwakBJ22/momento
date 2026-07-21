import time
from pathlib import Path
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import AsyncMock, MagicMock, patch

from app.ai.model_router import ModelRouter
from app.ai.prompt_service import PromptManager
from app.ai.story_service import StoryAIService
from app.ai.types import AICompletionResult
from app.ai.vision_service import format_analysis_summary
from app.services.media_analysis_service import media_has_analysis
from app.services.openai_service import build_story_prompt
from app.services.question_service import build_question_prompt


class PromptManagerTests(TestCase):
    def test_load_prompt_parses_frontmatter(self) -> None:
        settings = SimpleNamespace(should_hot_reload_prompts=False)
        manager = PromptManager(settings)
        document = manager.load_prompt("question_basic")
        self.assertEqual(document.version, "1.0.0")
        self.assertIn("album_title", document.content)

    def test_render_prompt_substitutes_values(self) -> None:
        settings = SimpleNamespace(should_hot_reload_prompts=False)
        manager = PromptManager(settings)
        rendered, version = manager.render_prompt(
            "question_basic",
            album_title="제주",
            album_description="바다",
            event_date="2026-07-12",
            meeting_type_label="가족",
            photo_count="3",
            photo_index="1",
            existing_answers="없음",
        )
        self.assertEqual(version, "1.0.0")
        self.assertIn("제주", rendered)

    def test_hot_reload_detects_file_change(self) -> None:
        settings = SimpleNamespace(should_hot_reload_prompts=True)
        manager = PromptManager(settings)
        path = Path(__file__).resolve().parents[1] / "prompts" / "title_generation.md"
        original = path.read_text(encoding="utf-8")
        try:
            first = manager.load_prompt("title_generation")
            path.write_text(original.replace("1.0.0", "9.9.9"), encoding="utf-8")
            time.sleep(0.05)
            second = manager.load_prompt("title_generation")
            self.assertEqual(first.version, "1.0.0")
            self.assertEqual(second.version, "9.9.9")
        finally:
            path.write_text(original, encoding="utf-8")
            manager.clear_cache()

    def test_memory_cache_when_hot_reload_disabled(self) -> None:
        settings = SimpleNamespace(should_hot_reload_prompts=False)
        manager = PromptManager(settings)
        path = Path(__file__).resolve().parents[1] / "prompts" / "emotion_generation.md"
        original = path.read_text(encoding="utf-8")
        try:
            first = manager.load_prompt("emotion_generation")
            path.write_text(original.replace("1.0.0", "8.8.8"), encoding="utf-8")
            second = manager.load_prompt("emotion_generation")
            self.assertEqual(first.version, second.version)
        finally:
            path.write_text(original, encoding="utf-8")
            manager.clear_cache()


class ModelRouterTests(TestCase):
    def test_feature_specific_models(self) -> None:
        settings = SimpleNamespace(
            openai_model="gpt-4o-mini",
            vision_model="gpt-4o",
            question_model="gpt-4o-mini",
            story_model="gpt-4o-mini",
            title_model="",
            emotion_model="",
            timeline_model="",
            album_summary_model="",
        )
        router = ModelRouter(settings)
        self.assertEqual(router.resolve("vision"), "gpt-4o")
        self.assertEqual(router.resolve("question"), "gpt-4o-mini")
        self.assertEqual(router.resolve("title"), "gpt-4o-mini")


class QuestionPromptSelectionTests(TestCase):
    def test_basic_without_analysis(self) -> None:
        prompt = build_question_prompt(
            {"title": "제주", "event_date": "2026-07-12", "meeting_type": "family", "narrative": "바다"},
            photo_index=1,
            photo_count=2,
            existing_answers="없음",
        )
        self.assertIn("제주", prompt)
        self.assertNotIn("사진 분석", prompt)

    def test_enriched_with_analysis(self) -> None:
        prompt = build_question_prompt(
            {"title": "제주", "event_date": "2026-07-12", "meeting_type": "family", "narrative": "바다"},
            photo_index=1,
            photo_count=2,
            existing_answers="엄마: 좋았어요",
            media_analysis={"summary": "맑은 바다와 가족 사진"},
        )
        self.assertIn("맑은 바다", prompt)
        self.assertIn("사진 분석", prompt)


class StoryPromptSelectionTests(TestCase):
    def test_photo_comments_keep_current_order_and_album_date(self) -> None:
        settings = SimpleNamespace(should_hot_reload_prompts=False)
        service = StoryAIService(settings=settings, prompts=PromptManager(settings), ai=MagicMock())

        prompt, _, _ = service.build_story_from_photo_stories_prompt(
            [
                {"order": 1, "text": "second comment"},
                {"order": 0, "text": "first comment"},
                {"order": 2, "text": ""},
            ],
            "family",
            "album",
            event_date="2026-07-19",
        )

        self.assertLess(prompt.index("first comment"), prompt.index("second comment"))
        self.assertIn("2026-07-19", prompt)
        self.assertIn("Never invent or infer unconfirmed facts", prompt)
        self.assertIn("가족과의 추억", prompt)

    def test_category_context_with_and_without_category(self) -> None:
        settings = SimpleNamespace(should_hot_reload_prompts=True)
        service = StoryAIService(settings=settings, prompts=PromptManager(settings), ai=MagicMock())

        with_category, _, _ = service.build_story_from_photo_stories_prompt(
            [{"order": 0, "text": "바다"}],
            "family",
            "album",
            category="couple",
        )
        without_category, _, _ = service.build_story_from_photo_stories_prompt(
            [{"order": 0, "text": ""}],
            "family",
            "album",
            category=None,
        )
        basic, _, _ = service.build_story_prompt(
            title="album",
            meeting_type="friend",
            event_date="",
            description="",
            existing_answers="",
            category=None,
        )

        self.assertIn("연인과의 추억", with_category)
        self.assertIn("가족과의 추억", without_category)
        self.assertIn("친구들과의 추억", basic)
        self.assertNotIn("{category_context}", with_category)
        self.assertNotIn("{category_context}", without_category)
        self.assertNotIn("{style_context}", with_category)
        self.assertIn("차분하고 따뜻한 문체", with_category)

    def test_style_context_in_story_prompts(self) -> None:
        settings = SimpleNamespace(should_hot_reload_prompts=True)
        service = StoryAIService(settings=settings, prompts=PromptManager(settings), ai=MagicMock())

        joyful, _, _ = service.build_story_from_photo_stories_prompt(
            [{"order": 0, "text": "웃음"}],
            "friend",
            "album",
            category="friend",
            template_type="joyful",
        )
        special, _, _ = service.build_story_prompt(
            title="album",
            meeting_type="couple",
            event_date="",
            description="",
            existing_answers="",
            category="couple",
            template_type="special",
        )

        self.assertIn("경쾌하고 생동감", joyful)
        self.assertIn("감성적이고 시적인", special)
        self.assertNotIn("{style_context}", joyful)
        self.assertNotIn("{style_context}", special)

    def test_render_prompt_logs_missing_key(self) -> None:
        settings = SimpleNamespace(should_hot_reload_prompts=True)
        manager = PromptManager(settings)
        with self.assertRaises(KeyError), self.assertLogs("app.ai.prompt_service", level="ERROR") as logs:
            manager.render_prompt("story_from_stories", album_title="t")
        self.assertTrue(any("Prompt variable missing" in message for message in logs.output))

    def test_story_basic_without_analysis(self) -> None:
        prompt = build_story_prompt(
            title="제주 여행",
            meeting_type="family",
            event_date="2026-07-12",
            description="가족 바다 여행",
            existing_answers="엄마: 좋았어요",
            media_records=[],
        )
        self.assertIn("제주 여행", prompt)
        self.assertNotIn("사진 분석", prompt)

    def test_story_enriched_with_analysis(self) -> None:
        prompt = build_story_prompt(
            title="제주 여행",
            meeting_type="family",
            event_date="2026-07-12",
            description="가족 바다 여행",
            existing_answers="엄마: 좋았어요",
            media_records=[
                {
                    "sort_order": 0,
                    "media_analysis": {"summary": "맑은 바다", "scene": "해변"},
                }
            ],
        )
        self.assertIn("사진 분석", prompt)
        self.assertIn("맑은 바다", prompt)


class VisionBehaviorTests(TestCase):
    def test_media_has_analysis(self) -> None:
        self.assertFalse(media_has_analysis({}))
        self.assertTrue(media_has_analysis({"media_analysis": {"summary": "ok"}}))

    def test_format_analysis_summary(self) -> None:
        text = format_analysis_summary(
            {"summary": "웃는 가족", "subjects": ["엄마", "아이"], "mood": "행복"}
        )
        self.assertIn("웃는 가족", text)
        self.assertIn("엄마", text)

    def test_analyze_skips_already_analyzed_media(self) -> None:
        import asyncio

        from app.services.media_analysis_service import analyze_album_media

        client = MagicMock()
        media = {
            "id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
            "media_type": "image",
            "media_analysis": {"summary": "이미 분석됨"},
            "sort_order": 0,
        }
        with patch(
            "app.services.media_analysis_service.analyze_media_with_vision", new_callable=AsyncMock
        ) as analyze_one:
            result = asyncio.run(
                analyze_album_media(
                    client,
                    album_id="11111111-1111-1111-1111-111111111111",
                    album={"title": "제주"},
                    media_records=[media],
                )
            )
        self.assertEqual(result["skipped_media_ids"], [media["id"]])
        analyze_one.assert_not_called()


class AIServiceIntegrationTests(TestCase):
    def test_question_generation_uses_ai_service(self) -> None:
        import asyncio

        from app.services.question_service import generate_questions_for_media

        mock_result = AICompletionResult(
            content='["질문1","질문2","질문3"]',
            model="gpt-4o-mini",
            prompt_name="question_system+question_basic",
            prompt_version="1.0.0+1.0.0",
            input_tokens=10,
            output_tokens=20,
            estimated_cost=0.0001,
            latency_ms=100,
        )
        with patch("app.ai.question_service.AIService") as mock_ai_cls:
            mock_ai = mock_ai_cls.return_value
            mock_ai.chat_completion = AsyncMock(return_value=mock_result)
            questions, prompt = asyncio.run(
                generate_questions_for_media(
                    MagicMock(),
                    album={"title": "제주", "event_date": "2026-07-12", "meeting_type": "family", "narrative": "바다"},
                    media={"id": "media", "sort_order": 0},
                    photo_index=1,
                    photo_count=3,
                    existing_answers="아직 답변이 없습니다.",
                )
            )
        self.assertEqual(len(questions), 3)
        self.assertIn("제주", prompt)
        mock_ai.chat_completion.assert_awaited_once()
        self.assertEqual(mock_ai.chat_completion.await_args.kwargs["feature"], "question")
