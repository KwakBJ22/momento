from datetime import datetime, timezone
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import MagicMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.album import _edition_document_and_pages, _previous_edition_number, router
from app.services.authorization import resolve_album_access
from app.api.auth import router as auth_router
from app.services.auth import require_authenticated_user


ALBUM_ID = "11111111-1111-1111-1111-111111111111"
OWNER_ID = "22222222-2222-2222-2222-222222222222"
OTHER_USER_ID = "33333333-3333-3333-3333-333333333333"
PHOTO_ID = "44444444-4444-4444-4444-444444444444"


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
        self.app.include_router(auth_router)
        self.client = TestClient(self.app)
        self.settings = SimpleNamespace(frontend_base_url="https://momento.example", signed_url_ttl_seconds=3600)

        self.get_settings = patch("app.api.album.get_settings", return_value=self.settings)
        self.supabase_client = MagicMock()
        self.get_supabase_client = patch("app.api.album.get_supabase_client", return_value=self.supabase_client)
        self.get_public_url = patch("app.api.album.get_public_url", return_value="https://cdn.example/album.png")
        self.get_album_media_records = patch("app.api.album.get_album_media_records", return_value=[])
        self.get_album_photo_records = patch("app.api.album.get_album_photo_records", return_value=[])
        self.get_album_access = patch(
            "app.api.album.get_album_access",
            side_effect=lambda client, album, user_id: resolve_album_access(album, user_id, None, None),
        )
        self.get_settings.start()
        self.get_supabase_client.start()
        self.get_public_url.start()
        self.get_album_media_records.start()
        self.get_album_photo_records.start()
        self.get_album_access.start()
        self.addCleanup(self.get_settings.stop)
        self.addCleanup(self.get_supabase_client.stop)
        self.addCleanup(self.get_public_url.stop)
        self.addCleanup(self.get_album_media_records.stop)
        self.addCleanup(self.get_album_photo_records.stop)
        self.addCleanup(self.get_album_access.stop)

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

    def test_owner_can_save_a_photo_comment(self) -> None:
        self.as_user(OWNER_ID)
        with patch("app.api.album.get_album_record", return_value=album_record()), patch(
            "app.api.album.update_album_photo_comment",
            return_value={"id": PHOTO_ID, "comment": "Updated photo comment"},
        ):
            response = self.client.patch(
                f"/api/albums/{ALBUM_ID}/photos/{PHOTO_ID}/comment",
                json={"comment": "Updated photo comment"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["comment"], "Updated photo comment")

    def test_owner_can_update_epilogue(self) -> None:
        self.as_user(OWNER_ID)
        updated = {**album_record(), "epilogue": "Updated epilogue", "narrative": "Updated epilogue"}
        with patch("app.api.album.get_album_record", return_value=album_record()), patch(
            "app.api.album.update_album_epilogue", return_value=updated
        ), patch("app.api.album.count_ready_album_photos", return_value=0), patch(
            "app.api.album.count_album_photo_memories", return_value=0
        ):
            response = self.client.patch(
                f"/api/albums/{ALBUM_ID}/epilogue",
                json={"epilogue": "Updated epilogue"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["epilogue"], "Updated epilogue")

    def test_my_albums_returns_only_the_authenticated_creators_albums(self) -> None:
        self.as_user(OWNER_ID)
        created_at = datetime.now(timezone.utc).isoformat()
        with patch("app.api.album.list_owned_album_list_records", return_value=[{
            "id": ALBUM_ID,
            "title": "My album",
            "created_at": created_at,
            "updated_at": created_at,
            "result_path": "result.png",
        }]) as list_owned, patch(
            "app.api.album.get_pending_guest_memory_counts", return_value={ALBUM_ID: 2}
        ) as memory_counts, patch(
            "app.api.album.list_album_photo_list_summaries",
            return_value=[
                {"album_id": ALBUM_ID, "id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "sort_order": 0},
                {"album_id": ALBUM_ID, "id": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", "sort_order": 1},
            ],
        ):
            response = self.client.get("/api/albums/mine")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["albums"][0]["album_id"], ALBUM_ID)
        self.assertEqual(response.json()["albums"][0]["new_memory_count"], 2)
        list_owned.assert_called_once_with(self.supabase_client, OWNER_ID, limit=20)
        memory_counts.assert_called_once_with(self.supabase_client, [ALBUM_ID])

    def test_owner_can_delete_album(self) -> None:
        self.as_user(OWNER_ID)
        with patch("app.api.album.get_album_record", return_value=album_record()), patch(
            "app.api.album.delete_album_record"
        ) as delete_album_record:
            response = self.client.delete(f"/api/albums/{ALBUM_ID}")

        self.assertEqual(response.status_code, 204)
        delete_album_record.assert_called_once()

    def test_owner_can_change_cover_photo_without_rebuilding_album(self) -> None:
        self.as_user(OWNER_ID)
        photos = [{
            "id": PHOTO_ID,
            "storage_bucket": "albums",
            "storage_path": "photos/cover.jpg",
            "thumbnail_bucket": "albums",
            "thumbnail_path": "photos/cover-thumb.jpg",
        }]
        with patch("app.api.album.get_album_record", return_value=album_record()), patch(
            "app.api.album.get_album_photo_records", return_value=photos
        ), patch("app.api.album.get_signed_url", return_value="https://cdn.example/cover.jpg"), patch(
            "app.api.album.log_event", return_value=True
        ):
            response = self.client.patch(f"/api/albums/{ALBUM_ID}/cover-photo", json={"photo_id": PHOTO_ID})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["cover_photo_id"], PHOTO_ID)
        self.assertEqual(response.json()["cover_image_url"], "https://cdn.example/cover.jpg")
        self.supabase_client.table.assert_called_with("albums")

    def test_non_owner_cannot_change_cover_photo(self) -> None:
        self.as_user(OTHER_USER_ID)
        with patch("app.api.album.get_album_record", return_value=album_record()):
            response = self.client.patch(f"/api/albums/{ALBUM_ID}/cover-photo", json={"photo_id": PHOTO_ID})

        self.assertEqual(response.status_code, 403)

    def test_unapplied_contributor_photo_cannot_become_cover(self) -> None:
        self.as_user(OWNER_ID)
        pending_photo = {"id": PHOTO_ID, "uploaded_by_contributor_id": "guest-contributor"}
        with patch("app.api.album.get_album_record", return_value={**album_record(), "applied_contribution_photo_ids": []}), patch(
            "app.api.album.get_album_photo_records", return_value=[pending_photo]
        ):
            response = self.client.patch(f"/api/albums/{ALBUM_ID}/cover-photo", json={"photo_id": PHOTO_ID})

        self.assertEqual(response.status_code, 400)

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

    def test_non_owner_cannot_get_private_photo_urls(self) -> None:
        self.as_user(OTHER_USER_ID)
        with patch("app.api.album.get_album_record", return_value=album_record()):
            response = self.client.get(f"/api/albums/{ALBUM_ID}/photos")

        self.assertEqual(response.status_code, 403)

    def test_private_photo_payload_keeps_existing_photo_memories(self) -> None:
        self.as_user(OWNER_ID)
        photo = {
            "id": PHOTO_ID,
            "sort_order": 0,
            "comment": "Owner caption",
            "storage_bucket": "private",
            "storage_path": "photos/photo.jpg",
            "thumbnail_bucket": "private",
            "thumbnail_path": "thumbnails/photo.jpg",
            "width": 1200,
            "height": 800,
            "taken_at": datetime(2026, 7, 12, 10, 0, tzinfo=timezone.utc),
            "orientation": "landscape",
        }
        with (
            patch("app.api.album.get_album_record", return_value=album_record()),
            patch("app.api.album.get_album_photo_records", return_value=[photo]),
            patch("app.api.album.get_album_media_records", return_value=[]) as media_records,
            patch("app.api.album.list_photo_memories", return_value=[{
                "id": "55555555-5555-5555-5555-555555555555",
                "photo_id": PHOTO_ID,
                "author_name": "Participant",
                "comment": "Participant memory",
            }]),
            patch(
                "app.api.album._batch_signed_urls_for_photos",
                return_value={
                    ("private", "photos/photo.jpg"): "https://cdn.example/photo.jpg",
                    ("private", "thumbnails/photo.jpg"): "https://cdn.example/photo-thumb.jpg",
                },
            ),
        ):
            response = self.client.get(f"/api/albums/{ALBUM_ID}/photos")

        self.assertEqual(response.status_code, 200)
        item = response.json()["photos"][0]
        self.assertEqual(item["comment"], "Owner caption")
        self.assertEqual(item["comments"], [{"author": "Participant", "text": "Participant memory"}])
        media_records.assert_not_called()

    def test_non_owner_cannot_get_private_media_urls(self) -> None:
        self.as_user(OTHER_USER_ID)
        with patch("app.api.album.get_album_record", return_value=album_record()):
            response = self.client.get(f"/api/albums/{ALBUM_ID}/media")

        self.assertEqual(response.status_code, 403)

    def test_unauthenticated_update_is_rejected(self) -> None:
        response = self.client.patch(f"/api/albums/{ALBUM_ID}", json={"narrative": "Attempted update"})

        self.assertEqual(response.status_code, 401)

    def test_unauthenticated_album_creation_is_rejected(self) -> None:
        response = self.client.post("/api/upload-album")

        self.assertEqual(response.status_code, 401)

    def test_missing_album_cannot_be_updated_or_deleted(self) -> None:
        self.as_user(OWNER_ID)
        with patch("app.api.album.get_album_record", return_value=None):
            update_response = self.client.patch(f"/api/albums/{ALBUM_ID}", json={"narrative": "Updated narrative"})
            delete_response = self.client.delete(f"/api/albums/{ALBUM_ID}")

        self.assertEqual(update_response.status_code, 404)
        self.assertEqual(delete_response.status_code, 404)

    def test_public_link_can_read_but_not_edit_or_delete(self) -> None:
        with patch("app.api.album.get_album_detail_light_record", return_value=album_record()), patch(
            "app.api.album.count_ready_album_photos", return_value=0
        ), patch("app.api.album.count_album_photo_memories", return_value=0):
            get_response = self.client.get(f"/api/albums/{ALBUM_ID}")
            patch_response = self.client.patch(f"/api/albums/{ALBUM_ID}", json={"narrative": "Attempted update"})
            delete_response = self.client.delete(f"/api/albums/{ALBUM_ID}")

        self.assertEqual(get_response.status_code, 200)
        self.assertEqual(get_response.json()["share_url"], "")
        self.assertEqual(patch_response.status_code, 401)
        self.assertEqual(delete_response.status_code, 401)

    def test_light_album_detail_keeps_epilogue_and_date_stories(self) -> None:
        record = {
            **album_record(),
            "epilogue": "A saved epilogue",
            "chapter_stories": {"2026-07-12": "A saved date story"},
        }
        with patch("app.api.album.get_album_detail_light_record", return_value=record), patch(
            "app.api.album.count_ready_album_photos", return_value=5
        ), patch("app.api.album.count_album_photo_memories", return_value=1):
            response = self.client.get(f"/api/albums/{ALBUM_ID}")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["epilogue"], "A saved epilogue")
        self.assertEqual(response.json()["chapter_stories"], {"2026-07-12": "A saved date story"})

    def test_bootstrap_provisions_the_verified_session_user(self) -> None:
        self.as_user(OWNER_ID)
        with patch("app.api.auth.get_supabase_client", return_value=object()) as get_client, patch(
            "app.api.auth.ensure_default_family", return_value=ALBUM_ID
        ) as ensure_family:
            response = self.client.post("/api/auth/bootstrap")

        self.assertEqual(response.status_code, 200)
        ensure_family.assert_called_once_with(get_client.return_value, OWNER_ID)
        self.assertEqual(response.json()["profile_id"], OWNER_ID)

    def test_edition_history_can_navigate_back_one_snapshot_at_a_time(self) -> None:
        record = {
            "living_latest_edition_previous": 7,
            "album_version_history": {"2": {}, "5": {}, "7": {}},
        }
        self.assertEqual(_previous_edition_number(record, None), 7)
        self.assertEqual(_previous_edition_number(record, 7), 5)
        self.assertEqual(_previous_edition_number(record, 5), 2)
        self.assertIsNone(_previous_edition_number(record, 2))

    def test_previous_edition_uses_its_own_document_and_living_pages(self) -> None:
        record = {
            "album_json": {"title": "latest"},
            "living_append_pages": [{"id": "latest-page"}],
            "album_version_history": {
                "3": {
                    "document": {"title": "previous"},
                    "append_pages": [{"id": "previous-page"}],
                },
            },
        }
        document, pages = _edition_document_and_pages(record, 3)
        self.assertEqual(document, {"title": "previous"})
        self.assertEqual(pages, [{"id": "previous-page"}])
        self.assertEqual(record["album_json"], {"title": "latest"})
        self.assertEqual(record["living_append_pages"], [{"id": "latest-page"}])
