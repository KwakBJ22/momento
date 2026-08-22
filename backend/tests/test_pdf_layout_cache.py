"""🔴 PDF 캐시가 8월 16일 A4 파일을 그대로 내줬다 (PO 실측 2026-08-21).

캐시 열쇠가 album_version 뿐이라, 내용이 그대로인 앨범은 판형(정사각 206×206)을
올린 뒤에도 **옛 파일**을 받았다. 오늘 누른 PDF 가 만들어진 적이 없었다.

★ 열쇠에 판형 판(layout)을 더한다 — 판이 다르면 캐시를 쓰지 않는다.
★ `layout` 이 없으면 **예전 열쇠 그대로**다(기본값 1) — 기존 계약을 깨지 않는다(§10).
★ 옛 파일은 지우지 않는다. 열쇠가 달라지면 안 쓰일 뿐이다.
"""

from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import MagicMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.album import _pdf_cache_key, router
from app.services.auth import require_authenticated_user
from app.services.authorization import AlbumAccess

ALBUM_ID = "11111111-1111-1111-1111-111111111111"
OWNER = AlbumAccess(family_role=None, album_role="owner", is_legacy_owner=False)


class PdfCacheKeyTests(TestCase):
    def test_판형_1은_예전_열쇠_그대로다(self) -> None:
        """옛 화면(layout 없이 부르는)이 자기 캐시를 계속 쓴다 — 계약을 깨지 않는다."""
        self.assertEqual(_pdf_cache_key(7, 3, 1), "7:r3")

    def test_판형_2부터는_열쇠가_갈린다(self) -> None:
        self.assertEqual(_pdf_cache_key(7, 3, 2), "7:r3:l2")
        self.assertNotEqual(_pdf_cache_key(7, 3, 2), _pdf_cache_key(7, 3, 1))


class PdfLayoutCacheEndpointTests(TestCase):
    """엔드포인트가 실제로 그 열쇠로 찾고 올리는지 — 판이 다르면 캐시를 쓰지 않는다."""

    def setUp(self) -> None:
        self.app = FastAPI()
        self.app.include_router(router)
        self.app.dependency_overrides[require_authenticated_user] = lambda: "owner-1"
        self.addCleanup(self.app.dependency_overrides.clear)
        self.client = TestClient(self.app)
        # 8월 16일에 옛 판형(A4)으로 저장된 캐시 — 열쇠는 예전 형식이다.
        self.record = {
            "id": ALBUM_ID,
            "album_version": 7,
            "pdf_cache": {"7:r3": {"path": "albums/a/pdf/old-a4.pdf", "bucket": "private"}},
        }
        patch("app.api.album.get_supabase_client", return_value=MagicMock()).start()
        patch("app.api.album.get_album_record", side_effect=lambda *_: self.record).start()
        patch("app.api.album.get_album_access", return_value=OWNER).start()
        patch("app.api.album.get_signed_url", side_effect=lambda _c, _b, path, _t: f"https://cdn.test/{path}").start()
        self.addCleanup(patch.stopall)

    def test_판형이_다르면_옛_캐시를_쓰지_않는다(self) -> None:
        """★ 이번 수정의 핵심 — 정사각 판형(2)으로 물으면 A4 캐시가 안 나온다."""
        body = self.client.get(f"/api/albums/{ALBUM_ID}/pdf?version=7&layout=2").json()
        self.assertEqual(body["cached"], False)
        self.assertIsNone(body["url"])

    def test_layout_이_없으면_예전처럼_옛_캐시를_준다(self) -> None:
        """옛 화면의 계약은 그대로다 — param 없이 부르면 예전 열쇠로 찾는다."""
        body = self.client.get(f"/api/albums/{ALBUM_ID}/pdf?version=7").json()
        self.assertEqual(body["cached"], True)
        self.assertIn("old-a4.pdf", body["url"])

    def test_판형_2로_올리면_판형_2로_찾아진다(self) -> None:
        """찾을 때와 올릴 때 같은 열쇠다 — 올리고 나면 다음 조회가 그 파일을 받는다."""
        saved: dict = {}

        def set_cached(_client, _record, key, path, _bucket=None):
            saved[key] = path
            self.record["pdf_cache"][key] = {"path": path, "bucket": "private"}

        with patch("app.api.album.set_cached_pdf_path", side_effect=set_cached), \
             patch("app.api.album.StorageService") as storage, \
             patch("app.api.album.log_event"):
            storage.for_supabase.return_value.upload.return_value = None
            response = self.client.put(
                f"/api/albums/{ALBUM_ID}/pdf?version=7&layout=2",
                files={"file": ("a.pdf", b"%PDF-1.4 test", "application/pdf")},
            )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(list(saved), ["7:r3:l2"], "올린 열쇠가 다르다")
        # 파일 이름만 보고도 어느 판형인지 안다(정리 스크립트·조사가 그 이름을 본다).
        self.assertIn("/l2-", saved["7:r3:l2"])
        # 옛 판형 파일은 그대로 있다 — 지우지 않는다.
        self.assertIn("7:r3", self.record["pdf_cache"])
        # 이제 판형 2 조회가 그 파일을 받는다.
        body = self.client.get(f"/api/albums/{ALBUM_ID}/pdf?version=7&layout=2").json()
        self.assertEqual(body["cached"], True)
