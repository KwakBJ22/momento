"""방문자는 **사람 단위**로 센다 (SCREEN_SPEC §1 · docs/DATA_CHECKS.md).

`지금까지 N명이 다녀갔어요` 가 사실은 **API 호출 수**였다. share_links.view_count 를
더했기 때문이다 — 프로덕션 실측으로 album_revisited 165건 / public_album_viewed 139건인데
실제 사람은 2명이었다.

★ 세는 규칙은 app/services/visitor_key.py 한 곳이다.
★ 개인정보를 새로 받지 않는다 — IP·User-Agent 를 쓰지 않고, 무작위 토큰의 해시만 쓴다.
"""

import re
from pathlib import Path
from types import SimpleNamespace
from unittest import TestCase

from app.services.share_service import album_visitor_count
from app.services.visitor_key import (
    MIN_TOKEN_LENGTH,
    VISIT_EVENT_NAMES,
    resolve_visitor_key,
    visitor_key_for_user,
)

ROOT = Path(__file__).resolve().parents[1]
TOKEN_A = "a" * MIN_TOKEN_LENGTH
TOKEN_B = "b" * MIN_TOKEN_LENGTH


class _Query:
    """analytics_events 조회 흉내 — 필터가 실제로 걸리는지도 함께 본다."""

    def __init__(self, rows, calls):
        self._rows = rows
        self._calls = calls
        self._only_with_key = False

    def select(self, *_a, **_k):
        return self

    def eq(self, column, value):
        self._calls.append(f"eq:{column}={value}")
        return self

    def in_(self, column, values):
        self._calls.append(f"in:{column}={sorted(values)}")
        return self

    @property
    def not_(self):
        self._only_with_key = True
        return self

    def is_(self, column, value):
        self._calls.append(f"not_is:{column}={value}")
        return self

    def execute(self):
        rows = self._rows
        if self._only_with_key:
            rows = [row for row in rows if row.get("visitor_key")]
        return SimpleNamespace(data=rows)


class _Client:
    def __init__(self, rows):
        self._rows = rows
        self.calls: list[str] = []

    def table(self, name):
        assert name == "analytics_events"
        return _Query(self._rows, self.calls)


OWNER = "owner-1"
OWNER_KEY = visitor_key_for_user(OWNER)


class VisitorKeyTests(TestCase):
    def test_logged_in_person_is_identified_by_account(self) -> None:
        self.assertEqual(resolve_visitor_key("user-1", None), visitor_key_for_user("user-1"))
        # 브라우저 토큰이 함께 와도 계정이 이긴다 — 판정이 한 가지여야 한 사람이 한 명이다.
        self.assertEqual(resolve_visitor_key("user-1", TOKEN_A), visitor_key_for_user("user-1"))

    def test_anonymous_person_is_identified_by_browser_token(self) -> None:
        self.assertEqual(resolve_visitor_key(None, TOKEN_A), resolve_visitor_key(None, TOKEN_A))
        self.assertNotEqual(resolve_visitor_key(None, TOKEN_A), resolve_visitor_key(None, TOKEN_B))

    def test_key_is_a_hash_not_the_value(self) -> None:
        key = resolve_visitor_key(None, TOKEN_A)
        self.assertIsNotNone(key)
        self.assertNotIn(TOKEN_A, key)
        self.assertEqual(len(key), 64)  # sha256 hex

    def test_without_a_usable_identifier_there_is_no_key(self) -> None:
        # 키가 없으면 그 행은 세지 않는다 — 사람을 구분할 수 없는 값을 세면 다시 호출 수가 된다.
        self.assertIsNone(resolve_visitor_key(None, None))
        self.assertIsNone(resolve_visitor_key(None, "짧음"))

    def test_no_personal_data_is_used(self) -> None:
        """IP·User-Agent 를 읽지 않는다 — 주석의 설명은 빼고 **코드만** 본다."""
        source = (ROOT / "app/services/visitor_key.py").read_text(encoding="utf-8")
        code = re.sub(r'"""[\s\S]*?"""', "", source)
        code = "".join(line for line in code.splitlines() if not line.strip().startswith("#"))
        for forbidden in ["User-Agent", "user_agent", "remote_addr", "client.host", "headers"]:
            self.assertNotIn(forbidden, code)


class VisitorCountTests(TestCase):
    def test_same_person_opening_many_times_counts_once(self) -> None:
        visitor = resolve_visitor_key(None, TOKEN_A)
        client = _Client([{"visitor_key": visitor} for _ in range(9)])
        self.assertEqual(album_visitor_count(client, "album-1", owner_id=OWNER), 1)

    def test_different_people_count_separately(self) -> None:
        client = _Client([
            {"visitor_key": resolve_visitor_key(None, TOKEN_A)},
            {"visitor_key": resolve_visitor_key(None, TOKEN_B)},
            {"visitor_key": visitor_key_for_user("guest-account")},
        ])
        self.assertEqual(album_visitor_count(client, "album-1", owner_id=OWNER), 3)

    def test_owner_visits_are_not_counted(self) -> None:
        client = _Client([
            {"visitor_key": OWNER_KEY},
            {"visitor_key": OWNER_KEY},
            {"visitor_key": resolve_visitor_key(None, TOKEN_A)},
        ])
        self.assertEqual(album_visitor_count(client, "album-1", owner_id=OWNER), 1)

    def test_old_events_without_a_key_are_not_counted(self) -> None:
        # 옛 165건은 지우지 않는다. 세지 않을 뿐이다 — 0부터 다시 시작한다.
        client = _Client([{"visitor_key": None}, {}, {"visitor_key": ""}])
        self.assertEqual(album_visitor_count(client, "album-1", owner_id=OWNER), 0)

    def test_only_visit_events_of_this_album_are_counted(self) -> None:
        client = _Client([{"visitor_key": resolve_visitor_key(None, TOKEN_A)}])
        album_visitor_count(client, "album-1", owner_id=OWNER)
        self.assertIn("eq:album_id=album-1", client.calls)
        self.assertIn(f"in:event_name={sorted(VISIT_EVENT_NAMES)}", client.calls)
        self.assertIn("not_is:visitor_key=null", client.calls)

    def test_nothing_recorded_means_zero(self) -> None:
        self.assertEqual(album_visitor_count(_Client([]), "album-1", owner_id=OWNER), 0)

    def test_view_count_is_no_longer_used(self) -> None:
        """호출 수를 더하던 옛 식이 코드에 남아 있지 않다(주석의 설명은 제외)."""
        source = (ROOT / "app/services/share_service.py").read_text(encoding="utf-8")
        body = source[source.index("def album_visitor_count") : source.index("GUESTBOOK_NAME_MAX")]
        code = re.sub(r'"""[\s\S]*?"""', "", body)
        self.assertNotIn("view_count", code)
