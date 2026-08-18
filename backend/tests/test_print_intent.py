"""`실물 앨범으로 받아보기` — **파는 것이 아니라 재는 것**이다 (유료화_기준 §7).

인쇄는 1순위 수익원인데 지금은 아무 데서도 안 내보인다. 시범운영이 끝나도
`사람들이 돈을 낼까` 에 대한 데이터가 0 이 된다(제품_방향 §7). 그래서 묻기만 한다 —
결제도 배송도 연락처도 없다.

★ 새 테이블을 만들지 않는다. analytics_events 에 `print_intent` 로 남긴다.
★ **같은 사람이 같은 앨범에서 두 번 눌러도 한 번만 센다.** 수요를 재는 값이라
  한 사람이 여러 번 누르면 수가 부풀어 판단이 틀어진다.
★ **구경꾼은 세지 않는다.** 구경만 한 사람의 관심은 `내 앨범을 인쇄해 갖고 싶다`
  와 다른 값이다 — 섞으면 수요가 부풀어 보인다.
"""

import pathlib
from unittest import TestCase
from unittest.mock import MagicMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.album import router
from app.services.authorization import AlbumAccess

ALBUM_ID = "11111111-1111-1111-1111-111111111111"
VISITOR = "visitor-token-0123456789abcdef"

OWNER = AlbumAccess(family_role=None, album_role="owner", is_legacy_owner=False)
CONTRIBUTOR = AlbumAccess(family_role=None, album_role="contributor", is_legacy_owner=False)
VIEWER = AlbumAccess(family_role=None, album_role="viewer", is_legacy_owner=False)


class PrintIntentTests(TestCase):
    def setUp(self) -> None:
        self.app = FastAPI()
        self.app.include_router(router)
        self.client = TestClient(self.app)
        self.logged: list[dict] = []
        #: 이미 쌓여 있는 print_intent 행(같은 사람·같은 앨범인지 보는 조회의 답).
        self.existing: list[dict] = []
        self.queries: list[tuple[str, str]] = []

        supabase = MagicMock()

        def table(name: str):
            handle = MagicMock()
            if name == "analytics_events":
                chain = handle.select.return_value

                def eq(column, value):
                    self.queries.append((column, value))
                    return chain

                chain.eq.side_effect = eq
                chain.limit.return_value.execute.return_value.data = self.existing
            return handle

        supabase.table.side_effect = table
        patch("app.api.album.get_supabase_client", return_value=supabase).start()
        patch("app.api.album.get_album_record", return_value={"id": ALBUM_ID, "owner_id": None}).start()
        patch("app.api.album.count_ready_album_photos", return_value=24).start()

        def log_event(_client, name, **kwargs):
            self.logged.append({"name": name, **kwargs})
            return True

        patch("app.api.album.log_event", side_effect=log_event).start()
        self.addCleanup(patch.stopall)

    def _post(self, access: AlbumAccess):
        with patch("app.api.album._actor_album_access", return_value=access):
            return self.client.post(
                f"/api/albums/{ALBUM_ID}/print-intent",
                headers={"X-Woorialbum-Visitor": VISITOR},
            )

    def test_주최자가_누르면_한_번_센다(self) -> None:
        response = self._post(OWNER)
        self.assertEqual(response.status_code, 204, response.text)
        self.assertEqual(len(self.logged), 1)
        event = self.logged[0]
        self.assertEqual(event["name"], "print_intent")
        self.assertEqual(event["album_id"], ALBUM_ID)
        # 같이 남기는 것: 사진 수 · 주최자인지. 앨범 id 는 위에서 봤다.
        self.assertEqual(event["metadata"], {"photo_count": 24, "source": "owner"})
        self.assertTrue(event["visitor_key"], "사람 단위로 세는 값이 없다")

    def test_참여자도_센다_주최자와_구분해서(self) -> None:
        self._post(CONTRIBUTOR)
        self.assertEqual(self.logged[0]["metadata"]["source"], "contributor")

    def test_같은_사람이_두_번_눌러도_한_번이다(self) -> None:
        """★ 이번 수정의 핵심 — 이미 남긴 사람이면 다시 넣지 않는다."""
        self.existing = [{"id": "already"}]
        response = self._post(OWNER)
        # 사용자에게는 성공이다. 이미 센 사실을 굳이 오류로 알리지 않는다.
        self.assertEqual(response.status_code, 204)
        self.assertEqual(self.logged, [], "두 번 셌다")
        # 무엇으로 같은지 봤는가 — 이벤트 이름 · 앨범 · 사람 셋이다.
        self.assertEqual(
            {column for column, _ in self.queries},
            {"event_name", "album_id", "visitor_key"},
        )

    def test_구경꾼은_세지_않는다(self) -> None:
        response = self._post(VIEWER)
        self.assertEqual(response.status_code, 403)
        self.assertEqual(self.logged, [], "구경꾼의 관심이 수요에 섞였다")


class PrintIntentSellsNothingTests(TestCase):
    """★ 파는 것이 아니다. 재는 것이다 — 결제·배송·가격·연락처가 여기 없다."""

    def test_받는_것이_없다(self) -> None:
        source = (pathlib.Path(__file__).resolve().parents[1] / "app" / "api" / "album.py").read_text(encoding="utf-8")
        at = source.index('@router.post("/albums/{album_id}/print-intent"')
        end = source.index("@router.", at + 10)
        # 본문만 본다(주석에는 `결제도 배송도 없다` 라고 적어 두었다).
        body = "\n".join(line for line in source[at:end].splitlines() if not line.strip().startswith("#"))
        body = body.split('"""')[0] + body.split('"""')[-1]
        for banned in ("price", "address", "email", "phone", "payment", "order"):
            self.assertNotIn(banned, body.lower(), f"재는 자리에 `{banned}` 가 생겼다")
