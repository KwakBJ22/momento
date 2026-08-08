"""담아둔 앨범 (SCREEN_SPEC §1 9차) — 구경하다가 계정에 담아 둔 목록.

★ 담아둬도 **권한은 바뀌지 않는다.** 여전히 보기만 한다 — 목록에 남을 뿐이다.
  그래서 여기서는 album_contributors 를 건드리지 않는다. 그 표에 행을 만드는 것은
  "참여자가 됐다" 는 뜻이고, 참여는 언제나 사용자가 이름을 적고 시작한다(§1, D-3).

★ 같은 앨범이 두 칸에 뜨지 않는다. 내가 만든 앨범·함께 만드는 앨범은 이미 목록에
  있으므로, 담아둔 목록에서는 그 둘을 뺀다. 담아둔 뒤에 참여자가 되어도 자동으로
  `함께 만드는 앨범` 쪽으로 옮겨간다(행을 지우지 않고 목록에서 빼는 방식이라,
  참여를 그만두면 다시 담아둔 목록에 나타난다).
"""

from __future__ import annotations

from typing import Any

from postgrest.exceptions import APIError
from supabase import Client

_TABLE = "album_bookmarks"


def add_bookmark(client: Client, user_id: str, album_id: str) -> None:
    """담아둔다. 이미 담아 뒀으면 아무 일도 없다(켜고 끄는 것이지 쌓이는 것이 아니다)."""
    try:
        client.table(_TABLE).insert({"user_id": user_id, "album_id": album_id}).execute()
    except APIError as exc:
        # 유일 제약(user_id, album_id) 위반 = 이미 담아 둔 것. 성공으로 본다.
        if str(getattr(exc, "code", "")) != "23505":
            raise


def remove_bookmark(client: Client, user_id: str, album_id: str) -> None:
    """담아둔 것을 뺀다. 없으면 아무 일도 없다."""
    client.table(_TABLE).delete().eq("user_id", user_id).eq("album_id", album_id).execute()


def is_bookmarked(client: Client, user_id: str, album_id: str) -> bool:
    rows = (
        client.table(_TABLE)
        .select("id")
        .eq("user_id", user_id)
        .eq("album_id", album_id)
        .limit(1)
        .execute()
        .data
        or []
    )
    return bool(rows)


def list_bookmarked_album_ids(client: Client, user_id: str, exclude_ids: set[str]) -> list[str]:
    """담아둔 앨범 id — 이미 다른 칸에 있는 것(내가 만든·함께 만드는)은 뺀다.

    ★ 이 뺄셈이 "같은 앨범이 두 칸에 뜨지 않는다" 를 지키는 자리다.
    """
    rows = (
        client.table(_TABLE)
        .select("album_id, created_at")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .execute()
        .data
        or []
    )
    ordered: list[str] = []
    for row in rows:
        album_id = str(row.get("album_id") or "")
        if album_id and album_id not in exclude_ids and album_id not in ordered:
            ordered.append(album_id)
    return ordered


def bookmarked_album_records(
    client: Client, album_ids: list[str], *, limit: int = 20
) -> list[dict[str, Any]]:
    """담아둔 앨범의 목록용 레코드. 지워진 앨범은 빠진다."""
    if not album_ids:
        return []
    columns = (
        "id, title, created_at, updated_at, result_path, cover_photo_id, album_version, "
        "living_latest_edition_previous, status"
    )
    rows = (
        client.table("albums")
        .select(columns)
        .in_("id", album_ids[:limit])
        .is_("deleted_at", "null")
        .execute()
        .data
        or []
    )
    # 담아둔 순서(최근 담아둔 것이 위)를 지킨다.
    order = {album_id: index for index, album_id in enumerate(album_ids)}
    return sorted(rows, key=lambda row: order.get(str(row.get("id")), len(order)))
