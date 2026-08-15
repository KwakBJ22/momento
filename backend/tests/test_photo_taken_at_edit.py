"""촬영일을 그 자리에서 고친다 — **주최자만**, 서버가 막는다 (2026-08-16).

장소는 고칠 수 있는데 날짜는 못 고쳤다. 카톡·다운로드를 거쳐 EXIF 가 지워진 사진은
날짜 줄이 통째로 안 나오고 손쓸 방법이 없었다(dev 실측 2026-08-14).

★ 날짜는 **앨범의 뼈대**다 — 바뀌면 묶음이 다시 갈리고 이야기가 따라 움직인다.
  그래서 장소(참여자도 자기 사진은 고친다)와 달리 **주최자만** 고친다(§7).
  화면이 연필을 감추는 것과 별개로 **여기서** 막는다(§10).
"""

from unittest import TestCase
from unittest.mock import MagicMock, patch

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.api.album import router
from app.services.auth import require_authenticated_user

ALBUM_ID = "11111111-1111-1111-1111-111111111111"
PHOTO_ID = "22222222-2222-4222-8222-222222222222"
OWNER_ID = "33333333-3333-4333-8333-333333333333"


def photo_row() -> dict:
    return {
        "id": PHOTO_ID, "sort_order": 0, "caption": "바다",
        "storage_bucket": "originals", "storage_path": "a.jpg",
        "display_bucket": "display", "display_path": "a.webp",
        "thumbnail_bucket": "thumbs", "thumbnail_path": "a-t.webp",
        "taken_at": "2018-07-08T00:00:00+00:00", "width": 1200, "height": 900,
    }


class TakenAtEditTests(TestCase):
    def setUp(self) -> None:
        self.app = FastAPI()
        self.app.include_router(router)
        self.app.dependency_overrides[require_authenticated_user] = lambda: OWNER_ID
        self.client = TestClient(self.app)
        self.saved: list[dict] = []
        self.supabase = MagicMock()

        def table(name: str):
            handle = MagicMock()
            if name == "album_photos":
                def update(payload):
                    self.saved.append(payload)
                    result = MagicMock()
                    result.eq.return_value.eq.return_value.execute.return_value.data = [
                        {**photo_row(), **payload}
                    ]
                    return result
                handle.update.side_effect = update
            return handle

        self.supabase.table.side_effect = table
        patch("app.api.album.get_supabase_client", return_value=self.supabase).start()
        patch("app.api.album.get_album_record", return_value={"id": ALBUM_ID}).start()
        patch("app.api.album._require_photo_mutation_access", return_value=photo_row()).start()
        patch("app.api.album.get_signed_url", return_value="https://cdn.test/x").start()
        self.access = MagicMock(can_edit_settings=True)
        patch("app.api.album.get_album_access", return_value=self.access).start()
        self.owner_guard = patch("app.api.album.require_album_edit_settings").start()
        self.addCleanup(patch.stopall)

    def _patch(self, payload: dict):
        return self.client.patch(f"/api/albums/{ALBUM_ID}/photos/{PHOTO_ID}/location", json=payload)

    def test_주최자는_촬영일을_고친다(self) -> None:
        response = self._patch({"location_name": "제주 서귀포시", "taken_at": "2018-07-08T00:00:00Z"})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertIn("taken_at", self.saved[0])
        self.assertTrue(self.saved[0]["taken_at"].startswith("2018-07-08"))

    def test_넣지_않으면_날짜를_건드리지_않는다(self) -> None:
        """장소만 고치는 예전 길 — 그대로다."""
        response = self._patch({"location_name": "제주 성산읍"})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertNotIn("taken_at", self.saved[0], "안 보냈는데 날짜를 건드렸다")
        # 그리고 그때는 주최자 권한을 묻지 않는다(참여자도 자기 사진 장소는 고친다).
        self.owner_guard.assert_not_called()

    def test_참여자는_날짜를_못_고친다(self) -> None:
        """★ 회귀 ⑤ — 프런트가 연필을 감추는 것과 별개로 서버가 막는다."""
        with patch("app.api.album.require_album_edit_settings",
                   side_effect=HTTPException(status_code=403, detail="권한이 없습니다.")):
            response = self._patch({"taken_at": "2018-07-08T00:00:00Z"})
        self.assertEqual(response.status_code, 403)
        self.assertEqual(self.saved, [], "막았는데 저장했다")

    def test_1900년_이전은_막는다(self) -> None:
        """오타 방어 — 앞날은 막지 않는다(기기 시계가 틀린 사진이 있다)."""
        response = self._patch({"taken_at": "1899-12-31T00:00:00Z"})
        self.assertEqual(response.status_code, 400)
        self.assertIn("1900년", response.json()["detail"])
        self.assertEqual(self.saved, [])

    def test_앞날은_막지_않는다(self) -> None:
        response = self._patch({"taken_at": "2099-01-01T00:00:00Z"})
        self.assertEqual(response.status_code, 200, response.text)

    def test_형식이_아니면_받지_않는다(self) -> None:
        response = self._patch({"taken_at": "언젠가"})
        self.assertEqual(response.status_code, 422)
        self.assertEqual(self.saved, [])


class NoNewRouteTests(TestCase):
    def test_날짜를_고치는_새_주소를_만들지_않았다(self) -> None:
        import pathlib
        import re
        source = (pathlib.Path(__file__).resolve().parents[1] / "app" / "api" / "album.py").read_text(encoding="utf-8")
        self.assertEqual(re.findall(r'@router\.patch\("/albums/\{album_id\}/photos/\{photo_id\}/[a-z-]+"', source),
                         ['@router.patch("/albums/{album_id}/photos/{photo_id}/location"',
                          '@router.patch("/albums/{album_id}/photos/{photo_id}/comment"'])
