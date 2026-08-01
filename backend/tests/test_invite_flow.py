"""Real behavior test (not source-regex): creating an invite must immediately be
usable, with collaboration_enabled + collaboration_status + is_active all set."""
from types import SimpleNamespace
from unittest import TestCase, mock

from app.services import collaboration_service as cs

ALBUM_ID = "11111111-1111-1111-1111-111111111111"
OWNER_ID = "22222222-2222-2222-2222-222222222222"


class _Query:
    def __init__(self, table):
        self._t = table
        self._filters: list[tuple[str, object]] = []
        self._op = "select"
        self._payload = None
        self._limit = None

    def select(self, *_a, **_k):
        self._op = "select"; return self

    def insert(self, row):
        self._op = "insert"; self._payload = row; return self

    def update(self, patch):
        self._op = "update"; self._payload = patch; return self

    def eq(self, col, val):
        self._filters.append((col, val)); return self

    def is_(self, col, val):
        self._filters.append((col, None if val == "null" else val)); return self

    def limit(self, n):
        self._limit = n; return self

    def order(self, *_a, **_k):
        return self

    def _match(self, row):
        return all(row.get(c) == v for c, v in self._filters)

    def execute(self):
        if self._op == "insert":
            row = dict(self._payload)
            row.setdefault("id", f"row-{len(self._t)}")
            self._t.append(row)
            return SimpleNamespace(data=[row])
        if self._op == "update":
            matched = [r for r in self._t if self._match(r)]
            for r in matched:
                r.update(self._payload)
            return SimpleNamespace(data=matched)
        matched = [r for r in self._t if self._match(r)]
        if self._limit:
            matched = matched[: self._limit]
        return SimpleNamespace(data=matched)


class _FakeClient:
    def __init__(self):
        self.tables: dict[str, list[dict]] = {}

    def table(self, name):
        return _Query(self.tables.setdefault(name, []))


class InviteFlowTests(TestCase):
    def _client(self, status="draft", enabled=False):
        client = _FakeClient()
        client.tables["albums"] = [{"id": ALBUM_ID, "collaboration_status": status, "collaboration_enabled": enabled}]
        client.tables["album_invites"] = []
        return client

    def test_creating_an_invite_turns_on_all_three_and_the_link_resolves(self) -> None:
        client = self._client()
        with mock.patch.object(cs, "ensure_owner_contributor"):
            invite_row, token = cs.start_collaboration(client, {"id": ALBUM_ID}, OWNER_ID)

        album = client.tables["albums"][0]
        invite = client.tables["album_invites"][0]
        # All three together — the exact regression: any one missing kills the link.
        self.assertTrue(album["collaboration_enabled"])
        self.assertEqual(album["collaboration_status"], "collecting")
        self.assertTrue(invite["is_active"])
        self.assertEqual(invite_row["is_active"], True)

        # Accessing the invite immediately after creation must succeed.
        record, resolved = cs.get_album_for_invite(client, token)
        self.assertEqual(record["id"], ALBUM_ID)
        self.assertEqual(resolved["token_hash"], invite["token_hash"])

    def test_re_inviting_a_closed_album_reopens_it(self) -> None:
        client = self._client(status="closed", enabled=False)
        client.tables["album_invites"] = [{"id": "old", "album_id": ALBUM_ID, "is_active": True, "token_hash": "old"}]
        with mock.patch.object(cs, "ensure_owner_contributor"):
            _row, token = cs.rotate_invite(client, {"id": ALBUM_ID}, OWNER_ID)

        album = client.tables["albums"][0]
        self.assertTrue(album["collaboration_enabled"])
        self.assertEqual(album["collaboration_status"], "collecting")
        # The stale invite is deactivated; the new one resolves.
        self.assertFalse(client.tables["album_invites"][0]["is_active"])
        record, _ = cs.get_album_for_invite(client, token)
        self.assertEqual(record["id"], ALBUM_ID)
