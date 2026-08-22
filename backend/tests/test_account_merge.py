"""계정 합치기 (2026-08-19 · 2단계).

PO 결정: **이메일이 같으면 묻는다. 다르면 사용자가 직접 합친다.**

이 파일이 지키는 것 넷:
  ① 합치기 전후로 **앨범 수 · 참여 수 · 한마디 수가 같다** — 하나라도 잃으면 안 된다
  ② 한쪽만 로그인한 상태로는 합쳐지지 않는다
  ③ 중간에 실패하면 아무것도 바뀌지 않는다
  ④ 이메일이 다른 계정과는 합쳐지지 않는다
"""

import pathlib
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.auth import router
from app.services.auth import require_authenticated_user

ME = "11111111-1111-1111-1111-111111111111"
OTHER = "22222222-2222-2222-2222-222222222222"
STRANGER = "33333333-3333-3333-3333-333333333333"


class FakeDb:
    """profiles 두 개와 그들이 들고 있는 것 — 합치기 전후를 세기 위한 최소 대역."""

    def __init__(self) -> None:
        self.profiles = {
            ME: {"id": ME, "email": "same@test.local", "display_name": "나",
                 "primary_provider": "kakao", "deleted_at": None, "status": "active"},
            OTHER: {"id": OTHER, "email": "same@test.local", "display_name": "나(이메일)",
                    "primary_provider": "email", "deleted_at": None, "status": "active"},
        }
        # (표, 칸) → [행 주인]
        self.rows = {
            ("albums", "owner_id"): [ME, OTHER, OTHER],
            ("album_contributors", "user_id"): [ME, OTHER],
            ("album_members", "profile_id"): [OTHER],
            ("album_bookmarks", "user_id"): [OTHER],
            ("photo_memories", "author_id"): [ME, ME, OTHER],
            ("album_photos", "contributor_profile_id"): [OTHER],
        }
        self.rpc_calls: list[dict] = []
        self.rpc_fails = False

    def merge(self, source: str, target: str) -> dict:
        if self.rpc_fails:
            # ★ 진짜 RPC 는 트랜잭션이라 실패하면 **아무것도 바뀌지 않는다**.
            #   대역도 그렇게 흉내 낸다 — 손대기 전에 던진다.
            raise RuntimeError("merge failed")
        moved = 0
        for owners in self.rows.values():
            for index, owner in enumerate(owners):
                if owner == source:
                    owners[index] = target
                    moved += 1
        self.profiles[source]["deleted_at"] = "2026-08-19T00:00:00+00:00"
        self.profiles[source]["status"] = "deleted"
        return {"moved": moved, "dropped": 0}

    # --- supabase client 흉내 ---
    def table(self, name: str):
        return _Table(self, name)

    def rpc(self, fn: str, params: dict):
        self.rpc_calls.append({"fn": fn, **params})
        data = self.merge(params["p_source"], params["p_target"])
        return SimpleNamespace(execute=lambda: SimpleNamespace(data=data))


class _Table:
    def __init__(self, db: FakeDb, name: str) -> None:
        self.db = db
        self.name = name
        self.filters: list[tuple[str, str]] = []
        self.or_expr: str | None = None

    def select(self, *_args):
        return self

    def eq(self, column: str, value):
        self.filters.append((column, str(value)))
        return self

    def or_(self, expr: str):
        self.or_expr = expr
        return self

    def limit(self, _n: int):
        return self

    def execute(self):
        if self.name == "profiles":
            rows = list(self.db.profiles.values())
            for column, value in self.filters:
                rows = [row for row in rows if str(row.get(column) or "") == value]
            return SimpleNamespace(data=[dict(row) for row in rows])
        if self.or_expr:  # albums: owner_id.eq.X,created_by.eq.X
            wanted = self.or_expr.split(".eq.")[1].split(",")[0]
            owners = self.db.rows.get((self.name, "owner_id"), [])
            return SimpleNamespace(data=[{"id": f"a{i}"} for i, owner in enumerate(owners) if owner == wanted])
        column, value = self.filters[0]
        owners = self.db.rows.get((self.name, column), [])
        return SimpleNamespace(data=[{"id": f"r{i}"} for i, owner in enumerate(owners) if owner == value])


class AccountMergeTests(TestCase):
    def setUp(self) -> None:
        self.app = FastAPI()
        self.app.include_router(router)
        self.app.dependency_overrides[require_authenticated_user] = lambda: ME
        self.addCleanup(self.app.dependency_overrides.clear)
        self.client = TestClient(self.app)
        self.db = FakeDb()
        patch("app.api.auth.get_supabase_client", return_value=self.db).start()
        self.addCleanup(patch.stopall)

    def _merge(self, token_user: str | None):
        user = SimpleNamespace(id=token_user) if token_user else None
        with patch("app.api.auth.verify_access_token", return_value=user):
            return self.client.post("/api/auth/merge", json={"other_access_token": "t" * 20})

    # --- ② 한쪽만으로는 합쳐지지 않는다 ---

    def test_합칠_계정의_토큰이_없으면_401(self) -> None:
        response = self._merge(None)
        self.assertEqual(response.status_code, 401)
        self.assertEqual(self.db.rpc_calls, [], "막았는데 합쳤다")

    def test_같은_계정_토큰이면_400(self) -> None:
        response = self._merge(ME)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.db.rpc_calls, [])

    # --- ④ 이메일이 다르면 여기서 합치지 않는다 ---

    def test_후보가_아닌_계정과는_합치지_않는다(self) -> None:
        self.db.profiles[STRANGER] = {
            "id": STRANGER, "email": "other@test.local", "display_name": "남",
            "primary_provider": "email", "deleted_at": None, "status": "active",
        }
        response = self._merge(STRANGER)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.db.rpc_calls, [])

    # --- ① 하나도 잃지 않는다 ---

    def test_합치기_전후로_수가_같다(self) -> None:
        """★ 이 커밋에서 가장 무서운 자리 — 옮기다 잃으면 되돌릴 수 없다."""
        response = self._merge(OTHER)
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body["before"], body["after"], "합치는 사이에 잃은 것이 있다")
        # 두 계정이 들고 있던 것이 전부 한쪽으로 왔다.
        self.assertEqual(body["after"]["albums"], 3)
        self.assertEqual(body["after"]["memories"], 3)
        self.assertEqual(body["after"]["contributions"], 2)
        # 남는 계정은 **닫기만** 한다. 지우지 않는다.
        self.assertIsNotNone(self.db.profiles[OTHER]["deleted_at"])
        self.assertIn(OTHER, self.db.profiles)

    def test_남는_쪽은_지금_로그인한_계정이다(self) -> None:
        self._merge(OTHER)
        self.assertEqual(self.db.rpc_calls, [{"fn": "merge_profiles", "p_source": OTHER, "p_target": ME}])

    # --- ③ 실패하면 아무것도 바뀌지 않는다 ---

    def test_중간에_실패하면_아무것도_안_바뀐다(self) -> None:
        self.db.rpc_fails = True
        before = {key: list(value) for key, value in self.db.rows.items()}
        response = self._merge(OTHER)
        self.assertEqual(response.status_code, 500)
        self.assertEqual(self.db.rows, before, "실패했는데 반쯤 옮겨졌다")
        self.assertIsNone(self.db.profiles[OTHER]["deleted_at"], "실패했는데 계정을 닫았다")


class MergeCandidateTests(TestCase):
    def setUp(self) -> None:
        self.app = FastAPI()
        self.app.include_router(router)
        self.app.dependency_overrides[require_authenticated_user] = lambda: ME
        self.addCleanup(self.app.dependency_overrides.clear)
        self.client = TestClient(self.app)
        self.db = FakeDb()
        patch("app.api.auth.get_supabase_client", return_value=self.db).start()
        self.addCleanup(patch.stopall)

    def test_같은_이메일이면_후보를_알려_준다(self) -> None:
        body = self.client.get("/api/auth/merge-candidate").json()
        self.assertTrue(body["found"])
        self.assertEqual(body["candidate_id"], OTHER)
        self.assertEqual(body["provider"], "email")
        self.assertEqual(body["my_provider"], "kakao")

    def test_알려_주는_것은_길과_이메일뿐이다(self) -> None:
        """아직 그 계정의 주인임을 증명하지 않았다 — 이름·앨범을 주지 않는다."""
        body = self.client.get("/api/auth/merge-candidate").json()
        self.assertNotIn("display_name", body)
        self.assertNotIn("albums", body)

    def test_이메일이_다르면_후보가_없다(self) -> None:
        self.db.profiles[OTHER]["email"] = "other@test.local"
        self.assertFalse(self.client.get("/api/auth/merge-candidate").json()["found"])

    def test_이미_합쳐진_계정으로_들어오면_남은_계정을_안내한다(self) -> None:
        self.db.profiles[ME]["deleted_at"] = "2026-08-19T00:00:00+00:00"
        body = self.client.get("/api/auth/merge-candidate").json()
        self.assertTrue(body["merged_away"])
        self.assertEqual(body["merged_into_provider"], "email")
        self.assertFalse(body["found"])

    def test_조회가_실패해도_로그인을_막지_않는다(self) -> None:
        with patch("app.api.auth.find_merged_away", side_effect=RuntimeError("db down")):
            body = self.client.get("/api/auth/merge-candidate").json()
        self.assertFalse(body["found"])


class MergeMigrationRulesTests(TestCase):
    """합치기 함수(migration)의 규칙 — **글이 실려 있으면 지우지 않는다** (2026-08-21).

    ★ plpgsql 은 여기서 실행할 수 없다. 그래서 함수 **본문의 규칙**을 잠근다 —
      지우는 문이 어디에 몇 개인지, 딸린 글을 옮기는 순서가 맞는지, 주인 검사가 있는지.
      실제 데이터로 재는 조회는 docs/DATA_CHECKS.md 에 있다(적용한 뒤 PO 가 돌린다).
    """

    @classmethod
    def setUpClass(cls) -> None:
        path = pathlib.Path(__file__).resolve().parents[2] / "supabase" / "migrations" / "20260819120000_merge_profiles.sql"
        cls.sql = path.read_text(encoding="utf-8")
        # 주석을 뺀 본문 — 없어진 규칙을 **적어 둔** 줄이 검사에 걸리면 사정을 적을 수 없다.
        cls.body = "\n".join(
            line for line in cls.sql.splitlines() if not line.strip().startswith("--")
        )

    def test_지우는_문은_북마크_하나뿐이다(self) -> None:
        """★ 이 파일이 지키는 것의 핵심 — 겹쳐도 사용자 글을 지우지 않는다."""
        deletes = [line.strip() for line in self.body.splitlines() if "DELETE FROM" in line]
        self.assertEqual(len(deletes), 1, f"지우는 문이 늘었다: {deletes}")
        self.assertIn("album_bookmarks", deletes[0], "북마크가 아닌 것을 지운다")
        # 옛 판의 `겹치면 지운다` 가 되살아나면 여기서 잡힌다.
        self.assertNotIn("unique_violation", self.body, "겹치면 지우던 옛 규칙이 돌아왔다")

    def test_참여_행은_딸린_글을_먼저_옮기고_닫는다(self) -> None:
        """photo_memories 는 CASCADE 라 참여 행을 지우면 한마디가 통째로 사라진다."""
        block = self.body[self.body.index("album_contributors AS s"):self.body.index("album_members AS s")]
        for dependent in ("photo_memories", "album_photos", "album_guestbook_entries"):
            self.assertIn(dependent, block, f"딸린 {dependent} 를 옮기지 않는다")
            # 옮기는 것이 닫는 것보다 먼저다.
            self.assertLess(block.index(dependent), block.index("'removed'"), f"{dependent} 를 옮기기 전에 닫는다")
        # 닫는다 — 지우지 않는다.
        self.assertIn("SET status = 'removed'", block)
        self.assertNotIn("DELETE", block)

    def test_겹친_자리는_높은_역할을_남긴다(self) -> None:
        # album_members: owner > editor > contributor > viewer.
        members = self.body[self.body.index("album_members AS s"):self.body.index("family_members AS s")]
        self.assertIn("WHEN 'owner' THEN 4 WHEN 'editor' THEN 3", members)
        self.assertIn("SET status = 'removed', removed_at = now()", members)
        # family_members: owner > admin > member — 그리고 옮기는 쪽을 **먼저** 닫는다
        # (활성 owner 유일 제약에 걸리지 않으려면 순서가 이래야 한다).
        family = self.body[self.body.index("family_members AS s"):self.body.index("memory_answers")]
        self.assertIn("WHEN 'owner' THEN 3 WHEN 'admin' THEN 2", family)
        self.assertLess(
            family.index("SET status = 'removed', left_at = now()"),
            family.index("SET role = CASE"),
            "닫기 전에 역할을 올리면 활성 owner 둘이 된다",
        )

    def test_주인_없는_가족이_생기면_전체를_되돌린다(self) -> None:
        self.assertIn("RAISE EXCEPTION 'merge_profiles: 가족", self.body)
        self.assertIn("role = 'owner' AND status = 'active'", self.body)

    def test_답변_글은_남길_쪽이_빈_경우에만_옮긴다(self) -> None:
        answers = self.body[self.body.index("memory_answers AS a"):self.body.index("DELETE FROM public.album_bookmarks")]
        self.assertIn("NOT EXISTS", answers)
        self.assertNotIn("DELETE", answers)

    def test_ctid_커서가_없다(self) -> None:
        """갱신하면 ctid 가 바뀌어 같은 줄을 다시 만날 수 있다 — 전부 집합 연산이어야 한다."""
        self.assertNotIn("ctid", self.body)

    def test_created_by_를_두_번_세지_않는다(self) -> None:
        """albums.created_by 는 FK 가 있어 자동 순회에 잡힌다 — 손 갱신은 owner_id 하나다."""
        self.assertNotIn("SET created_by = p_target", self.body)
        self.assertEqual(self.body.count("SET owner_id = p_target"), 1)

    def test_연락처는_빈_칸만_채운다(self) -> None:
        """닫는 계정에만 있던 연락처가 사라지면 안 되고, 남길 쪽 것을 덮어써도 안 된다."""
        self.assertIn("COALESCE(NULLIF(t.contact_phone, ''), s.contact_phone)", self.body)
        self.assertIn("COALESCE(NULLIF(t.contact_email, ''), s.contact_email)", self.body)

    def test_규칙이_있는_다섯_표는_자동_순회에서_뺀다(self) -> None:
        loop = self.body[self.body.index("pg_constraint"):]
        for table in ("album_contributors", "album_members", "family_members", "memory_answers", "album_bookmarks"):
            self.assertIn(f"'{table}'", loop, f"{table} 가 자동 순회에 다시 잡힌다(규칙이 무시된다)")

    def test_프로필은_닫기만_한다(self) -> None:
        self.assertIn("SET status = 'deleted', deleted_at = COALESCE(deleted_at, now())", self.body)
        self.assertNotIn("DELETE FROM public.profiles", self.body)


class MergedAwayBootstrapTests(TestCase):
    """③ 합친 뒤 옛 계정으로 로그인하면 — **남은 계정으로 안내한다** (2026-08-21).

    auth.users 를 지우지 않으므로 옛 방법으로 다시 로그인할 수 있다. 그대로 두면
    ensure_default_family 가 터져 맨 500 이 화면에 갔다. 새 프로필을 만들지 않고
    (만들면 방금 합친 것이 도로 갈라진다) 어디로 가야 하는지 말한다.
    """

    def setUp(self) -> None:
        self.app = FastAPI()
        self.app.include_router(router)
        self.app.dependency_overrides[require_authenticated_user] = lambda: ME
        self.addCleanup(self.app.dependency_overrides.clear)
        self.client = TestClient(self.app)
        patch("app.api.auth.get_supabase_client", return_value=SimpleNamespace()).start()
        self.addCleanup(patch.stopall)

    def test_합쳐진_계정이면_남은_계정으로_안내한다(self) -> None:
        ensure = patch("app.api.auth.ensure_default_family").start()
        with patch("app.api.auth.find_merged_away", return_value={"provider": "kakao"}):
            response = self.client.post("/api/auth/bootstrap", json={})
        self.assertEqual(response.status_code, 409)
        self.assertIn("카카오", response.json()["detail"])
        self.assertIn("합쳐졌어요", response.json()["detail"])
        # ★ 새 프로필·가족을 만들지 않는다 — 만들면 합친 것이 도로 갈라진다.
        ensure.assert_not_called()

    def test_조회가_실패해도_정상_로그인을_막지_않는다(self) -> None:
        with patch("app.api.auth.find_merged_away", side_effect=RuntimeError("db down")),              patch("app.api.auth.ensure_default_family", return_value=ME),              patch("app.api.auth.get_user_limits", return_value={"max_albums": 10}),              patch("app.api.auth.count_owned_albums", return_value=0),              patch("app.api.auth.has_legal_consent", return_value=True):
            response = self.client.post("/api/auth/bootstrap", json={})
        self.assertEqual(response.status_code, 200, response.text)
