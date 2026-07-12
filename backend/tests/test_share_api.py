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
        patch("app.api.share.get_settings", return_value=SimpleNamespace(supabase_storage_bucket="albums")).start()
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
