"""앨범 **모양**과 **종이 색**을 주최자가 고른다 (2026-08-15).

★ 새 주소를 만들지 않았다 — 이미 있던 `PATCH /albums/{id}` 를 넓혔다(§10).
  예전 계약(맺음말만 고치기)은 그대로다.

★ 지키는 것은 **서버**다. 프런트가 목록을 들고 있는 것은 편의일 뿐이고,
  허용값 밖과 권한은 여기서 막는다.
"""

from unittest import TestCase
from unittest.mock import MagicMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.album import router
from app.services.auth import require_authenticated_user

ALBUM_ID = "11111111-1111-1111-1111-111111111111"
OWNER_ID = "22222222-2222-2222-2222-222222222222"


def album(**overrides):
    base = {
        "id": ALBUM_ID, "title": "우리 여행", "narrative": "좋았다", "epilogue": "좋았다",
        "meeting_type": "friend", "template": "B", "template_type": "joyful",
        "category": "family", "event_date": "2026-08-01", "created_at": "2026-08-01T00:00:00+00:00",
        "album_version": 3, "skin": None, "paper": None, "chapter_stories": {},
    }
    base.update(overrides)
    return base


class AlbumAppearanceApiTests(TestCase):
    def setUp(self) -> None:
        self.app = FastAPI()
        self.app.include_router(router)
        self.app.dependency_overrides[require_authenticated_user] = lambda: OWNER_ID
        self.client = TestClient(self.app)
        self.saved: list[dict] = []
        self.record = album()

        self.supabase = MagicMock()

        def table(name: str):
            handle = MagicMock()
            if name == "albums":
                def update(payload):
                    self.saved.append(payload)
                    self.record.update(payload)
                    result = MagicMock()
                    result.eq.return_value.execute.return_value.data = [self.record]
                    return result
                handle.update.side_effect = update
            return handle

        self.supabase.table.side_effect = table
        patch("app.api.album.get_supabase_client", return_value=self.supabase).start()
        patch("app.api.album.get_album_record", side_effect=lambda *_: self.record).start()
        patch("app.api.album.get_album_photo_records", return_value=[]).start()
        patch("app.api.album.count_ready_album_photos", return_value=0).start()
        patch("app.api.album.list_photo_memories", return_value=[]).start()
        patch("app.api.album.get_result_signed_url", return_value="https://cdn.test/result.png").start()
        patch("app.api.album._cover_image_url", return_value=(None, None)).start()
        self.access = MagicMock(can_edit_settings=True, is_owner=True)
        patch("app.api.album.get_album_access", return_value=self.access).start()
        patch("app.api.album.require_album_edit_settings").start()
        patch("app.api.album.require_album_owner_story").start()
        self.addCleanup(patch.stopall)

    def test_고른_값이_저장되고_응답에_실려_온다(self) -> None:
        """★ 회귀 ① — 고르면 저장되고, 다시 열었을 때 그 값으로 뜬다."""
        response = self.client.patch(f"/api/albums/{ALBUM_ID}", json={"skin": "grid", "paper": "cream"})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.saved, [{"skin": "grid", "paper": "cream"}])
        body = response.json()
        self.assertEqual(body["skin"], "grid")
        self.assertEqual(body["paper"], "cream")

    def test_넘긴_것만_고친다(self) -> None:
        """맺음말을 넣지 않았으면 맺음말은 건드리지 않는다(예전 계약 그대로)."""
        response = self.client.patch(f"/api/albums/{ALBUM_ID}", json={"skin": "airy"})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.saved, [{"skin": "airy"}])
        self.assertEqual(self.record["epilogue"], "좋았다", "맺음말이 지워졌다")

    def test_허용값_밖은_서버가_막는다(self) -> None:
        """★ 회귀 ③ — 프런트만 막지 않는다. 우리 말로 400 이다."""
        for payload, word in (({"skin": "polaroid"}, "앨범 모양"), ({"paper": "black"}, "종이 색")):
            response = self.client.patch(f"/api/albums/{ALBUM_ID}", json=payload)
            self.assertEqual(response.status_code, 400, response.text)
            self.assertIn(word, response.json()["detail"])
            self.assertEqual(self.saved, [], "막았는데 저장했다")

    def test_주최자만_고칠_수_있다(self) -> None:
        """★ 회귀 ② 의 짝 — 화면에서 감추는 것과 별개로 서버가 막는다."""
        from fastapi import HTTPException
        with patch("app.api.album.require_album_edit_settings", side_effect=HTTPException(status_code=403, detail="권한이 없습니다.")):
            response = self.client.patch(f"/api/albums/{ALBUM_ID}", json={"skin": "grid"})
        self.assertEqual(response.status_code, 403)
        self.assertEqual(self.saved, [], "권한이 없는데 저장했다")

    def test_바꿀_내용이_없으면_400(self) -> None:
        response = self.client.patch(f"/api/albums/{ALBUM_ID}", json={})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.saved, [])

    def test_맺음말만_고치던_예전_계약은_그대로다(self) -> None:
        with patch("app.api.album.update_album_narrative", return_value=album(epilogue="새 글", narrative="새 글")):
            response = self.client.patch(f"/api/albums/{ALBUM_ID}", json={"narrative": "새 글"})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["epilogue"], "새 글")
        self.assertEqual(self.saved, [], "맺음말만 고치는데 모양까지 건드렸다")


class AppearanceReachesEveryScreenTests(TestCase):
    """앨범 화면과 공유 화면이 **같은 값**을 받는다 — 구경꾼도 주최자가 고른 모양으로 본다."""

    def test_두_응답_모두_skin_paper_를_들고_있다(self) -> None:
        from app.models.schemas import AlbumDetailResponse, PublicShareAlbumResponse
        for model in (AlbumDetailResponse, PublicShareAlbumResponse):
            self.assertIn("skin", model.model_fields, model.__name__)
            self.assertIn("paper", model.model_fields, model.__name__)

    def test_가벼운_조회에도_두_칸이_실린다(self) -> None:
        """이 칸이 빠지면 앨범 화면이 늘 카테고리 추천으로 보인다(고른 값이 사라진다)."""
        from app.services.supabase import ALBUM_DETAIL_LIGHT_COLUMNS
        self.assertIn("skin", ALBUM_DETAIL_LIGHT_COLUMNS)
        self.assertIn("paper", ALBUM_DETAIL_LIGHT_COLUMNS)

    def test_허용값_목록이_DB_제약과_같다(self) -> None:
        """서버 목록과 DB 제약이 갈리면, 통과했는데 저장에서 터진다."""
        import pathlib
        import re
        from app.models.schemas import ALBUM_PAPER_VALUES, ALBUM_SKIN_VALUES
        sql = (pathlib.Path(__file__).resolve().parents[2]
               / "supabase" / "migrations" / "20260814090000_album_skin_paper.sql").read_text(encoding="utf-8")
        skin_body = sql.split("albums_skin_check", 2)[2].split(";", 1)[0]
        paper_body = sql.split("albums_paper_check", 2)[2].split(";", 1)[0]
        self.assertEqual(set(re.findall(r"'([a-z]+)'", skin_body)), set(ALBUM_SKIN_VALUES))
        self.assertEqual(set(re.findall(r"'([a-z]+)'", paper_body)), set(ALBUM_PAPER_VALUES))
