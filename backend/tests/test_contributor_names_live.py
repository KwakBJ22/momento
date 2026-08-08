"""사람 이름을 복사하지 않는다 (SCREEN_SPEC §1 · docs/DATA_CHECKS.md).

`album_contributors.display_name` 은 **참여하던 그때의 스냅샷**이라, profiles 를 고쳐도
따라오지 않는다. 프로덕션에 `kbjkwak`(이메일 앞부분)이 화면에 그대로 남아 있었다.

★ 계정이 있는 사람의 이름은 profiles 에서 읽는다.
★ 게스트만 예외 — profiles 가 없으니 저장된 값을 쓴다. 그래서 컬럼을 지우지 않는다.
★ 이름을 읽는 곳은 resolve_contributor_names 한 곳이다.
"""

from pathlib import Path
from types import SimpleNamespace
from unittest import TestCase

from app.services.collaboration_service import resolve_contributor_names

ROOT = Path(__file__).resolve().parents[1]


class _Profiles:
    def __init__(self, rows, calls):
        self._rows = rows
        self._calls = calls
        self._ids: list[str] = []

    def select(self, *_a, **_k):
        return self

    def in_(self, _column, values):
        self._ids = list(values)
        self._calls.append(list(values))
        return self

    def execute(self):
        return SimpleNamespace(data=[row for row in self._rows if row["id"] in self._ids])


class _Client:
    def __init__(self, profiles):
        self._profiles = profiles
        self.queries: list[list[str]] = []

    def table(self, name):
        assert name == "profiles"
        return _Profiles(self._profiles, self.queries)


PROFILES = [
    {"id": "u-1", "display_name": "곽병준"},
    {"id": "u-2", "display_name": "영희"},
]


class ContributorNameTests(TestCase):
    def test_account_holder_name_comes_from_profiles(self) -> None:
        rows = [{"id": "c-1", "user_id": "u-1", "display_name": "kbjkwak"}]
        self.assertEqual(resolve_contributor_names(_Client(PROFILES), rows)[0]["display_name"], "곽병준")

    def test_guest_keeps_the_stored_name(self) -> None:
        # 게스트는 profiles 가 없다 — 저장된 값이 유일한 근거다.
        rows = [{"id": "c-2", "user_id": None, "display_name": "준3"}]
        self.assertEqual(resolve_contributor_names(_Client(PROFILES), rows)[0]["display_name"], "준3")

    def test_account_without_a_profile_name_falls_back(self) -> None:
        rows = [{"id": "c-3", "user_id": "u-unknown", "display_name": "예전 이름"}]
        self.assertEqual(resolve_contributor_names(_Client(PROFILES), rows)[0]["display_name"], "예전 이름")

    def test_other_fields_are_untouched(self) -> None:
        rows = [{"id": "c-1", "user_id": "u-1", "display_name": "kbjkwak", "role": "owner", "status": "active"}]
        resolved = resolve_contributor_names(_Client(PROFILES), rows)[0]
        self.assertEqual(resolved["role"], "owner")
        self.assertEqual(resolved["status"], "active")

    def test_profiles_is_read_once_for_everyone(self) -> None:
        client = _Client(PROFILES)
        rows = [
            {"id": "c-1", "user_id": "u-1", "display_name": "old"},
            {"id": "c-2", "user_id": "u-2", "display_name": "old"},
            {"id": "c-3", "user_id": "u-1", "display_name": "old"},
            {"id": "c-4", "user_id": None, "display_name": "게스트"},
        ]
        names = [row["display_name"] for row in resolve_contributor_names(client, rows)]
        self.assertEqual(names, ["곽병준", "영희", "곽병준", "게스트"])
        # 사람 수만큼 부르지 않는다 — 한 번에 읽는다.
        self.assertEqual(len(client.queries), 1)
        self.assertEqual(client.queries[0], ["u-1", "u-2"])

    def test_nobody_means_no_query(self) -> None:
        client = _Client(PROFILES)
        self.assertEqual(resolve_contributor_names(client, []), [])
        self.assertEqual(client.queries, [])


class SingleSourceTests(TestCase):
    """이름을 읽는 곳이 하나인지 — 저장된 스냅샷을 직접 쓰는 자리가 남아 있으면 안 된다."""

    def test_every_screen_goes_through_the_resolver(self) -> None:
        service = (ROOT / "app/services/collaboration_service.py").read_text(encoding="utf-8")
        # `함께한 사람` 목록·수와 `함께 만든 사람` 줄이 같은 함수를 지난다.
        listing = service[service.index("def list_contributors") : service.index("def remove_contributor")]
        self.assertIn("resolve_contributor_names(client, result.data or [])", listing)
        names = service[service.index("def list_active_contributor_names") : service.index("def count_ready_photos")]
        self.assertIn("resolve_contributor_names(", names)
        # 참여 정체성 띠(§8)도 마찬가지다.
        album = (ROOT / "app/api/album.py").read_text(encoding="utf-8")
        self.assertIn("contributor_rows = resolve_contributor_names(", album)

    def test_the_column_is_not_dropped(self) -> None:
        # 게스트에게 필요하다 — 지우지 않는다.
        service = (ROOT / "app/services/collaboration_service.py").read_text(encoding="utf-8")
        self.assertIn('"display_name": name', service)
