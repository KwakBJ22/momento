"""앨범을 지우면 자식이 **DB 스스로** 사라진다 (K-2 · SCREEN_SPEC §9).

`albums` 를 가리키는 자식 17개 중 여덟이 `RESTRICT` 였고 의존이 두 겹이었다:

    memory_answers → memory_questions → album_media → albums
    guest_memory_submissions → share_links → albums

그래서 삭제 RPC 가 **순서를 손으로 알고 있어야** 했다. 2026-08-09 에 PO 가 앨범을
지우려다 두 번 막혔다.

★ **DB 가 알려주지 않으면 사람은 반드시 틀린다.** 새 자식 테이블이 하나 얹히고 RPC 에
  안 들어가면 그 순간부터 앨범 삭제가 조용히 실패한다 — 테스트 DB 에는 그 테이블에
  행이 없으니 테스트로도 안 잡힌다. 그래서 여기서는 **DB 가 그렇게 되어 있는지**를 본다.
"""

import re
from pathlib import Path
from unittest import TestCase

ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT / "supabase/migrations/20260810090000_album_children_cascade.sql"
ROLLBACK = ROOT / "supabase/migrations/20260810090000_album_children_cascade_rollback.sql"

#: `albums` 를 가리키던 RESTRICT 여덟. 하나라도 빠지면 그것 때문에 삭제가 막힌다.
ALBUM_CHILDREN = (
    "album_media",
    "album_members",
    "album_photos",
    "album_story_inputs",
    "guest_album_sessions",
    "guest_memory_submissions",
    "memory_questions",
    "share_links",
)

#: 자식들끼리의 RESTRICT — 여기가 남으면 위 여덟만 고쳐도 못 지운다(의존이 두 겹이다).
NESTED_CONSTRAINTS = (
    "memory_answers_question_id_fkey",
    "memory_questions_media_id_fkey",
    "guest_memory_submissions_share_link_id_fkey",
    "photo_memories_contributor_id_fkey",
)


def sql(path: Path) -> str:
    return path.read_text(encoding="utf-8")


class AlbumChildrenCascadeTests(TestCase):
    def test_every_album_child_cascades(self) -> None:
        text = sql(MIGRATION)
        for table in ALBUM_CHILDREN:
            constraint = f"{table}_album_id_fkey"
            self.assertIn(
                f"ADD CONSTRAINT {constraint} FOREIGN KEY (album_id) REFERENCES public.albums(id) ON DELETE CASCADE",
                text,
                f"{table} 가 여전히 앨범 삭제를 막는다",
            )

    def test_the_two_deep_chains_cascade_too(self) -> None:
        text = sql(MIGRATION)
        for constraint in NESTED_CONSTRAINTS:
            match = re.search(rf"ADD CONSTRAINT {constraint} FOREIGN KEY [^;]*", text)
            self.assertIsNotNone(match, f"{constraint} 를 안 고쳤다")
            self.assertIn("ON DELETE CASCADE", match.group(0))

    def test_statistics_survive_the_album(self) -> None:
        """★ 통계는 앨범이 사라져도 남는다 — `SET NULL` 을 건드리지 않았다(§9)."""
        text = sql(MIGRATION)
        for table in ("analytics_events", "ai_usage_logs"):
            self.assertNotIn(f"ALTER TABLE public.{table}", text, f"{table} 를 건드렸다")

    def test_the_rollback_puts_every_one_back(self) -> None:
        """되돌리면 손 열거에 다시 기댄다 — 그래서 짝이 정확히 맞아야 한다."""
        forward, backward = sql(MIGRATION), sql(ROLLBACK)
        self.assertEqual(forward.count("ON DELETE CASCADE"), backward.count("ON DELETE RESTRICT"))
        for table in ALBUM_CHILDREN:
            self.assertIn(
                f"ADD CONSTRAINT {table}_album_id_fkey FOREIGN KEY (album_id) REFERENCES public.albums(id) ON DELETE RESTRICT",
                backward,
            )
        # 되돌린 RPC 는 자식을 다시 손으로 지운다(그것이 K-2 이전의 모습이다).
        for table in ALBUM_CHILDREN:
            self.assertIn(f"DELETE FROM public.{table} WHERE album_id = p_album_id;", backward)


class NoHandWrittenDeleteOrderTests(TestCase):
    """★ DB 가 하는 일을 코드가 또 하지 않는다.

    삭제 순서를 손으로 적어 두면 새 테이블이 생길 때마다 빠뜨린다 — 그리고 그 실패는
    조용하다. 지금은 두 함수 다 **가드 + `DELETE FROM albums` 한 줄**이다.
    """

    def _function_body(self, name: str) -> str:
        text = sql(MIGRATION)
        start = text.index(f"CREATE OR REPLACE FUNCTION public.{name}")
        return text[start : text.index("$function$;", start)]

    def test_the_delete_rpc_only_deletes_the_album(self) -> None:
        for name in ("delete_album_cascade", "delete_abandoned_guest_album"):
            body = self._function_body(name)
            deletes = re.findall(r"DELETE FROM public\.(\w+)", body)
            self.assertEqual(deletes, ["albums"], f"{name} 이 자식을 아직 손으로 지운다")

    def test_the_guards_stay(self) -> None:
        """★ 지우는 것은 열거뿐이다. **자격을 보는 눈은 남긴다** — CASCADE 가 대신해 주지 않는다."""
        owner_guard = self._function_body("delete_album_cascade")
        self.assertIn("a.owner_id = p_actor_id", owner_guard)
        self.assertIn("RETURN false;", owner_guard)
        abandoned_guard = self._function_body("delete_abandoned_guest_album")
        self.assertIn("a.owner_id IS NULL", abandoned_guard)
        self.assertIn("s2.expires_at > now()", abandoned_guard)
        self.assertIn("RETURN false;", abandoned_guard)

    def test_python_never_lists_child_tables_to_delete(self) -> None:
        """파이썬 쪽도 삭제 순서를 알고 있지 않다 — RPC 를 부르기만 한다."""
        for path in ("app/api/album.py", "app/services/account_service.py", "app/services/guest_album_cleanup.py"):
            source = (ROOT / "backend" / path).read_text(encoding="utf-8")
            body = re.sub(r'"""[\s\S]*?"""', "", source)
            body = "".join(line for line in body.splitlines() if not line.strip().startswith("#"))
            for table in ALBUM_CHILDREN:
                self.assertNotIn(
                    f'table("{table}").delete()',
                    body,
                    f"{path} 가 {table} 를 직접 지운다",
                )
