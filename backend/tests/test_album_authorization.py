from datetime import datetime, timezone
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.album import router
from app.services.auth import require_authenticated_user


ALBUM_ID = "11111111-1111-1111-1111-111111111111"
OWNER_ID = "22222222-2222-2222-2222-222222222222"
OTHER_USER_ID = "33333333-3333-3333-3333-333333333333"


def album_record(owner_id: str = OWNER_ID) -> dict[str, object]:
    return {
        "id": ALBUM_ID,
        "owner_id": owner_id,
        "meeting_type": "family",
        "template": "B",
        "title": "Test album",
        "event_date": "2026-07-12",
        "narrative": "Original narrative",
        "result_path": "result.png",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }


class AlbumAuthorizationTests(TestCase):
    def setUp(self) -> None:
        self.app = FastAPI()
        self.app.include_router(router)
        self.client = TestClient(self.app)
        self.settings = SimpleNamespace(frontend_base_url="https://momento.example")

        self.get_settings = patch("app.api.album.get_settings", return_value=self.settings)
        self.get_supabase_client = patch("app.api.album.get_supabase_client", return_value=object())
        self.get_public_url = patch("app.api.album.get_public_url", return_value="https://cdn.example/album.png")
        self.get_settings.start()
        self.get_supabase_client.start()
        self.get_public_url.start()
        self.addCleanup(self.get_settings.stop)
        self.addCleanup(self.get_supabase_client.stop)
        self.addCleanup(self.get_public_url.stop)

    def tearDown(self) -> None:
        self.app.dependency_overrides.clear()

    def as_user(self, user_id: str) -> None:
        self.app.dependency_overrides[require_authenticated_user] = lambda: user_id

    def test_owner_can_update_album(self) -> None:
        self.as_user(OWNER_ID)
        with patch("app.api.album.get_album_record", return_value=album_record()), patch(
            "app.api.album.update_album_narrative",
            return_value={**album_record(), "narrative": "Updated narrative"},
        ):
            response = self.client.patch(f"/api/albums/{ALBUM_ID}", json={"narrative": "Updated narrative"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["narrative"], "Updated narrative")

    def test_owner_can_delete_album(self) -> None:
        self.as_user(OWNER_ID)
        with patch("app.api.album.get_album_record", return_value=album_record()), patch(
            "app.api.album.delete_album_record"
        ) as delete_album_record:
            response = self.client.delete(f"/api/albums/{ALBUM_ID}")

        self.assertEqual(response.status_code, 204)
        delete_album_record.assert_called_once()

    def test_non_owner_cannot_update_even_if_owner_id_is_sent(self) -> None:
        self.as_user(OTHER_USER_ID)
        with patch("app.api.album.get_album_record", return_value=album_record()):
            response = self.client.patch(
                f"/api/albums/{ALBUM_ID}",
                json={"narrative": "Attempted update", "ownerId": OWNER_ID},
            )

        self.assertEqual(response.status_code, 403)

    def test_non_owner_cannot_delete(self) -> None:
        self.as_user(OTHER_USER_ID)
        with patch("app.api.album.get_album_record", return_value=album_record()):
            response = self.client.delete(f"/api/albums/{ALBUM_ID}")

        self.assertEqual(response.status_code, 403)

    def test_unauthenticated_update_is_rejected(self) -> None:
        response = self.client.patch(f"/api/albums/{ALBUM_ID}", json={"narrative": "Attempted update"})

        self.assertEqual(response.status_code, 401)

    def test_missing_album_cannot_be_updated_or_deleted(self) -> None:
        self.as_user(OWNER_ID)
        with patch("app.api.album.get_album_record", return_value=None):
            update_response = self.client.patch(f"/api/albums/{ALBUM_ID}", json={"narrative": "Updated narrative"})
            delete_response = self.client.delete(f"/api/albums/{ALBUM_ID}")

        self.assertEqual(update_response.status_code, 404)
        self.assertEqual(delete_response.status_code, 404)

    def test_public_link_can_read_but_not_edit_or_delete(self) -> None:
        with patch("app.api.album.get_album_record", return_value=album_record()):
            get_response = self.client.get(f"/api/albums/{ALBUM_ID}")
            patch_response = self.client.patch(f"/api/albums/{ALBUM_ID}", json={"narrative": "Attempted update"})
            delete_response = self.client.delete(f"/api/albums/{ALBUM_ID}")

        self.assertEqual(get_response.status_code, 200)
        self.assertEqual(patch_response.status_code, 401)
        self.assertEqual(delete_response.status_code, 401)
