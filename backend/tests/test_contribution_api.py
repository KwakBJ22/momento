from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import MagicMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.collaboration import router


ALBUM_ID = "11111111-1111-1111-1111-111111111111"
CONTRIBUTOR_ID = "22222222-2222-2222-2222-222222222222"
PHOTO_ID = "33333333-3333-3333-3333-333333333333"
MEMORY_ID = "44444444-4444-4444-4444-444444444444"


class ContributionUploadApiTests(TestCase):
    def setUp(self) -> None:
        self.app = FastAPI()
        self.app.include_router(router)
        self.client = TestClient(self.app)
        self.supabase = MagicMock()
        self.supabase.table.return_value.select.return_value.eq.return_value.execute.return_value.data = []
        self.settings = SimpleNamespace(supabase_private_storage_bucket="private", signed_url_ttl_seconds=3600)

        self.settings_patch = patch("app.api.collaboration.get_settings", return_value=self.settings)
        self.client_patch = patch("app.api.collaboration.get_supabase_client", return_value=self.supabase)
        self.album_patch = patch(
            "app.api.collaboration.get_album_record",
            return_value={"id": ALBUM_ID, "photo_limit": 30, "family_id": "family-1"},
        )
        self.contributor_patch = patch(
            "app.api.collaboration.require_contributor", return_value={"id": CONTRIBUTOR_ID, "display_name": "민수"}
        )
        self.count_patch = patch("app.api.collaboration.count_ready_photos", return_value=2)
        self.process_patch = patch(
            "app.api.collaboration.process_upload",
            return_value=SimpleNamespace(
                checksum_sha256="checksum",
                original_mime_type="image/jpeg",
                original_bytes=b"image",
                width=1200,
                height=800,
                orientation="landscape",
                taken_at=None,
                latitude=None,
                longitude=None,
            ),
        )
        self.assets_patch = patch(
            "app.api.collaboration.upload_album_photo_assets",
            return_value=("photos/new.jpg", "thumbnails/new.jpg"),
        )
        self.save_patch = patch("app.api.collaboration.save_album_photo_records")
        self.sign_patch = patch(
            "app.api.collaboration.get_signed_url",
            side_effect=lambda _client, _bucket, path, _ttl: f"https://cdn.example/{path}",
        )
        self.dirty_patch = patch("app.api.collaboration.mark_album_dirty")
        self.memory_patch = patch(
            "app.api.collaboration.create_photo_memory",
            return_value={
                "id": MEMORY_ID,
                "photo_id": PHOTO_ID,
                "contributor_id": CONTRIBUTOR_ID,
                "author_name": "참여자",
                "relationship": None,
                "comment": "새로 남긴 기억",
                "created_at": "2026-07-23T10:00:00+00:00",
                "updated_at": "2026-07-23T10:00:00+00:00",
            },
        )
        for item in (
            self.settings_patch,
            self.client_patch,
            self.album_patch,
            self.contributor_patch,
            self.count_patch,
            self.process_patch,
            self.assets_patch,
            self.save_patch,
            self.sign_patch,
            self.dirty_patch,
            self.memory_patch,
        ):
            item.start()
            self.addCleanup(item.stop)

    def test_upload_response_contains_the_new_photo_and_reusable_thumbnail_url(self) -> None:
        response = self.client.post(
            f"/api/albums/{ALBUM_ID}/contribute/photos",
            files={"photos": ("new.jpg", b"image", "image/jpeg")},
            headers={"X-Momento-Contributor-Id": CONTRIBUTOR_ID},
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["photo_count"], 3)
        self.assertEqual(len(payload["photos"]), 1)
        self.assertEqual(payload["photos"][0]["thumbnail_url"], "https://cdn.example/thumbnails/new.jpg")
        self.assertEqual(payload["photos"][0]["author_name"], "민수")
        self.assertTrue(payload["photos"][0]["created_at"])
        self.assertEqual(payload["photos"][0]["memories"], [])

    def test_memory_creation_returns_the_saved_memory_for_inline_rendering(self) -> None:
        response = self.client.post(
            f"/api/albums/{ALBUM_ID}/photos/{PHOTO_ID}/memories",
            json={"comment": "새로 남긴 기억", "contributor_id": CONTRIBUTOR_ID},
            headers={"X-Momento-Contributor-Id": CONTRIBUTOR_ID},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["id"], MEMORY_ID)
        self.assertEqual(response.json()["comment"], "새로 남긴 기억")
        self.assertTrue(response.json()["mine"])
        self.assertNotIn("photos", response.json())
        self.assertNotIn("album_json", response.json())
