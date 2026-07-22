from datetime import datetime, timezone
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import MagicMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.share import _rate_windows, router
from app.services.auth import require_authenticated_user


ALBUM_ID = "11111111-1111-1111-1111-111111111111"
OWNER_ID = "22222222-2222-2222-2222-222222222222"
SHARE_ID = "33333333-3333-3333-3333-333333333333"


def album() -> dict[str, object]:
    return {"id": ALBUM_ID, "title": "우리의 추억", "narrative": "함께 웃었던 날", "result_path": "result.png"}


def share() -> dict[str, object]:
    return {"id": SHARE_ID, "album_id": ALBUM_ID, "status": "active", "view_count": 0}


class ShareApiTests(TestCase):
    def setUp(self) -> None:
        self.app = FastAPI()
        self.app.include_router(router)
        self.client = TestClient(self.app)
        self.mock_client = MagicMock()
        patch("app.api.share.get_supabase_client", return_value=self.mock_client).start()
        patch(
            "app.api.share.get_settings",
            return_value=SimpleNamespace(supabase_storage_bucket="albums", signed_url_ttl_seconds=3600),
        ).start()
        self.addCleanup(patch.stopall)
        _rate_windows.clear()

    def as_user(self) -> None:
        self.app.dependency_overrides[require_authenticated_user] = lambda: OWNER_ID

    def tearDown(self) -> None:
        self.app.dependency_overrides.clear()

    def test_public_album_is_readable_without_storage_paths(self) -> None:
        with patch("app.api.share.get_active_share", return_value=share()), patch(
            "app.api.share.get_album_record", return_value=album()
        ), patch("app.api.share.get_album_media_records", return_value=[{"media_type": "video", "mime_type": "video/mp4", "processing_status": "pending", "original_filename": "clip.mp4", "original_path": "private/path"}]), patch(
            "app.api.share.get_public_url", return_value="https://cdn.example/result.png"
        ), patch("app.api.share.increment_view"), patch("app.api.share.log_event"):
            response = self.client.get("/api/public/shares/opaque-token")

        self.assertEqual(response.status_code, 200)
        self.assertNotIn("original_path", response.text)
        self.assertNotIn("private/path", response.text)

    def test_public_share_hides_legacy_captions_and_ineligible_date_stories(self) -> None:
        dated_photos = [
            {
                "id": f"00000000-0000-0000-0000-{index:012d}",
                "sort_order": index,
                "caption": "자동 문구만 있는 사진" if index == 0 else "",
                "comment": "사용자가 쓴 코멘트" if index == 1 else None,
                "storage_bucket": "private",
                "storage_path": f"photos/{index}.jpg",
                "thumbnail_bucket": "private",
                "thumbnail_path": f"thumbs/{index}.jpg",
                "taken_at": "2026-07-12T10:00:00Z" if index < 4 else "2026-07-13T10:00:00Z",
            }
            for index in range(9)
        ]
        album_with_stories = {
            **album(),
            "chapter_stories": {
                "2026-07-12": "4장 날짜 이야기는 숨겨야 합니다.",
                "2026-07-13": "5장 날짜 이야기만 표시합니다.",
                "2026-07": "월별 이야기는 절대 표시하지 않습니다.",
            },
        }
        with patch("app.api.share.get_active_share", return_value=share()), patch(
            "app.api.share.get_album_record", return_value=album_with_stories
        ), patch("app.api.share.get_album_media_records", return_value=[]), patch(
            "app.api.share.get_album_photo_records", return_value=dated_photos
        ), patch("app.api.share.list_photo_memories", return_value=[]), patch(
            "app.api.share.get_signed_url", return_value="https://cdn.example/photo.jpg"
        ), patch("app.api.share.get_public_url", return_value="https://cdn.example/result.png"), patch(
            "app.api.share.increment_view"
        ), patch("app.api.share.log_event"):
            response = self.client.get("/api/public/shares/opaque-token")

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["photos"][0]["comment"], None)
        self.assertEqual(body["photos"][1]["comment"], "사용자가 쓴 코멘트")
        self.assertEqual(body["chapter_stories"], {"2026-07-13": "5장 날짜 이야기만 표시합니다."})

    def test_inactive_or_expired_share_is_blocked(self) -> None:
        with patch("app.api.share.get_active_share", side_effect=__import__("fastapi").HTTPException(status_code=404, detail="expired")):
            response = self.client.get("/api/public/shares/expired")
        self.assertEqual(response.status_code, 404)

    def test_guest_memory_is_temporarily_stored_with_honeypot_guard(self) -> None:
        with patch("app.api.share.get_active_share", return_value=share()), patch(
            "app.api.share.create_guest_memory", return_value=({}, "claim-token-value-which-is-long-enough")
        ), patch("app.api.share.log_event"):
            response = self.client.post("/api/public/shares/opaque/guest-memories", json={"name": "민지", "memory": "따뜻했던 저녁", "website": ""})
        self.assertEqual(response.status_code, 201)
        self.assertIn("claim_token", response.json())

    def test_honeypot_blocks_guest_submission(self) -> None:
        response = self.client.post("/api/public/shares/opaque/guest-memories", json={"name": "봇", "memory": "spam", "website": "https://bot.example"})
        self.assertEqual(response.status_code, 400)

    def test_public_rate_limit(self) -> None:
        with patch("app.api.share.get_active_share", return_value=share()), patch("app.api.share.get_album_record", return_value=album()), patch("app.api.share.get_album_media_records", return_value=[]), patch("app.api.share.get_public_url", return_value="url"), patch("app.api.share.increment_view"), patch("app.api.share.log_event"):
            for _ in range(60):
                self.assertEqual(self.client.get("/api/public/shares/rate-token").status_code, 200)
            self.assertEqual(self.client.get("/api/public/shares/rate-token").status_code, 429)
