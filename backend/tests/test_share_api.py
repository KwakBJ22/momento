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
    return {
        "id": SHARE_ID,
        "album_id": ALBUM_ID,
        "status": "active",
        "view_count": 0,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }


class ShareApiTests(TestCase):
    def setUp(self) -> None:
        self.app = FastAPI()
        self.app.include_router(router)
        self.client = TestClient(self.app)
        self.mock_client = MagicMock()
        patch("app.api.share.get_supabase_client", return_value=self.mock_client).start()
        patch(
            "app.api.share.get_settings",
            return_value=SimpleNamespace(
                frontend_base_url="https://momento.example",
                supabase_storage_bucket="albums",
                signed_url_ttl_seconds=3600,
            ),
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

    def test_public_share_is_readable_without_an_authentication_header(self) -> None:
        with patch("app.api.share.get_active_share", return_value=share()), patch(
            "app.api.share.get_album_record", return_value=album()
        ), patch("app.api.share.get_album_media_records", return_value=[]), patch(
            "app.api.share.get_album_photo_records", return_value=[]
        ), patch("app.api.share.list_photo_memories", return_value=[]), patch(
            "app.api.share.get_public_url", return_value="https://cdn.example/result.png"
        ), patch("app.api.share.increment_view"), patch("app.api.share.log_event"):
            response = self.client.get("/api/public/shares/opaque-token")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["title"], album()["title"])

    def test_share_link_creation_returns_a_tokenized_public_url(self) -> None:
        self.app.dependency_overrides[require_authenticated_user] = lambda: OWNER_ID
        with patch("app.api.share.get_album_record", return_value=album()), patch(
            "app.api.share.get_album_access", return_value=object()
        ), patch("app.api.share.require_album_edit_settings"), patch(
            "app.api.share.create_share_link", return_value=(share(), "opaque-token")
        ), patch("app.api.share.log_event"):
            response = self.client.post(f"/api/albums/{ALBUM_ID}/share-links", json={})

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["share_url"], "https://momento.example/s/opaque-token")

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

    def test_public_share_separates_unapplied_participant_contributions(self) -> None:
        host_photo_id = "44444444-4444-4444-4444-444444444444"
        applied_photo_id = "55555555-5555-5555-5555-555555555555"
        pending_photo_id = "66666666-6666-6666-6666-666666666666"
        legacy_photo_id = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
        applied_memory_id = "77777777-7777-7777-7777-777777777777"
        pending_memory_id = "88888888-8888-8888-8888-888888888888"
        participant_id = "99999999-9999-9999-9999-999999999999"
        album_with_contributions = {
            **album(),
            "created_at": "2026-07-01T00:00:00+00:00",
            "applied_contribution_photo_ids": [applied_photo_id],
            "applied_contribution_memory_ids": [applied_memory_id],
        }

        def photo(photo_id: str, contributor_id: str) -> dict[str, object]:
            return {
                "id": photo_id,
                "sort_order": 0,
                "created_at": "2026-07-02T10:00:00+00:00",
                "uploaded_by_contributor_id": contributor_id,
                "storage_bucket": "private",
                "storage_path": f"photos/{photo_id}.jpg",
                "thumbnail_bucket": "private",
                "thumbnail_path": f"thumbs/{photo_id}.jpg",
            }

        memories = [
            {
                "id": applied_memory_id,
                "photo_id": applied_photo_id,
                "contributor_id": participant_id,
                "author_name": "민수",
                "comment": "반영된 기억",
                "created_at": "2026-07-02T10:00:00+00:00",
            },
            {
                "id": pending_memory_id,
                "photo_id": pending_photo_id,
                "contributor_id": participant_id,
                "author_name": "민수",
                "comment": "아직 반영되지 않은 기억",
                "created_at": "2026-07-02T10:01:00+00:00",
            },
        ]
        with patch("app.api.share.get_active_share", return_value=share()), patch(
            "app.api.share.get_album_record", return_value=album_with_contributions
        ), patch("app.api.share.get_album_media_records", return_value=[]), patch(
            "app.api.share.get_album_photo_records",
            return_value=[
                photo(host_photo_id, OWNER_ID),
                photo(applied_photo_id, participant_id),
                photo(pending_photo_id, participant_id),
                photo(legacy_photo_id, ""),
            ],
        ), patch("app.api.share.list_photo_memories", return_value=memories), patch(
            "app.api.share.list_contributors",
            return_value=[
                {"id": OWNER_ID, "role": "owner", "display_name": "주최자"},
                {"id": participant_id, "role": "contributor", "display_name": "민수"},
            ],
        ), patch(
            "app.api.share.get_signed_url", side_effect=lambda _client, _bucket, path, _ttl: f"https://cdn.example/{path}"
        ), patch("app.api.share.get_public_url", return_value="https://cdn.example/result.png"), patch(
            "app.api.share.increment_view"
        ), patch("app.api.share.log_event"):
            response = self.client.get("/api/public/shares/opaque-token")

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual({photo["id"] for photo in body["photos"]}, {host_photo_id, applied_photo_id, legacy_photo_id})
        self.assertEqual(
            {(item["id"], item["type"], item["actor_name"]) for item in body["pending_items"]},
            {(pending_photo_id, "photo", "민수"), (pending_memory_id, "memory", "민수")},
        )

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
