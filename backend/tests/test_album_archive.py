"""보관함 — **지우지 않고 감춰 두는 길** (2026-08-17 · 시안 delete-sheet 1b ②단계).

★ 이 파일이 지키는 것 하나: **보관은 아무것도 지우지 않는다.** 사진·한마디는 그대로
  있어야 `언제든 다시 꺼낼 수 있어요` 가 참말이 된다. 바뀌는 것은 status 한 칸이다.
★ 주최자만이다 — 삭제와 같은 문을 쓴다.
★ migration 이 없다: `archived` 는 albums.status CHECK 에 이미 있는 값이다.
"""

import pathlib
from unittest import TestCase
from unittest.mock import MagicMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.album import router
from app.services.auth import require_authenticated_user
from app.services.authorization import AlbumAccess

ALBUM_ID = "11111111-1111-1111-1111-111111111111"

OWNER = AlbumAccess(family_role=None, album_role="owner", is_legacy_owner=False)
EDITOR = AlbumAccess(family_role=None, album_role="editor", is_legacy_owner=False)
CONTRIBUTOR = AlbumAccess(family_role=None, album_role="contributor", is_legacy_owner=False)
VIEWER = AlbumAccess(family_role=None, album_role="viewer", is_legacy_owner=False)


class ArchiveTests(TestCase):
    def setUp(self) -> None:
        self.app = FastAPI()
        self.app.include_router(router)
        self.client = TestClient(self.app)
        #: albums 표에 실제로 나간 update 들.
        self.updates: list[dict] = []
        #: 사진·한마디 표를 건드렸는지 — 보관이 지우지 않는다는 것을 여기서 본다.
        self.touched_tables: list[str] = []

        supabase = MagicMock()

        def table(name: str):
            self.touched_tables.append(name)
            handle = MagicMock()
            if name == "albums":
                def update(payload):
                    self.updates.append(payload)
                    result = MagicMock()
                    result.eq.return_value.execute.return_value.data = [{"id": ALBUM_ID}]
                    return result
                handle.update.side_effect = update
            return handle

        supabase.table.side_effect = table
        patch("app.api.album.get_supabase_client", return_value=supabase).start()
        patch("app.api.album.get_album_record", return_value={"id": ALBUM_ID, "owner_id": "owner-1"}).start()
        self.addCleanup(patch.stopall)

    def _post(self, action: str, access: AlbumAccess, user: str = "owner-1"):
        self.app.dependency_overrides[require_authenticated_user] = lambda: user
        with patch("app.api.album.get_album_access", return_value=access):
            return self.client.post(f"/api/albums/{ALBUM_ID}/{action}")

    def test_보관하면_status_한_칸만_바뀐다(self) -> None:
        response = self._post("archive", OWNER)
        self.assertEqual(response.status_code, 204, response.text)
        self.assertEqual(self.updates, [{"status": "archived"}])

    def test_꺼내면_되돌아온다(self) -> None:
        response = self._post("unarchive", OWNER)
        self.assertEqual(response.status_code, 204, response.text)
        self.assertEqual(self.updates, [{"status": "active"}])

    def test_보관은_사진도_한마디도_지우지_않는다(self) -> None:
        """★ 이 커밋에서 가장 무서운 자리 — 감추는 일이 지우는 일이 되면 안 된다."""
        self._post("archive", OWNER)
        for table in ("album_photos", "photo_memories", "album_media", "album_contributors"):
            self.assertNotIn(table, self.touched_tables, f"보관하면서 {table} 를 건드렸다")
        # albums 에도 status 말고는 아무것도 쓰지 않는다.
        self.assertEqual([set(update) for update in self.updates], [{"status"}])

    def test_주최자가_아니면_403(self) -> None:
        for action in ("archive", "unarchive"):
            for access in (EDITOR, CONTRIBUTOR, VIEWER):
                response = self._post(action, access, user="someone")
                self.assertEqual(response.status_code, 403, f"{action}/{access.album_role}: {response.text}")
                self.assertEqual(self.updates, [], "막았는데 바꿨다")

    def test_없는_앨범은_404(self) -> None:
        with patch("app.api.album.get_album_record", return_value=None):
            response = self._post("archive", OWNER)
        self.assertEqual(response.status_code, 404)


class ArchivedAlbumsLeaveTheListTests(TestCase):
    """보관한 앨범은 **내 앨범에서 빠지고 보관함에 들어간다** — 같은 근거(owner_id)를 본다."""

    def test_목록_조회가_보관을_거른다(self) -> None:
        source = (pathlib.Path(__file__).resolve().parents[1] / "app" / "services" / "supabase.py").read_text(encoding="utf-8")
        for marker in ("def list_owned_album_list_records", "def list_participating_album_list_records"):
            at = source.index(marker)
            body = source[at:source.index("\n\ndef ", at)]
            self.assertIn('.neq("status", "archived")', body, f"{marker} 가 보관한 앨범을 그대로 보여준다")
        # 보관함은 그 반대 조건 하나다.
        at = source.index("def list_archived_album_list_records")
        archived = source[at:source.index("\n\ndef ", at)]
        self.assertIn('.eq("status", "archived")', archived)
        self.assertIn('.eq("owner_id", profile_id)', archived)


class NoMigrationNeededTests(TestCase):
    def test_archived_는_이미_허용된_값이다(self) -> None:
        """migration 을 만들지 않는 근거 — CHECK 에 이미 있다."""
        migrations = pathlib.Path(__file__).resolve().parents[2] / "supabase" / "migrations"
        core = (migrations / "20260712160000_db_core_migration.sql").read_text(encoding="utf-8")
        self.assertIn("'archived'", core)
        # 이번 작업으로 새로 만든 migration 이 없다.
        added = [path.name for path in migrations.glob("*archive*.sql")]
        self.assertEqual(added, [], f"필요 없는 migration 을 만들었다: {added}")
