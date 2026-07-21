from datetime import datetime, timezone
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.album import router as album_router
from app.api.memory import router as memory_router
from app.services.auth import require_authenticated_user
from app.services.authorization import AlbumAccess


ALBUM_ID = "11111111-1111-1111-1111-111111111111"
MEDIA_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
QUESTION_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
ANSWER_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc"
OWNER_ID = "22222222-2222-2222-2222-222222222222"
VIEWER_ID = "55555555-5555-5555-5555-555555555555"
OTHER_ID = "66666666-6666-6666-6666-666666666666"


def album_record() -> dict[str, object]:
    return {
        "id": ALBUM_ID,
        "owner_id": OWNER_ID,
        "family_id": "ffffffff-ffff-ffff-ffff-ffffffffffff",
        "title": "제주 여행",
        "event_date": "2026-07-12",
        "meeting_type": "family",
    }


def question_row() -> dict[str, object]:
    return {
        "id": QUESTION_ID,
        "album_id": ALBUM_ID,
        "media_id": MEDIA_ID,
        "question": "이날 가장 기억나는 순간은?",
        "sort_order": 0,
        "status": "active",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }


class MemoryQuestionApiTests(TestCase):
    def setUp(self) -> None:
        self.app = FastAPI()
        self.app.include_router(memory_router)
        self.app.include_router(album_router)
        self.client = TestClient(self.app)
        self.settings = SimpleNamespace(
            frontend_base_url="https://momento.example",
            openai_model="gpt-4o-mini",
            supabase_private_storage_bucket="momento-private",
            signed_url_ttl_seconds=300,
        )
        patch("app.api.memory.get_settings", return_value=self.settings).start()
        patch("app.api.album.get_settings", return_value=self.settings).start()
        self.mock_client = MagicMock()
        patch("app.api.memory.get_supabase_client", return_value=self.mock_client).start()
        self.addCleanup(patch.stopall)

    def tearDown(self) -> None:
        self.app.dependency_overrides.clear()

    def as_user(self, user_id: str) -> None:
        self.app.dependency_overrides[require_authenticated_user] = lambda: user_id

    def test_list_questions_requires_album_access(self) -> None:
        self.as_user(OTHER_ID)
        with patch("app.api.memory.get_album_record", return_value=album_record()), patch(
            "app.api.memory.get_album_access", return_value=AlbumAccess(None, None, False)
        ):
            response = self.client.get(f"/api/albums/{ALBUM_ID}/memory/questions")
        self.assertEqual(response.status_code, 403)

    def test_viewer_can_save_answer(self) -> None:
        self.as_user(VIEWER_ID)
        with patch("app.api.memory.get_question_by_id", return_value=question_row()), patch(
            "app.api.memory.get_album_record", return_value=album_record()
        ), patch(
            "app.api.memory.get_album_access",
            return_value=AlbumAccess("viewer", "viewer", False),
        ), patch("app.api.memory.upsert_answer", return_value={"id": ANSWER_ID}), patch(
            "app.api.memory.list_question_answers",
            return_value=[
                {
                    "id": ANSWER_ID,
                    "question_id": QUESTION_ID,
                    "profile_id": VIEWER_ID,
                    "answer": "바다가 좋았어요",
                    "answer_type": "text",
                    "voice_url": None,
                    "created_at": datetime.now(timezone.utc).isoformat(),
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                    "profiles": {"display_name": "엄마"},
                }
            ],
        ):
            response = self.client.put(
                f"/api/memory/questions/{QUESTION_ID}/answers",
                json={"answer": "바다가 좋았어요"},
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["answer"], "바다가 좋았어요")

    def test_viewer_cannot_regenerate(self) -> None:
        self.as_user(VIEWER_ID)
        with patch("app.api.memory.get_album_record", return_value=album_record()), patch(
            "app.api.memory.get_album_access",
            return_value=AlbumAccess("viewer", "viewer", False),
        ):
            response = self.client.post(f"/api/albums/{ALBUM_ID}/memory/questions/regenerate", json={})
        self.assertEqual(response.status_code, 403)

    def test_generate_skips_cached_media(self) -> None:
        self.as_user(OWNER_ID)
        with patch("app.api.memory.get_album_record", return_value=album_record()), patch(
            "app.api.memory.get_album_access",
            return_value=AlbumAccess("owner", "owner", False),
        ), patch(
            "app.api.memory.get_album_media_records",
            return_value=[{"id": MEDIA_ID, "media_type": "image", "mime_type": "image/jpeg"}],
        ), patch(
            "app.api.memory.generate_album_questions",
            new_callable=AsyncMock,
            return_value={"generated_media_ids": [], "skipped_media_ids": [MEDIA_ID], "question_count": 0},
        ) as generate:
            response = self.client.post(f"/api/albums/{ALBUM_ID}/memory/questions/generate", json={})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["skipped_media_ids"], [MEDIA_ID])
        generate.assert_awaited_once()


class QuestionServiceTests(TestCase):
    def test_parse_questions_json(self) -> None:
        from app.services.question_service import _parse_questions_json

        questions = _parse_questions_json('["질문1", "질문2", "질문3"]')
        self.assertEqual(len(questions), 3)

    def test_media_has_active_questions_cache(self) -> None:
        from app.services.question_service import media_has_active_questions

        client = MagicMock()
        client.table.return_value.select.return_value.eq.return_value.eq.return_value.limit.return_value.execute.return_value = SimpleNamespace(
            data=[{"id": QUESTION_ID}]
        )
        self.assertTrue(media_has_active_questions(client, MEDIA_ID))

    def test_generate_album_questions_skips_without_force(self) -> None:
        import asyncio
        from app.services.question_service import generate_album_questions

        client = MagicMock()
        with patch("app.services.question_service.media_has_active_questions", return_value=True), patch(
            "app.services.question_service.generate_questions_for_media", new_callable=AsyncMock
        ) as generate_one:
            result = asyncio.run(
                generate_album_questions(
                    client,
                    album_id=ALBUM_ID,
                    album=album_record(),
                    media_records=[{"id": MEDIA_ID, "media_type": "image"}],
                    force=False,
                )
            )
        self.assertEqual(result["skipped_media_ids"], [MEDIA_ID])
        generate_one.assert_not_called()


class MediaAnalysisTests(TestCase):
    def test_analyze_media_api(self) -> None:
        app = FastAPI()
        app.include_router(memory_router)
        client = TestClient(app)
        app.dependency_overrides[require_authenticated_user] = lambda: OWNER_ID
        settings = SimpleNamespace(
            openai_model="gpt-4o-mini",
            supabase_private_storage_bucket="momento-private",
        )
        with patch("app.api.memory.get_settings", return_value=settings), patch(
            "app.api.memory.get_supabase_client", return_value=MagicMock()
        ), patch("app.api.memory.get_album_record", return_value=album_record()), patch(
            "app.api.memory.get_album_access", return_value=AlbumAccess("owner", "owner", False)
        ), patch(
            "app.api.memory.get_album_media_records",
            return_value=[{"id": MEDIA_ID, "media_type": "image", "sort_order": 0}],
        ), patch(
            "app.api.memory.analyze_album_media",
            new_callable=AsyncMock,
            return_value={"analyzed_media_ids": [MEDIA_ID], "skipped_media_ids": []},
        ):
            response = client.post(f"/api/albums/{ALBUM_ID}/media/analyze", json={})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["analyzed_media_ids"], [MEDIA_ID])
