from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.album import router
from app.services.auth import require_authenticated_user
from app.services.supabase import list_owned_album_list_records, list_participating_album_list_records
from tests._fake_supabase import FakeSupabase


PROFILE_ID = "22222222-2222-2222-2222-222222222222"
NEW_ALBUM_ID = "11111111-1111-1111-1111-111111111111"
OLD_ALBUM_ID = "33333333-3333-3333-3333-333333333333"


class _ListQuery:
    def __init__(self, responses: list[list[dict]]) -> None:
        self.responses = list(responses)

    def select(self, *_args): return self
    def or_(self, *_args): return self
    def eq(self, *_args): return self
    def is_(self, *_args): return self
    def in_(self, *_args): return self
    def order(self, *_args, **_kwargs): return self
    def limit(self, *_args): return self
    def execute(self): return SimpleNamespace(data=self.responses.pop(0) if self.responses else [])


class _OwnedListClient:
    def __init__(self, direct: list[dict], member_ids: list[dict], recovered: list[dict]) -> None:
        self.albums = _ListQuery([direct, recovered])
        self.members = _ListQuery([member_ids])

    def table(self, name: str):
        return self.members if name == "album_members" else self.albums


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
            patch("app.api.album.list_album_photo_list_summaries", return_value=[
                {"album_id": NEW_ALBUM_ID, "id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "sort_order": 0},
                {"album_id": NEW_ALBUM_ID, "id": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", "sort_order": 1},
                {"album_id": OLD_ALBUM_ID, "id": "cccccccc-cccc-cccc-cccc-cccccccccccc", "sort_order": 0},
            ]),
            patch("app.api.album.get_public_url", side_effect=lambda _client, path, _settings: f"https://cdn.example/{path}"),
            patch("app.api.album.list_owned_album_list_records", return_value=[
                {
                    "id": NEW_ALBUM_ID,
                    "title": "새 앨범",
                    "created_at": "2026-07-23T12:00:00+00:00",
                    "updated_at": "2026-07-23T12:00:00+00:00",
                    "result_path": "new/result.png",
                },
                {
                    "id": OLD_ALBUM_ID,
                    "title": "이전 앨범",
                    "created_at": "2026-07-22T12:00:00+00:00",
                    "updated_at": "2026-07-22T12:00:00+00:00",
                    "result_path": "old/result.png",
                },
            ]),
            patch("app.api.album.list_participating_album_list_records", return_value=[]),
        ]
        for item in self.patches:
            item.start()
            self.addCleanup(item.stop)

    def test_authenticated_owner_album_is_returned_first_by_my_albums_api(self) -> None:
        with patch("app.api.album._attach_my_album_cover_urls", side_effect=lambda _client, _settings, _profile, items: items):
            response = self.client.get("/api/albums/mine")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["cache-control"], "no-store")
        self.assertTrue(response.headers["server-timing"].startswith("my-albums;dur="))
        body = response.json()
        self.assertEqual([album["album_id"] for album in body["albums"]], [NEW_ALBUM_ID, OLD_ALBUM_ID])
        self.assertEqual(body["albums"][0]["photo_count"], 2)
        self.assertEqual(body["albums"][0]["new_memory_count"], 0)

    def test_list_uses_one_batch_photo_query_not_per_album_photo_or_signed_url_calls(self) -> None:
        with patch("app.api.album.get_album_photo_records") as per_album_photos, patch(
            "app.api.album.get_signed_url"
        ) as per_album_signed_url, patch(
            "app.api.album._attach_my_album_cover_urls", side_effect=lambda _client, _settings, _profile, items: items
        ):
            response = self.client.get("/api/albums/mine")

        self.assertEqual(response.status_code, 200)
        per_album_photos.assert_not_called()
        per_album_signed_url.assert_not_called()

    def test_cover_urls_are_batched_and_a_missing_signed_url_is_omitted(self) -> None:
        settings = SimpleNamespace(signed_url_ttl_seconds=3600)
        asset = {
            "album_id": NEW_ALBUM_ID,
            "id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
            "thumbnail_bucket": "albums",
            "thumbnail_path": "new/thumb.jpg",
        }
        with patch("app.api.album.get_settings", return_value=settings), patch(
            "app.api.album.list_owned_album_cover_records",
            return_value=[{"id": NEW_ALBUM_ID, "cover_photo_id": asset["id"]}],
        ), patch(
            "app.api.album.list_album_photo_cover_records", return_value=[asset]
        ) as cover_rows, patch(
            "app.api.album.get_signed_urls_batch", return_value={("albums", "new/thumb.jpg"): "https://cdn.example/new/thumb.jpg"}
        ) as signed_urls:
            response = self.client.get(
                f"/api/albums/mine/covers?album_ids={NEW_ALBUM_ID}&cover_photo_ids={asset['id']}"
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["covers"], {NEW_ALBUM_ID: "https://cdn.example/new/thumb.jpg"})
        cover_rows.assert_called_once()
        signed_urls.assert_called_once()

    def test_my_albums_returns_participating_albums_separately_from_owned(self) -> None:
        part_id = "44444444-4444-4444-4444-444444444444"
        with patch("app.api.album.list_participating_album_list_records", return_value=[
            {"id": part_id, "title": "함께 만든 앨범", "created_at": "2026-07-20T12:00:00+00:00", "updated_at": "2026-07-20T12:00:00+00:00", "result_path": "part/result.png"},
        ]), patch(
            "app.api.album._attach_my_album_cover_urls", side_effect=lambda _c, _s, _p, items: items
        ), patch(
            "app.api.album._attach_participating_cover_urls", side_effect=lambda _c, _s, items: items
        ):
            response = self.client.get("/api/albums/mine")

        self.assertEqual(response.status_code, 200)
        body = response.json()
        # Existing field kept; owned unchanged.
        self.assertEqual([a["album_id"] for a in body["albums"]], [NEW_ALBUM_ID, OLD_ALBUM_ID])
        # New field carries the participated album, and an owned album never leaks into it.
        self.assertEqual([a["album_id"] for a in body["participating"]], [part_id])
        self.assertNotIn(NEW_ALBUM_ID, [a["album_id"] for a in body["participating"]])

    def test_owner_membership_recovers_legacy_claimed_album_and_sorts_it_first(self) -> None:
        client = _OwnedListClient(
            direct=[{"id": OLD_ALBUM_ID, "created_at": "2026-07-22T12:00:00+00:00", "updated_at": "2026-07-22T12:00:00+00:00"}],
            member_ids=[{"album_id": NEW_ALBUM_ID}],
            recovered=[{"id": NEW_ALBUM_ID, "created_at": "2026-07-23T12:00:00+00:00", "updated_at": "2026-07-24T12:00:00+00:00"}],
        )

        records = list_owned_album_list_records(client, PROFILE_ID)

        self.assertEqual([record["id"] for record in records], [NEW_ALBUM_ID, OLD_ALBUM_ID])


class ParticipatingAlbumQueryTests(TestCase):
    """Real query semantics via the stateful fake — the destructive/visibility rules
    (exclude owned, exclude owner-role, exclude deleted) must hold for real."""

    def test_excludes_owned_owner_role_and_deleted_albums(self) -> None:
        user = "22222222-2222-2222-2222-222222222222"
        client = FakeSupabase({
            "albums": [
                {"id": "album-b", "title": "함께B", "deleted_at": None},
                {"id": "album-c", "title": "소유C", "deleted_at": None},
                {"id": "album-d", "title": "삭제D", "deleted_at": "2026-08-01T00:00:00+00:00"},
            ],
            "album_contributors": [
                {"album_id": "album-b", "user_id": user, "status": "active", "role": "contributor"},
                {"album_id": "album-c", "user_id": user, "status": "active", "role": "contributor"},
                {"album_id": "album-d", "user_id": user, "status": "active", "role": "contributor"},
                {"album_id": "album-a", "user_id": user, "status": "active", "role": "owner"},
                {"album_id": "album-b", "user_id": "99999999-9999-9999-9999-999999999999", "status": "active", "role": "contributor"},
            ],
        })
        # album-c is passed as owned (exclude_ids); it must not appear.
        records = list_participating_album_list_records(client, user, exclude_ids={"album-c"})
        ids = [r["id"] for r in records]
        self.assertIn("album-b", ids)          # genuine participation
        self.assertNotIn("album-c", ids)       # owned → excluded
        self.assertNotIn("album-d", ids)       # deleted → excluded
        self.assertNotIn("album-a", ids)       # owner role → excluded (already in owned list)

    def test_no_participation_returns_empty(self) -> None:
        client = FakeSupabase({"albums": [], "album_contributors": []})
        self.assertEqual(list_participating_album_list_records(client, "u", exclude_ids=set()), [])
