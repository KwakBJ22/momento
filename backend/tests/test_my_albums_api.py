from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.album import router
from app.services.auth import require_authenticated_user


PROFILE_ID = "22222222-2222-2222-2222-222222222222"
NEW_ALBUM_ID = "11111111-1111-1111-1111-111111111111"
OLD_ALBUM_ID = "33333333-3333-3333-3333-333333333333"


class MyAlbumsApiTests(TestCase):
    def setUp(self) -> None:
        app = FastAPI()
        app.include_router(router)
        app.dependency_overrides[require_authenticated_user] = lambda: PROFILE_ID
        self.addCleanup(app.dependency_overrides.clear)
        self.client = TestClient(app)
        self.patches = [
            patch("app.api.album.get_settings", return_value=SimpleNamespace()),
            patch("app.api.album.get_supabase_client"),
            patch("app.api.album.get_pending_guest_memory_counts", return_value={NEW_ALBUM_ID: 2}),
            patch("app.api.album.get_public_url", side_effect=lambda _client, path, _settings: f"https://cdn.example/{path}"),
            patch("app.api.album.list_owned_album_records", return_value=[
                {
                    "id": NEW_ALBUM_ID,
                    "title": "새 앨범",
                    "created_at": "2026-07-23T12:00:00+00:00",
                    "result_path": "new/result.png",
                    "photo_paths": ["new/1.jpg", "new/2.jpg"],
                },
                {
                    "id": OLD_ALBUM_ID,
                    "title": "이전 앨범",
                    "created_at": "2026-07-22T12:00:00+00:00",
                    "result_path": "old/result.png",
                    "photo_paths": ["old/1.jpg"],
                },
            ]),
        ]
        for item in self.patches:
            item.start()
            self.addCleanup(item.stop)

    def test_claimed_owner_album_is_returned_first_by_my_albums_api(self) -> None:
        response = self.client.get("/api/albums/mine")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["cache-control"], "no-store")
        body = response.json()
        self.assertEqual([album["album_id"] for album in body["albums"]], [NEW_ALBUM_ID, OLD_ALBUM_ID])
        self.assertEqual(body["albums"][0]["photo_count"], 2)
        self.assertEqual(body["albums"][0]["new_memory_count"], 2)
