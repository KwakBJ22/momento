"""**인쇄되는 것만 잠근다** — 한마디는 구경꾼도, 참여 종료 뒤에도 쓴다 (PO 결정 2026-08-16).

어긋나 있던 것 둘:
  ① 참여를 종료하면 한마디도 막혔다. 한마디는 인쇄에 안 들어가는데(C1) 앨범 확정과
     함께 닫혔다 — `관계는 끝나지 않고, 앨범은 완성된다`(제품_방향 §5)와 정반대였다.
  ② 구경꾼은 한마디를 못 썼다. 그런데 같은 사람이 `우리가 남긴 말`은 앨범 맨 아래에서
     쓸 수 있었다 — 막는 효과는 없고 불편만 남았다.

★ 여기서 재는 것은 **서버가 실제로 어떻게 답하는가**다. 화면이 버튼을 감추는 것과
  서버가 막는 것은 다른 이야기다 — 서버가 안 막으면 그건 안 막은 것이다(§10).
"""

from unittest import TestCase
from unittest.mock import MagicMock, patch

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.api.collaboration import router as collaboration_router
from app.services.collaboration_service import VIEWER_CONTRIBUTOR_ROLE, require_contributor

ALBUM_ID = "11111111-1111-1111-1111-111111111111"
PHOTO_ID = "22222222-2222-4222-8222-222222222222"
CONTRIBUTOR_ID = "33333333-3333-4333-8333-333333333333"


def _client_with(album: dict, contributor: dict) -> MagicMock:
    client = MagicMock()

    def table(name: str):
        handle = MagicMock()
        if name == "albums":
            handle.select.return_value.eq.return_value.limit.return_value.execute.return_value.data = [album]
        return handle

    client.table.side_effect = table
    patch("app.services.collaboration_service.get_contributor", return_value=contributor).start()
    return client


class RequireContributorTests(TestCase):
    """판정 자체 — `for_memory` 가 무엇을 통과시키는가."""

    def tearDown(self) -> None:
        patch.stopall()

    def _run(self, *, status: str, role: str, for_memory: bool):
        client = _client_with({"collaboration_status": status}, {"id": CONTRIBUTOR_ID, "role": role})
        return require_contributor(
            client, ALBUM_ID, contributor_id=None, guest_id=None, user_id="u1", for_memory=for_memory,
        )

    def test_참여가_끝나도_한마디는_통과한다(self) -> None:
        """★ 회귀 ① — 이것이 2026-08-16 에 뒤집힌 자리다."""
        contributor = self._run(status="closed", role="contributor", for_memory=True)
        self.assertEqual(contributor["id"], CONTRIBUTOR_ID)

    def test_참여가_끝나면_사진은_막힌다(self) -> None:
        """★ 회귀 ② — 사진은 인쇄되므로 그대로 잠긴다."""
        with self.assertRaises(HTTPException) as caught:
            self._run(status="closed", role="contributor", for_memory=False)
        self.assertEqual(caught.exception.status_code, 403)

    def test_이름만_받은_사람도_한마디는_쓴다(self) -> None:
        """감상 링크에서 이름만 적은 구경꾼(viewer) — 한마디는 인쇄되지 않는다."""
        contributor = self._run(status="collecting", role=VIEWER_CONTRIBUTOR_ROLE, for_memory=True)
        self.assertEqual(contributor["id"], CONTRIBUTOR_ID)

    def test_이름만_받은_사람은_사진을_못_올린다(self) -> None:
        """★ 참여자가 아니다 — 사진은 초대받은 사람의 몫이다(화면_기준 §1)."""
        with self.assertRaises(HTTPException) as caught:
            self._run(status="collecting", role=VIEWER_CONTRIBUTOR_ROLE, for_memory=False)
        self.assertEqual(caught.exception.status_code, 403)
        self.assertIn("초대 링크", caught.exception.detail)


class MemoryEndpointAnswers200WhenClosedTests(TestCase):
    """★ 회귀 ① — 참여가 끝난 앨범에서 **서버가 200 을 준다**."""

    def setUp(self) -> None:
        self.app = FastAPI()
        self.app.include_router(collaboration_router)
        self.client = TestClient(self.app)
        self.supabase = MagicMock()
        patch("app.api.collaboration.get_supabase_client", return_value=self.supabase).start()
        patch("app.api.collaboration.get_album_record", return_value={
            "id": ALBUM_ID, "collaboration_status": "closed",
        }).start()
        patch("app.api.collaboration.log_event").start()
        patch("app.api.collaboration.auto_append_contribution").start()
        patch("app.api.collaboration.create_photo_memory", return_value={
            "id": "44444444-4444-4444-8444-444444444444", "photo_id": PHOTO_ID,
            "author_name": "둘째", "comment": "늦었지만 한마디", "contributor_id": CONTRIBUTOR_ID,
            "created_at": "2026-08-16T00:00:00+00:00", "updated_at": None,
        }).start()
        self.addCleanup(patch.stopall)

    def test_확정된_앨범에도_한마디를_남길_수_있다(self) -> None:
        with patch("app.api.collaboration.require_contributor", return_value={"id": CONTRIBUTOR_ID}) as guard:
            response = self.client.post(
                f"/api/albums/{ALBUM_ID}/photos/{PHOTO_ID}/memories",
                json={"comment": "늦었지만 한마디", "contributor_id": CONTRIBUTOR_ID},
            )
        self.assertEqual(response.status_code, 200, response.text)
        # ★ 막는 자리에 **같은 잣대**를 넘겼는지 본다 — 이 값이 빠지면 예전처럼 403 이다.
        self.assertIs(guard.call_args.kwargs["for_memory"], True)

    def test_사진은_같은_앨범에서_여전히_403_이다(self) -> None:
        """★ 회귀 ② — 확정된 앨범의 사진 문은 닫혀 있다."""
        response = self.client.post(
            f"/api/albums/{ALBUM_ID}/contribute/photos",
            files=[("photos", ("a.jpg", b"x", "image/jpeg"))],
        )
        self.assertEqual(response.status_code, 403, response.text)


class EveryMemoryPathUsesTheSameRuleTests(TestCase):
    """남기기·고치기·지우기가 **같은 잣대**를 쓴다 — 하나만 고치면 언젠가 갈린다."""

    def test_세_자리_모두_for_memory_를_넘긴다(self) -> None:
        import pathlib
        import re
        source = (pathlib.Path(__file__).resolve().parents[1] / "app" / "api" / "collaboration.py").read_text(encoding="utf-8")
        self.assertEqual(len(re.findall(r"for_memory=True", source)), 3)
        # 사진 자리는 넘기지 않는다(기본값 그대로 = 잠긴다).
        photos = source[source.index('@router.post("/api/albums/{album_id}/contribute/photos")'):]
        photos = photos[:photos.index("@router.post(\"/api/albums/{album_id}/photos/{photo_id}/memories\"")]
        self.assertNotIn("for_memory", photos)


class FlagsGoOutToEveryScreenTests(TestCase):
    """★ 화면은 이 두 값만 읽는다 — 역할로 다시 추측하지 않는다(§11)."""

    def test_두_응답_모두_can_add_photo_와_can_add_memory_를_들고_있다(self) -> None:
        from app.models.schemas import AlbumDetailResponse, PublicShareAlbumResponse
        for model in (AlbumDetailResponse, PublicShareAlbumResponse):
            self.assertIn("can_add_photo", model.model_fields, model.__name__)
            self.assertIn("can_add_memory", model.model_fields, model.__name__)

    def test_공유_응답의_한마디는_늘_열려_있다(self) -> None:
        import pathlib
        source = (pathlib.Path(__file__).resolve().parents[1] / "app" / "api" / "share.py").read_text(encoding="utf-8")
        self.assertIn("can_add_memory=True,", source)
        self.assertIn("can_add_photo=contribution_block_reason(share, album) is None,", source)

    def test_앨범_상세는_권한에서_읽는다(self) -> None:
        import pathlib
        source = (pathlib.Path(__file__).resolve().parents[1] / "app" / "api" / "album.py").read_text(encoding="utf-8")
        self.assertIn('"can_add_photo": access.can_add_photo,', source)
        self.assertIn('"can_add_memory": access.can_add_memory,', source)


class NameOnlyVisitorIsNotAParticipantTests(TestCase):
    """★ 회귀 ⑤ — 한마디를 썼다고 참여자가 되지 않는다(화면_기준 §1)."""

    def test_이름만_받은_사람은_함께_만든_사람에_들어가지_않는다(self) -> None:
        from app.services import collaboration_service as cs
        rows = [
            {"id": "c1", "role": "owner", "user_id": None, "display_name": "주최자", "joined_at": "1"},
            {"id": "c2", "role": "contributor", "user_id": None, "display_name": "참여자", "joined_at": "2"},
            {"id": "c3", "role": VIEWER_CONTRIBUTOR_ROLE, "user_id": None, "display_name": "구경꾼", "joined_at": "3"},
        ]
        client = MagicMock()
        client.table.return_value.select.return_value.eq.return_value.eq.return_value.execute.return_value.data = rows
        self.assertEqual(cs.count_active_contributors(client, ALBUM_ID), 2, "이름만 받은 사람을 세었다")

    def test_인원_제한도_이름만_받은_사람에게는_걸지_않는다(self) -> None:
        import inspect
        from app.services import collaboration_service as cs
        source = inspect.getsource(cs.join_as_contributor)
        self.assertIn("if role != VIEWER_CONTRIBUTOR_ROLE:", source)
