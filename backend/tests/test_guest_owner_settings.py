"""🔴 게스트 주최자가 앨범 설정을 못 고쳤다 (PO 실측 2026-08-16).

`화면_기준 §1` — **게스트 주최자는 주최자와 권한이 같다.** 그런데 설정을 고치는 PATCH 가
로그인을 요구해서, 게스트로 만든 자기 앨범인데 모양·종이를 못 골랐다.

★ 같은 결함이 **표지 사진 바꾸기**에도 있었다(같은 시트의 바로 윗줄이다). 함께 고쳤다.
  제목·맺음말은 이미 게스트 토큰을 받고 있었다 — 그 둘은 건드리지 않았다.

★ 판정은 이미 있는 `_actor_album_access` 하나다. 새 판정을 만들지 않는다.
"""

from unittest import TestCase
from unittest.mock import MagicMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.album import router
from app.services.authorization import NO_ALBUM_ACCESS, guest_album_owner_access

ALBUM_ID = "11111111-1111-1111-1111-111111111111"
GUEST_TOKEN = "guest-token-value"


def album_row(**overrides):
    base = {
        "id": ALBUM_ID, "title": "우리 여행", "narrative": "좋았다", "epilogue": "좋았다",
        "meeting_type": "friend", "template": "B", "template_type": "joyful",
        "category": "family", "event_date": "2026-08-01", "created_at": "2026-08-01T00:00:00+00:00",
        "album_version": 3, "skin": None, "paper": None, "chapter_stories": {},
        "owner_id": None, "family_id": None,
    }
    base.update(overrides)
    return base


class GuestOwnerCanChangeAppearanceTests(TestCase):
    def setUp(self) -> None:
        self.app = FastAPI()
        self.app.include_router(router)
        self.client = TestClient(self.app)
        self.saved: list[dict] = []
        self.record = album_row()
        self.supabase = MagicMock()

        def table(name: str):
            handle = MagicMock()
            if name == "albums":
                def update(payload):
                    self.saved.append(payload)
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
        patch("app.api.album.get_result_signed_url", return_value="https://cdn.test/x.png").start()
        patch("app.api.album._cover_image_url", return_value=(None, None)).start()
        self.addCleanup(patch.stopall)

    def _patch(self, payload: dict, *, token: str | None):
        headers = {"X-Woorialbum-Guest-Album-Token": token} if token else {}
        return self.client.patch(f"/api/albums/{ALBUM_ID}", json=payload, headers=headers)

    def test_게스트_주최자가_앨범_모양을_저장한다(self) -> None:
        """★ 회귀 ① — 서버가 **200** 을 준다."""
        with patch("app.services.guest_album_service.guest_session_matches", return_value=True):
            response = self._patch({"skin": "grid"}, token=GUEST_TOKEN)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.saved, [{"skin": "grid"}])

    def test_남의_앨범에는_토큰이_있어도_403(self) -> None:
        """★ 회귀 ② — 토큰이 그 앨범 것이 아니면 막는다. 서버가 대조한다."""
        with patch("app.services.guest_album_service.guest_session_matches", return_value=False):
            response = self._patch({"skin": "grid"}, token="someone-elses-token")
        self.assertEqual(response.status_code, 403)
        self.assertEqual(self.saved, [], "막았는데 저장했다")

    def test_토큰도_로그인도_없으면_403(self) -> None:
        with patch("app.services.guest_album_service.guest_session_matches", return_value=False):
            response = self._patch({"skin": "grid"}, token=None)
        self.assertEqual(response.status_code, 403)
        self.assertEqual(self.saved, [])


class GuestOwnerAccessIsOwnerAccessTests(TestCase):
    """판정 자체 — 게스트 주최자는 주최자와 같은 능력을 갖는다(§1)."""

    def test_설정을_고칠_수_있다(self) -> None:
        access = guest_album_owner_access()
        self.assertIs(access.can_edit_settings, True)
        self.assertIs(access.is_album_owner, True)
        # 아무 관계 없는 사람은 그대로 아무것도 못 한다.
        self.assertIs(NO_ALBUM_ACCESS.can_edit_settings, False)


class EverySettingRouteTakesTheGuestTokenTests(TestCase):
    """같은 시트에서 고치는 것들이 **같은 문**을 쓴다 — 하나만 다르면 그것만 막힌다."""

    def test_네_자리_모두_게스트_토큰을_받는다(self) -> None:
        import pathlib
        source = (pathlib.Path(__file__).resolve().parents[1] / "app" / "api" / "album.py").read_text(encoding="utf-8")
        for marker in (
            '@router.patch("/albums/{album_id}", response_model=AlbumDetailResponse)',      # 모양·종이·맺음말
            '@router.patch("/albums/{album_id}/cover-photo"',                                 # 표지
            '@router.patch("/albums/{album_id}/title"',                                       # 제목
            '@router.patch("/albums/{album_id}/epilogue"',                                    # 우리의 이야기
        ):
            at = source.index(marker)
            head = source[at:at + 600]
            self.assertIn("_GUEST_TOKEN_HEADER", head, f"{marker} 가 게스트 토큰을 안 받는다")
            self.assertIn("optional_strict_authenticated_user", head, f"{marker} 가 로그인을 요구한다")
