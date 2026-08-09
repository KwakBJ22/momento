"""회원 탈퇴 — 무엇이 얼마나 사라지는지 (K-17 · SCREEN_SPEC §5 27차).

★ **되돌릴 수 없는 일이다.** 그래서 화면은 숫자를 보여주고, 서버는 그 숫자를 **직접**
  센다. 프런트가 보내는 숫자를 믿지 않는다(§10).

★ **지금 정말 막혀 있던 자리는 FK 가 아니라 CHECK 였다.** 프로덕션에서 예행해 확인했다
  (2026-08-10, ROLLBACK 한 트랜잭션 안에서):

      ERROR: 23514 new row for relation "album_contributors"
             violates check constraint "album_contributors_identity_check"
      CONTEXT: SQL statement "UPDATE ONLY album_contributors SET user_id = NULL ..."

  `album_contributors.user_id` 는 `ON DELETE SET NULL` 인데
  `CHECK (user_id IS NOT NULL OR guest_id IS NOT NULL)` 이 걸려 있어서, 프로필을 지우는
  순간 그 SET NULL 이 자기 테이블의 CHECK 를 어겼다. 즉 **남의 앨범에 계정으로 참여한
  적이 있는 사람은 탈퇴가 아예 안 됐다.** (`profiles` 를 가리키는 RESTRICT 넷은 탈퇴
  코드가 이미 순서대로 지우고 있었다 — 그쪽이 원인이 아니었다.)
"""

from pathlib import Path
from types import SimpleNamespace
from unittest import TestCase

from app.services import account_service

ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT / "supabase/migrations/20260810100000_withdrawal_anonymous_contributor.sql"
ROLLBACK = ROOT / "supabase/migrations/20260810100000_withdrawal_anonymous_contributor_rollback.sql"


class _Query:
    def __init__(self, rows, sink=None):
        self._rows = rows
        self._sink = sink

    def select(self, *_a, **_k):
        return self

    def eq(self, column, value):
        if self._sink is not None:
            self._sink.append(("eq", column, value))
        return self

    def in_(self, column, values):
        if self._sink is not None:
            self._sink.append(("in", column, list(values)))
        return self

    def or_(self, *_a, **_k):
        return self

    def execute(self):
        return SimpleNamespace(data=self._rows)


class _Client:
    """앨범·사진을 들고 있는 최소한의 가짜. 세는 식이 맞는지만 본다."""

    def __init__(self, owned_albums, photos_by_album, my_photos):
        self.owned_albums = owned_albums
        self.photos_by_album = photos_by_album
        self.my_photos = my_photos
        self.calls: list[tuple] = []

    def table(self, name):
        if name == "albums":
            return _Query([{"id": album_id} for album_id in self.owned_albums])
        if name == "album_photos":
            return _AlbumPhotos(self)
        raise AssertionError(f"세는 데 쓰지 않는 표를 읽었다: {name}")


class _AlbumPhotos:
    def __init__(self, client):
        self.client = client
        self._mode = None

    def select(self, *_a, **_k):
        return self

    def in_(self, column, values):
        assert column == "album_id"
        self._mode = ("in", list(values))
        return self

    def eq(self, column, value):
        self._mode = ("eq", column, value)
        return self

    def execute(self):
        if self._mode and self._mode[0] == "in":
            rows = [{"id": f"p{i}"} for album in self._mode[1] for i in self.client.photos_by_album.get(album, [])]
            return SimpleNamespace(data=rows)
        return SimpleNamespace(data=self.client.my_photos)


class WithdrawalCountTests(TestCase):
    def test_counts_my_albums_my_photos_and_what_stays_in_other_albums(self) -> None:
        client = _Client(
            owned_albums=["a1", "a2"],
            photos_by_album={"a1": [1, 2, 3], "a2": [1, 2]},
            # 내가 올린 사진 넷 중 둘은 내 앨범 것, 둘은 남의 앨범 것이다.
            my_photos=[
                {"id": "p1", "album_id": "a1"},
                {"id": "p2", "album_id": "a2"},
                {"id": "p3", "album_id": "other-1"},
                {"id": "p4", "album_id": "other-2"},
            ],
        )
        counts = account_service.count_withdrawal_impact(client, "me")
        self.assertEqual(counts, {"owned_albums": 2, "owned_photos": 5, "other_album_photos": 2})

    def test_nothing_to_lose_is_all_zeroes(self) -> None:
        counts = account_service.count_withdrawal_impact(_Client([], {}, []), "me")
        self.assertEqual(counts, {"owned_albums": 0, "owned_photos": 0, "other_album_photos": 0})

    def test_photos_in_my_own_album_are_not_counted_twice(self) -> None:
        """내 앨범 사진은 `지워지는 것`이지 `남는 것`이 아니다."""
        client = _Client(["a1"], {"a1": [1]}, [{"id": "p1", "album_id": "a1"}])
        counts = account_service.count_withdrawal_impact(client, "me")
        self.assertEqual(counts["other_album_photos"], 0)

    def test_counting_uses_the_same_album_list_as_deleting(self) -> None:
        """★ 세는 곳이 한 곳이다(§1).

        보여준 수와 실제로 지워지는 것이 어긋나면 안 되므로, 세는 쪽도 지우는 쪽도
        `list_all_owned_album_ids` 하나를 쓴다.
        """
        source = (ROOT / "backend/app/services/account_service.py").read_text(encoding="utf-8")
        counting = source[source.index("def count_withdrawal_impact") : source.index("def delete_owned_albums")]
        self.assertIn("list_all_owned_album_ids(client, user_id)", counting)
        deleting = source[source.index("def delete_owned_albums") : source.index("def anonymize_authored_names")]
        self.assertIn("list_all_owned_album_ids(client, user_id)", deleting)


class NameIsErasedNotRelabelledTests(TestCase):
    def test_the_name_left_in_other_albums_becomes_empty(self) -> None:
        """★ `탈퇴한 사용자` 라는 글자를 남기지 않는다.

        그 이름은 **남의 앨범**에 남고 인쇄물에도 들어간다. 그 사람의 추억에 남의
        탈퇴 사실이 박히는 것이다. 비우면 `함께 만든 사람` 줄이 그 자리를 건너뛴다.
        """
        self.assertEqual(account_service.WITHDRAWN_DISPLAY_NAME, "")

    def test_the_migration_lets_the_name_be_empty(self) -> None:
        sql = MIGRATION.read_text(encoding="utf-8")
        self.assertIn("CHECK (char_length(btrim(display_name)) <= 40)", sql)
        self.assertIn("CHECK (char_length(btrim(author_name)) <= 40)", sql)

    def test_a_nameless_contributor_row_is_allowed_only_when_it_is_nameless(self) -> None:
        """★ 원래 의도를 지킨다 — **이름을 가진 유령 참여자**는 여전히 만들 수 없다."""
        sql = MIGRATION.read_text(encoding="utf-8")
        self.assertIn(
            "CHECK (user_id IS NOT NULL OR guest_id IS NOT NULL OR btrim(display_name) = '')",
            sql,
        )

    def test_the_rollback_puts_the_old_checks_back(self) -> None:
        sql = ROLLBACK.read_text(encoding="utf-8")
        self.assertIn("CHECK (user_id IS NOT NULL OR guest_id IS NOT NULL)", sql)
        self.assertIn("char_length(btrim(display_name)) >= 1", sql)
        self.assertIn("char_length(btrim(author_name)) >= 1", sql)


class OtherPeoplesAlbumsSurviveTests(TestCase):
    """★ 남의 앨범을 깨뜨리지 않는다. 그 앨범은 다른 사람의 추억이다."""

    def test_withdrawal_never_deletes_rows_from_other_albums(self) -> None:
        source = (ROOT / "backend/app/services/account_service.py").read_text(encoding="utf-8")
        body = "".join(line for line in source.splitlines() if not line.strip().startswith("#"))
        # 남의 앨범에 남은 것들은 **고쳐 쓸 뿐** 지우지 않는다.
        for table in ("album_photos", "photo_memories", "album_story_inputs"):
            self.assertNotIn(f'table("{table}").delete()', body, f"{table} 를 지운다")
        self.assertIn('table("album_contributors")', body)
        self.assertIn('.update({"display_name": WITHDRAWN_DISPLAY_NAME', body)

    def test_the_profile_rpc_still_refuses_while_an_album_is_left(self) -> None:
        """앨범이 남아 있으면 프로필을 지우지 않는다 — 주인 없는 앨범을 만들지 않는다."""
        rpc = (ROOT / "supabase/migrations/20260801090000_account_withdrawal.sql").read_text(encoding="utf-8")
        guard = rpc[rpc.index("CREATE OR REPLACE FUNCTION public.delete_profile_cascade") :]
        self.assertIn("a.owner_id = p_profile_id OR a.created_by = p_profile_id", guard)
        self.assertIn("RETURN false;", guard)


class ServerDoesNotTrustTheScreenTests(TestCase):
    def test_the_summary_endpoint_counts_for_itself(self) -> None:
        api = (ROOT / "backend/app/api/auth.py").read_text(encoding="utf-8")
        handler = api[api.index('@router.get("/account/summary"') : api.index('@router.delete("/account"')]
        self.assertIn("count_withdrawal_impact(get_supabase_client(settings), authenticated_user_id)", handler)

    def test_the_delete_endpoint_takes_no_numbers_from_the_client(self) -> None:
        """★ 지울 때 프런트가 보낸 숫자를 쓰지 않는다(§10). 몸통 자체를 받지 않는다."""
        api = (ROOT / "backend/app/api/auth.py").read_text(encoding="utf-8")
        handler = api[api.index('@router.delete("/account"') :]
        handler = handler[: handler.index("return Response")]
        signature = handler[handler.index("async def delete_auth_account(") : handler.index(") -> Response")]
        self.assertIn("authenticated_user_id: str = Depends(require_authenticated_user)", signature)
        for leaked in ("body", "owned_albums", "owned_photos", "other_album_photos"):
            self.assertNotIn(leaked, signature, f"화면이 보낸 값을 받는다: {leaked}")


class FilesAreActuallyDeletedTests(TestCase):
    """★ 지운다고 화면에서 약속했으면 **파일까지 실제로 지운다** (K-17 ③).

    K-3 에서 세기만 만든 것은 **자동 정리**라 위험했기 때문이다. 탈퇴는 사용자가 직접
    누른 것이고, 지운다고 말했다. 말하고 안 지우면 거짓말이고 개인정보를 안 지운 것이 된다.

    ★ 다만 저장소와 DB 는 한 트랜잭션으로 묶을 수 없다(K-3). 그래서 **파일 삭제가
      실패해도 DB 를 되돌리지 않는다** — 기록에 남기고, K-3 의 세기가 나중에 잡는다.
    """

    def test_the_album_prefix_is_swept_not_just_the_known_rows(self) -> None:
        source = (ROOT / "backend/app/services/account_service.py").read_text(encoding="utf-8")
        block = source[source.index("def delete_owned_albums") : source.index("def anonymize_authored_names")]
        # dry_run=False 여야 실제로 지운다. remove_album_prefix 는 DB 가 모르는 파일까지 쓸어낸다.
        self.assertIn("dry_run=False", block)
        self.assertIn("remove_album_prefix=True", block)
        # 행이 사라지기 **전에** 경로를 먼저 챙긴다 — 지운 뒤에는 어디였는지 알 수 없다.
        self.assertLess(block.index("get_album_photo_asset_records"), block.index("delete_album_cascade"))

    def test_a_storage_failure_does_not_undo_the_deletion(self) -> None:
        cleanup = (ROOT / "backend/app/services/supabase.py").read_text(encoding="utf-8")
        block = cleanup[cleanup.index("def cleanup_album_files") :]
        block = block[: block.index("\ndef ", 10)]
        # 실패는 삼키되 **기록에 남긴다**. 조용히 지나가지 않는다(§11).
        self.assertIn("logger.warning(", block)
        self.assertIn("album_asset_prefix_cleanup_failed", block)
        self.assertNotIn("raise", block)
