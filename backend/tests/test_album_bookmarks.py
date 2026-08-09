"""담아둔 앨범 (F-1 · SCREEN_SPEC §1 9차).

구경하라고 받은 링크로 앨범을 봤는데 그 사람에게 아무 흔적이 남지 않았다.
카카오톡 대화방에서 링크를 다시 찾아야 하는데 대화방은 흘러간다.

★ 담아둬도 **권한은 바뀌지 않는다.** 여전히 보기만 한다 — 목록에 남을 뿐이다.
★ 같은 앨범이 두 칸에 뜨지 않는다.
"""

import re
from pathlib import Path
from types import SimpleNamespace
from unittest import TestCase

from app.services.bookmark_service import is_bookmarked, list_bookmarked_album_ids

ROOT = Path(__file__).resolve().parents[1]


def code(source: str) -> str:
    """주석·docstring 은 사람에게 하는 설명이지 동작이 아니다 — 판정에서 뺀다."""
    without_docstrings = re.sub(r'"""[\s\S]*?"""', "", source)
    return "".join(line for line in without_docstrings.splitlines() if not line.strip().startswith("#"))


class _Query:
    def __init__(self, rows):
        self._rows = rows

    def select(self, *_a, **_k):
        return self

    def eq(self, *_a, **_k):
        return self

    def order(self, *_a, **_k):
        return self

    def limit(self, *_a, **_k):
        return self

    def execute(self):
        return SimpleNamespace(data=self._rows)


class _Client:
    def __init__(self, rows):
        self._rows = rows

    def table(self, name):
        assert name == "album_bookmarks"
        return _Query(self._rows)


ROWS = [
    {"album_id": "a-3", "created_at": "2026-08-09T03:00:00Z"},
    {"album_id": "a-1", "created_at": "2026-08-09T02:00:00Z"},
    {"album_id": "a-2", "created_at": "2026-08-09T01:00:00Z"},
]


class BookmarkListTests(TestCase):
    def test_keeps_the_order_they_were_saved(self) -> None:
        self.assertEqual(list_bookmarked_album_ids(_Client(ROWS), "u-1", set()), ["a-3", "a-1", "a-2"])

    def test_albums_already_in_another_section_are_excluded(self) -> None:
        """★ 같은 앨범이 두 칸에 동시에 뜨지 않는다 — 여기서 뺀다."""
        self.assertEqual(list_bookmarked_album_ids(_Client(ROWS), "u-1", {"a-1"}), ["a-3", "a-2"])
        self.assertEqual(list_bookmarked_album_ids(_Client(ROWS), "u-1", {"a-1", "a-2", "a-3"}), [])

    def test_nothing_saved_means_empty(self) -> None:
        self.assertEqual(list_bookmarked_album_ids(_Client([]), "u-1", set()), [])


class BookmarkPermissionTests(TestCase):
    """★ 담아둬도 쓰기 권한이 생기지 않는다."""

    def test_bookmarking_never_touches_the_contributor_table(self) -> None:
        service = code((ROOT / "app/services/bookmark_service.py").read_text(encoding="utf-8"))
        # 참여자 표에 행을 만드는 것은 "참여자가 됐다" 는 뜻이다 — 담기는 그것이 아니다.
        self.assertNotIn("album_contributors", service)
        self.assertNotIn("ensure_contributor", service)

    def test_a_visitor_with_the_link_can_save(self) -> None:
        """★ K-7b 로 뒤집힌 항목 — 담아두기는 **구경꾼의 행동**이다(§1).

        예전에는 `PUT /albums/{id}/bookmark` 가 `require_album_read`(멤버 요구)를 걸어서
        구경꾼이 로그인해도 403 이었다. 실측(2026-08-09): 세 번 눌러 세 번 다 403,
        `album_bookmarks` 0건. 지금은 **링크를 가진 사람**이 담는다.
        """
        share = (ROOT / "app/api/share.py").read_text(encoding="utf-8")
        put = code(share[share.index('@router.put("/public/shares/{token}/bookmark"') : share.index('@router.post("/public/shares/{token}/reactions"')])
        self.assertIn("require_authenticated_user", put)  # 어디에 담을지가 계정이다
        self.assertIn("get_active_share(client, token)", put)  # 죽은 링크는 J-9 문구로 막힌다
        self.assertIn("share_token=token", put)  # 담은 링크를 함께 저장한다
        # ★ 서버가 "구경꾼인지" 까지 따지지 않는다 — 판정이 두 곳이 되면 또 갈라진다(§1).
        self.assertNotIn("require_album_read", put)
        # 권한을 주는 호출이 없다 — 담아둬도 여전히 보기만 한다.
        for granting in ["ensure_owner_contributor", "start_contribution", "album_contributors"]:
            self.assertNotIn(granting, put)

    def test_the_member_only_door_is_gone(self) -> None:
        """문이 둘이면 또 갈라진다 — 옛 경로는 없앴다."""
        album = (ROOT / "app/api/album.py").read_text(encoding="utf-8")
        self.assertNotIn('@router.put("/albums/{album_id}/bookmark"', album)

    def test_saved_album_remembers_its_link(self) -> None:
        """★ 담아둔 뒤 **어떻게 여는가** — 구경꾼은 `/album/{id}` 로 403 이다."""
        service = (ROOT / "app/services/bookmark_service.py").read_text(encoding="utf-8")
        self.assertIn("share_token", service)
        self.assertIn("def bookmark_share_tokens", service)
        schemas = (ROOT / "app/models/schemas.py").read_text(encoding="utf-8")
        item = schemas[schemas.index("class MyAlbumListItem") : schemas.index("class MyAlbumsResponse")]
        self.assertIn("share_token: str | None = None", item)

    def test_removing_is_possible(self) -> None:
        album = (ROOT / "app/api/album.py").read_text(encoding="utf-8")
        self.assertIn('@router.delete("/albums/{album_id}/bookmark"', album)
        self.assertIn("remove_bookmark(get_supabase_client(), authenticated_user_id, album_id)", album)


class BookmarkResponseTests(TestCase):
    def test_my_albums_has_the_third_section(self) -> None:
        schemas = (ROOT / "app/models/schemas.py").read_text(encoding="utf-8")
        model = schemas[schemas.index("class MyAlbumsResponse") : schemas.index("class AlbumPdfUrlResponse")]
        self.assertIn("bookmarked: list[MyAlbumListItem]", model)
        album = (ROOT / "app/api/album.py").read_text(encoding="utf-8")
        # 세 번째 칸은 앞 두 칸을 빼고 만든다.
        self.assertIn(
            "list_bookmarked_album_ids(\n        client, authenticated_user_id, set(album_ids) | set(participating_ids)\n    )",
            album,
        )

    def test_share_response_tells_the_current_state(self) -> None:
        share = (ROOT / "app/api/share.py").read_text(encoding="utf-8")
        self.assertIn("viewer_bookmarked=bool(user_id) and is_bookmarked(client, str(user_id), album_id)", share)


class ShareResponseBookmarkStateTests(TestCase):
    """★ 다시 들어와도 담긴 상태로 보인다 (K-12 · SCREEN_SPEC §1 25차).

    실기기에서 담아둔 뒤에도 `담아둘까요?` 가 그대로 남았다. 화면 쪽이 담긴 값을 따로
    베껴 두고 그것이 덮여서 났다 — 그래서 화면을 고쳤다(공유 화면 한 곳).

    여기서는 **화면이 기댈 근거**를 잠근다: 공유 응답이 그 사실을 함께 싣는다.
    새 API 를 만들지 않는다 — 기존 응답을 넓힌 것이다(§10).
    """

    def test_a_saved_album_reads_back_as_saved(self) -> None:
        self.assertTrue(is_bookmarked(_Client([{"id": "b-1"}]), "u-1", "a-1"))

    def test_an_unsaved_album_reads_back_as_not_saved(self) -> None:
        self.assertFalse(is_bookmarked(_Client([]), "u-1", "a-1"))

    def test_the_share_response_carries_the_field(self) -> None:
        schemas = (ROOT / "app/models/schemas.py").read_text(encoding="utf-8")
        # 기본값은 False 다 — 비로그인은 늘 안 담김이다.
        self.assertIn("viewer_bookmarked: bool = False", schemas)

    def test_the_share_endpoint_can_see_who_is_asking(self) -> None:
        """로그인을 못 읽으면 담긴 앨범도 늘 안 담김으로 내려간다."""
        share = code((ROOT / "app/api/share.py").read_text(encoding="utf-8"))
        handler = share[share.index('@router.get("/public/shares/{token}"'):]
        handler = handler[: handler.index("async def", handler.index("async def") + 1)]
        self.assertIn("user_id: str | None = Depends(optional_authenticated_user)", handler)

    def test_no_separate_api_asks_whether_it_is_saved(self) -> None:
        """상태를 묻는 API 를 따로 만들지 않는다 — 공유 응답이 이미 말한다(§10)."""
        album = code((ROOT / "app/api/album.py").read_text(encoding="utf-8"))
        share = code((ROOT / "app/api/share.py").read_text(encoding="utf-8"))
        for source in (album, share):
            self.assertNotIn("bookmark/status", source)
            self.assertNotIn("bookmarks/status", source)
