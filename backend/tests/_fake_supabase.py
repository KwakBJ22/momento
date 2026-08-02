"""A small *stateful* in-memory stand-in for the Supabase client.

Unlike ``MagicMock`` (which returns scripted data and so lets structural bugs
pass), this fake actually stores rows and runs the same select/insert/update/
delete/upsert/rpc a service function issues. Tests build a real flow — create,
call, read back — and assert on the resulting state. It grew out of the inline
fake proven in ``test_invite_flow.py`` and is shared so every core-flow test
exercises the same real query semantics.

Only the query surface the app actually uses is implemented; anything missing
should be added here (once) rather than re-mocked per test.
"""
from __future__ import annotations

from types import SimpleNamespace
from typing import Any, Callable

# Child tables removed together with an album by the delete_album_cascade RPC.
_ALBUM_CHILD_TABLES = (
    "album_photos",
    "album_media",
    "album_members",
    "album_contributors",
    "album_invites",
    "album_story_inputs",
    "share_links",
    "share_reactions",
    "album_guestbook_entries",
    "photo_memories",
)


class _Query:
    def __init__(self, client: "FakeSupabase", name: str, table: list[dict]):
        self._client = client
        self._name = name
        self._t = table
        self._filters: list[tuple[str, str, Any]] = []
        self._op = "select"
        self._payload: Any = None
        self._on_conflict: str | None = None
        self._limit: int | None = None
        self._order: tuple[str, bool] | None = None
        self._count = False

    # --- op selectors -------------------------------------------------
    def select(self, *_a, count: str | None = None, **_k):
        self._op = "select"
        self._count = count is not None
        return self

    def insert(self, payload):
        self._op = "insert"
        self._payload = payload
        return self

    def update(self, patch):
        self._op = "update"
        self._payload = patch
        return self

    def upsert(self, row, on_conflict: str | None = None, **_k):
        self._op = "upsert"
        self._payload = row
        self._on_conflict = on_conflict
        return self

    def delete(self):
        self._op = "delete"
        return self

    # --- filters ------------------------------------------------------
    def eq(self, col, val):
        self._filters.append(("eq", col, val))
        return self

    def is_(self, col, val):
        self._filters.append(("eq", col, None if val == "null" else val))
        return self

    def in_(self, col, values):
        self._filters.append(("in", col, list(values)))
        return self

    def or_(self, expr: str):
        # "created_by.eq.X,owner_id.eq.Y" -> match any alternative (eq only).
        alts: list[tuple[str, Any]] = []
        for term in expr.split(","):
            parts = term.split(".", 2)
            if len(parts) == 3 and parts[1] == "eq":
                alts.append((parts[0], parts[2]))
        self._filters.append(("or", "", alts))
        return self

    def limit(self, n):
        self._limit = n
        return self

    def order(self, col, desc: bool = False, **_k):
        self._order = (col, desc)
        return self

    # --- execution ----------------------------------------------------
    def _match(self, row: dict) -> bool:
        for op, col, val in self._filters:
            if op == "eq":
                if row.get(col) != val:
                    return False
            elif op == "in":
                if row.get(col) not in val:
                    return False
            elif op == "or":
                if not any(row.get(c) == v for c, v in val):
                    return False
        return True

    def _insert_row(self, row: dict) -> dict:
        stored = dict(row)
        stored.setdefault("id", f"{self._name}-{self._client._next_id()}")
        self._t.append(stored)
        return dict(stored)

    def execute(self):
        if self._op == "insert":
            payload = self._payload
            if isinstance(payload, list):
                inserted = [self._insert_row(r) for r in payload]
            else:
                inserted = [self._insert_row(payload)]
            return SimpleNamespace(data=inserted, count=len(inserted))

        if self._op == "upsert":
            conflict = [c.strip() for c in (self._on_conflict or "").split(",") if c.strip()]
            existing = None
            if conflict:
                for r in self._t:
                    if all(r.get(c) == self._payload.get(c) for c in conflict):
                        existing = r
                        break
            if existing is not None:
                existing.update(self._payload)
                return SimpleNamespace(data=[dict(existing)], count=1)
            return SimpleNamespace(data=[self._insert_row(self._payload)], count=1)

        if self._op == "update":
            matched = [r for r in self._t if self._match(r)]
            for r in matched:
                r.update(self._payload)
            return SimpleNamespace(data=[dict(r) for r in matched], count=len(matched))

        if self._op == "delete":
            matched = [r for r in self._t if self._match(r)]
            self._t[:] = [r for r in self._t if r not in matched]
            return SimpleNamespace(data=[dict(r) for r in matched], count=len(matched))

        # select
        matched = [dict(r) for r in self._t if self._match(r)]
        total = len(matched)
        if self._order is not None:
            col, desc = self._order
            try:
                matched.sort(key=lambda r: (r.get(col) is None, r.get(col)))
            except TypeError:
                pass
            if desc:
                matched.reverse()
        if self._limit is not None:
            matched = matched[: self._limit]
        return SimpleNamespace(data=matched, count=total if self._count else None)


class _RpcCall:
    def __init__(self, client: "FakeSupabase", name: str, params: dict):
        self._client = client
        self._name = name
        self._params = params or {}

    def execute(self):
        handler = self._client.rpc_handlers.get(self._name)
        data = handler(self._params) if handler else self._client._default_rpc(self._name, self._params)
        return SimpleNamespace(data=data)


class FakeSupabase:
    """Dict-of-lists tables with real query semantics for the app's call surface."""

    def __init__(self, tables: dict[str, list[dict]] | None = None):
        self.tables: dict[str, list[dict]] = {k: [dict(r) for r in v] for k, v in (tables or {}).items()}
        self._id = 0
        self.deleted_auth_users: list[str] = []
        # Overridable per test; default handlers cover the destructive cascades.
        self.rpc_handlers: dict[str, Callable[[dict], Any]] = {
            "delete_album_cascade": self._rpc_delete_album_cascade,
            "delete_profile_cascade": self._rpc_delete_profile_cascade,
        }
        self.auth = SimpleNamespace(
            admin=SimpleNamespace(delete_user=lambda uid: self.deleted_auth_users.append(str(uid)))
        )

    def _next_id(self) -> int:
        self._id += 1
        return self._id

    def table(self, name: str) -> _Query:
        return _Query(self, name, self.tables.setdefault(name, []))

    def rpc(self, name: str, params: dict | None = None) -> _RpcCall:
        return _RpcCall(self, name, params or {})

    # --- default RPC emulation ---------------------------------------
    def _default_rpc(self, _name: str, _params: dict):
        return [True]

    def _rpc_delete_album_cascade(self, params: dict):
        album_id = str(params.get("p_album_id"))
        actor_id = str(params.get("p_actor_id"))
        albums = self.tables.get("albums", [])
        target = next((a for a in albums if str(a.get("id")) == album_id), None)
        if target is None:
            return [False]
        authorized = actor_id in {str(target.get("created_by") or ""), str(target.get("owner_id") or "")}
        if not authorized:
            return [False]
        albums[:] = [a for a in albums if str(a.get("id")) != album_id]
        for child in _ALBUM_CHILD_TABLES:
            rows = self.tables.get(child)
            if rows:
                rows[:] = [r for r in rows if str(r.get("album_id")) != album_id]
        return [True]

    def _rpc_delete_profile_cascade(self, params: dict):
        profile_id = str(params.get("p_profile_id"))
        profiles = self.tables.get("profiles", [])
        existed = any(str(p.get("id")) == profile_id for p in profiles)
        profiles[:] = [p for p in profiles if str(p.get("id")) != profile_id]
        # Membership rows go with the profile; contributions in other albums are
        # ON DELETE SET NULL, so the row survives with its author reference cleared.
        members = self.tables.get("album_members")
        if members:
            members[:] = [m for m in members if str(m.get("user_id")) != profile_id]
        for row in self.tables.get("album_contributors", []):
            if str(row.get("user_id")) == profile_id:
                row["user_id"] = None
        return [existed]
