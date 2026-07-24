from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import MagicMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.collaboration import router
from app.services.auth import require_authenticated_user


ALBUM_ID = "11111111-1111-1111-1111-111111111111"
HOST_ID = "22222222-2222-2222-2222-222222222222"


class AlbumParticipationApiTests(TestCase):
    def setUp(self) -> None:
        app = FastAPI()
        app.include_router(router)
        app.dependency_overrides[require_authenticated_user] = lambda: HOST_ID
        self.addCleanup(app.dependency_overrides.clear)
        self.client = TestClient(app)
        self.db = MagicMock()
        photo_query = self.db.table.return_value.select.return_value.eq.return_value.eq.return_value.is_.return_value
        photo_query.execute.return_value = SimpleNamespace(data=[
            {"id": "photo-1", "uploaded_by_contributor_id": "host-contributor", "created_at": "2026-07-23T10:00:00+00:00"},
            {"id": "photo-2", "uploaded_by_contributor_id": "guest-contributor", "created_at": "2026-07-23T11:00:00+00:00"},
        ])
        self.ensure_owner_patch = patch("app.api.collaboration.ensure_owner_contributor")
        self.patches = [
            patch("app.api.collaboration.get_settings", return_value=SimpleNamespace()),
            patch("app.api.collaboration.get_supabase_client", return_value=self.db),
            patch("app.api.collaboration.get_album_record", return_value={"id": ALBUM_ID, "created_at": "2026-07-23T09:00:00+00:00", "created_by": HOST_ID}),
            patch("app.api.collaboration.get_album_access", return_value=MagicMock()),
            patch("app.api.collaboration.require_album_read"),
            self.ensure_owner_patch,
            patch("app.api.collaboration.list_contributors", return_value=[
                {"id": "host-contributor", "display_name": "병준", "role": "owner"},
                {"id": "guest-contributor", "display_name": "민수", "role": "contributor"},
            ]),
            patch("app.api.collaboration.list_photo_memories", return_value=[
                {"id": "memory-1", "contributor_id": "guest-contributor", "author_name": "민수", "created_at": "2026-07-23T11:05:00+00:00"},
            ]),
        ]
        for item in self.patches:
            started = item.start()
            if item is self.ensure_owner_patch:
                self.ensure_owner = started
            self.addCleanup(item.stop)

    def test_album_participants_are_returned_for_the_requested_album(self) -> None:
        response = self.client.get(f"/api/albums/{ALBUM_ID}/participation")

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["participants"], [
            {"id": "host-contributor", "name": "병준", "role": "host", "photo_count": 1, "memory_count": 0, "last_active_at": "2026-07-23T10:00:00+00:00"},
            {"id": "guest-contributor", "name": "민수", "role": "participant", "photo_count": 1, "memory_count": 1, "last_active_at": "2026-07-23T11:05:00+00:00"},
        ])
        self.assertEqual(body["recommended_mode"], "append_page")
        self.ensure_owner.assert_called_once_with(self.db, {"id": ALBUM_ID, "created_at": "2026-07-23T09:00:00+00:00", "created_by": HOST_ID}, HOST_ID)
