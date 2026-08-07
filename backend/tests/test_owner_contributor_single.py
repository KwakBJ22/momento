"""소유자 행은 앨범당 하나 (SCREEN_SPEC §1).

owner_id 와 created_by 가 어긋난 앨범에서 owner 행이 둘 생겼다(f9572069). 호출부 3곳이
서로 다른 것을 소유자로 넘긴 것이 원인이다 — 역할 판정을 함수 안으로 들여왔다.
"""

from typing import Any

from app.services.collaboration_service import ensure_owner_contributor

OWNER = "11111111-1111-1111-1111-111111111111"
OTHER = "22222222-2222-2222-2222-222222222222"
ALBUM = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"


class _Query:
    def __init__(self, table: "_Fake", name: str) -> None:
        self.table_ref, self.name, self.filters = table, name, {}

    def select(self, *_args, **_kwargs):
        return self

    def eq(self, column: str, value: Any):
        self.filters[column] = value
        return self

    def limit(self, _n: int):
        return self

    def insert(self, row: dict[str, Any]):
        self.table_ref.rows.setdefault(self.name, []).append(row)
        self._inserted = row
        return self

    def execute(self):
        if getattr(self, "_inserted", None) is not None:
            return type("R", (), {"data": [self._inserted]})()
        rows = [
            row for row in self.table_ref.rows.get(self.name, [])
            if all(str(row.get(key)) == str(value) for key, value in self.filters.items())
        ]
        return type("R", (), {"data": rows})()


class _Fake:
    def __init__(self, albums: list[dict[str, Any]], contributors: list[dict[str, Any]] | None = None) -> None:
        self.rows = {"albums": albums, "album_contributors": contributors or [], "profiles": []}

    def table(self, name: str):
        return _Query(self, name)


def test_album_owner_gets_the_owner_row() -> None:
    client = _Fake([{"id": ALBUM, "owner_id": OWNER, "created_by": OTHER}])
    row = ensure_owner_contributor(client, {"id": ALBUM}, OWNER)
    assert row["role"] == "owner"


def test_someone_else_never_becomes_a_second_owner() -> None:
    """★ 핵심: created_by 인 사람이 업로드해도 owner 행이 하나 더 생기지 않는다."""
    client = _Fake([{"id": ALBUM, "owner_id": OWNER, "created_by": OTHER}])
    row = ensure_owner_contributor(client, {"id": ALBUM}, OTHER)
    assert row["role"] == "contributor"
    owner_rows = [r for r in client.rows["album_contributors"] if r["role"] == "owner"]
    assert owner_rows == []


def test_guest_album_without_owner_treats_the_caller_as_owner() -> None:
    """claim 전 게스트 앨범은 소유자 프로필이 아직 없다 — 그 경우만 호출자를 소유자로 본다."""
    client = _Fake([{"id": ALBUM, "owner_id": None, "created_by": None}])
    row = ensure_owner_contributor(client, {"id": ALBUM}, OTHER)
    assert row["role"] == "owner"


def test_existing_row_is_reused_not_duplicated() -> None:
    existing = {"id": "row-1", "album_id": ALBUM, "user_id": OWNER, "role": "owner", "status": "active"}
    client = _Fake([{"id": ALBUM, "owner_id": OWNER}], [existing])
    row = ensure_owner_contributor(client, {"id": ALBUM}, OWNER)
    assert row is existing
    assert len(client.rows["album_contributors"]) == 1
