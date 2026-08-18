"""앨범에서 사진 한 장을 뺀다 — 서버는 이미 있었고, 화면이 부르지 않았을 뿐이다.

여기서 잠그는 것은 둘이다:
  ① **권한을 서버가 막는다** — 프런트가 감추는 것과 별개다(§10).
  ② **표지로 쓰던 사진을 빼면 표지가 옮겨간다** — 표지가 빈 자리가 되면 안 된다.

★ 앨범을 다시 만들지 않는다. 사진만 빠지고 캡션·한마디·이야기는 그대로다.
★ 마지막 한 장도 뺄 수 있다. 사진 0장 앨범이 되어도 막지 않는다.
"""

from unittest import TestCase
from unittest.mock import MagicMock, patch

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.api.album import _require_media_mutation_access, router
from app.services.auth import require_authenticated_user

ALBUM_ID = "11111111-1111-1111-1111-111111111111"
OWNER_ID = "22222222-2222-2222-2222-222222222222"
GUEST_ID = "33333333-3333-3333-3333-333333333333"
PHOTO_A = "44444444-4444-4444-8444-444444444444"
PHOTO_B = "55555555-5555-4555-8555-555555555555"


class Access:
    def __init__(self, *, can_edit_settings: bool) -> None:
        self.can_edit_settings = can_edit_settings


class MediaMutationAccessTests(TestCase):
    """★ 회귀 ② — 프런트만 막지 않는다."""

    def test_주최자는_남의_사진도_뺄_수_있다(self) -> None:
        with patch("app.api.album.require_album_contribute"):
            _require_media_mutation_access({"uploader_id": GUEST_ID}, Access(can_edit_settings=True), OWNER_ID)

    def test_참여자는_자기가_올린_사진만_뺄_수_있다(self) -> None:
        with patch("app.api.album.require_album_contribute"):
            _require_media_mutation_access({"uploader_id": GUEST_ID}, Access(can_edit_settings=False), GUEST_ID)

    def test_참여자가_남의_사진을_빼려_하면_403(self) -> None:
        with patch("app.api.album.require_album_contribute"):
            with self.assertRaises(HTTPException) as caught:
                _require_media_mutation_access({"uploader_id": OWNER_ID}, Access(can_edit_settings=False), GUEST_ID)
        self.assertEqual(caught.exception.status_code, 403)

    def test_구경꾼은_더할_권한부터_없다(self) -> None:
        """require_album_contribute 가 먼저 막는다 — 그 앞에서 끝난다."""
        with patch("app.api.album.require_album_contribute", side_effect=HTTPException(status_code=403, detail="권한이 없습니다.")):
            with self.assertRaises(HTTPException) as caught:
                _require_media_mutation_access({"uploader_id": GUEST_ID}, Access(can_edit_settings=False), GUEST_ID)
        self.assertEqual(caught.exception.status_code, 403)


class CoverMovesWhenItsPhotoLeavesTests(TestCase):
    """★ 회귀 ④ — 표지 사진을 빼면 표지가 남은 첫 장으로 옮겨간다."""

    def setUp(self) -> None:
        self.app = FastAPI()
        self.app.include_router(router)
        self.app.dependency_overrides[require_authenticated_user] = lambda: OWNER_ID
        self.client = TestClient(self.app)
        self.updates: list[dict] = []
        self.supabase = MagicMock()

        def table(name: str):
            handle = MagicMock()
            if name == "albums":
                def update(payload):
                    self.updates.append(payload)
                    result = MagicMock()
                    result.eq.return_value.execute.return_value.data = [{"id": ALBUM_ID}]
                    return result
                handle.update.side_effect = update
            elif name == "album_photos":
                chain = handle.select.return_value.eq.return_value.eq.return_value.is_.return_value.limit.return_value
                chain.execute.return_value.data = [{
                    "storage_path": "a.jpg", "display_path": "a.webp", "thumbnail_path": "a-t.webp",
                }]
            return handle

        self.supabase.table.side_effect = table
        patch("app.api.album.get_supabase_client", return_value=self.supabase).start()
        patch("app.api.album.get_album_media_record", return_value={"id": PHOTO_A, "uploader_id": OWNER_ID}).start()
        patch("app.api.album._require_media_mutation_access").start()
        patch("app.api.album.get_album_access", return_value=Access(can_edit_settings=True)).start()
        patch("app.api.album.soft_delete_album_photo_with_references", return_value=True).start()
        patch("app.api.album.StorageService").start()
        self.addCleanup(patch.stopall)

    def _delete(self, *, cover: str | None, remaining: list[str]) -> None:
        with patch("app.api.album.get_album_record", return_value={"id": ALBUM_ID, "cover_photo_id": cover}), \
             patch("app.api.album.get_album_photo_records", return_value=[{"id": photo_id} for photo_id in remaining]):
            response = self.client.delete(f"/api/albums/{ALBUM_ID}/media/{PHOTO_A}")
        self.assertEqual(response.status_code, 204, response.text)

    def test_표지를_빼면_남은_첫_장으로_옮긴다(self) -> None:
        self._delete(cover=PHOTO_A, remaining=[PHOTO_B])
        self.assertEqual(self.updates, [{"cover_photo_id": PHOTO_B}])

    def test_마지막_한_장이면_표지를_비운다(self) -> None:
        """★ 마지막 한 장도 뺄 수 있다 — 사진 0장 앨범을 막지 않는다."""
        self._delete(cover=PHOTO_A, remaining=[])
        self.assertEqual(self.updates, [{"cover_photo_id": None}])

    def test_표지가_아닌_사진을_빼면_표지를_건드리지_않는다(self) -> None:
        self._delete(cover=PHOTO_B, remaining=[PHOTO_B])
        self.assertEqual(self.updates, [], "표지를 건드렸다")

    def test_앨범을_다시_만들지_않는다(self) -> None:
        """사진만 빠진다 — 캡션·한마디·이야기는 그대로다."""
        import pathlib
        import re
        source = (pathlib.Path(__file__).resolve().parents[1] / "app" / "api" / "album.py").read_text(encoding="utf-8")
        body = source[source.index('@router.delete("/albums/{album_id}/media/{media_id}"'):]
        body = body[:body.index("def _edition_document_and_pages")]
        for forbidden in ("rebuild_album", "apply_selected_contributions", "chapter_stories", "epilogue"):
            self.assertNotIn(forbidden, body, f"사진을 빼면서 {forbidden} 까지 건드린다")
        # 표지 말고 다른 칸을 albums 에 쓰지 않는다.
        self.assertEqual(re.findall(r'\.table\("albums"\)\.update\((\{[^}]*\})', body), ['{"cover_photo_id": next_cover}'])
