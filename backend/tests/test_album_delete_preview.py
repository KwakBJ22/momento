"""지우기 전에 **무엇이 사라지는지** 보여주는 값 (시안 1b · 2026-08-17).

★ 미리 보는 것도 남의 앨범 속을 보는 일이다. 권한은 **지우기와 똑같다** —
  주최자가 아니면 403 이다. 화면에서 감추는 것으로 끝내지 않는다(§10).
"""

from unittest import TestCase
from unittest.mock import MagicMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.album import router
from app.services.auth import require_authenticated_user
from app.services.authorization import AlbumAccess

ALBUM_ID = "11111111-1111-1111-1111-111111111111"

OWNER = AlbumAccess(family_role=None, album_role="owner", is_legacy_owner=False)
EDITOR = AlbumAccess(family_role=None, album_role="editor", is_legacy_owner=False)
CONTRIBUTOR = AlbumAccess(family_role=None, album_role="contributor", is_legacy_owner=False)
VIEWER = AlbumAccess(family_role=None, album_role="viewer", is_legacy_owner=False)


class DeletePreviewTests(TestCase):
    def setUp(self) -> None:
        self.app = FastAPI()
        self.app.include_router(router)
        self.client = TestClient(self.app)
        patch("app.api.album.get_supabase_client", return_value=MagicMock()).start()
        patch("app.api.album.get_album_record", return_value={"id": ALBUM_ID, "owner_id": "owner-1"}).start()
        patch("app.api.album.get_album_photo_records", return_value=[
            {"id": "p1", "sort_order": 2, "storage_bucket": "b", "storage_path": "o2.jpg", "display_bucket": "b", "display_path": "d2.webp"},
            {"id": "p2", "sort_order": 1, "storage_bucket": "b", "storage_path": "o1.jpg", "display_bucket": "b", "display_path": "d1.webp"},
            {"id": "p3", "sort_order": 3, "storage_bucket": "b", "storage_path": "o3.jpg", "display_bucket": "b", "display_path": "d3.webp"},
            {"id": "p4", "sort_order": 4, "storage_bucket": "b", "storage_path": "o4.jpg", "display_bucket": "b", "display_path": "d4.webp"},
        ]).start()
        patch("app.api.album.count_ready_album_photos", return_value=9).start()
        patch("app.api.album.list_photo_memories", return_value=[{"id": "m1"}, {"id": "m2"}]).start()
        patch("app.api.album.count_active_contributors", return_value=3).start()
        patch("app.api.album.get_signed_url", side_effect=lambda _c, bucket, path, _ttl: f"https://cdn.test/{bucket}/{path}").start()
        self.addCleanup(patch.stopall)

    def _get(self, access: AlbumAccess, user: str = "owner-1"):
        self.app.dependency_overrides[require_authenticated_user] = lambda: user
        with patch("app.api.album.get_album_access", return_value=access):
            return self.client.get(f"/api/albums/{ALBUM_ID}/delete-preview")

    def test_주최자는_사라질_것을_받는다(self) -> None:
        response = self._get(OWNER)
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body["photo_count"], 9)
        self.assertEqual(body["memory_count"], 2)
        self.assertEqual(body["contributor_count"], 3)
        # 최대 세 장 · 고른 순서(sort_order)대로 · **display 자산**이다(원본 금지 · §9).
        self.assertEqual(body["preview_photo_urls"], [
            "https://cdn.test/b/d1.webp",
            "https://cdn.test/b/d2.webp",
            "https://cdn.test/b/d3.webp",
        ])

    def test_주최자가_아니면_403(self) -> None:
        """★ 회귀 — 지우기와 **같은 판정**이다. 편집자·참여자·구경꾼 모두 막힌다."""
        for access in (EDITOR, CONTRIBUTOR, VIEWER):
            response = self._get(access, user="someone")
            self.assertEqual(response.status_code, 403, f"{access.album_role}: {response.text}")

    def test_없는_앨범은_404(self) -> None:
        with patch("app.api.album.get_album_record", return_value=None):
            response = self._get(OWNER)
        self.assertEqual(response.status_code, 404)
