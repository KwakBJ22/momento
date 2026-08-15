from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import HTTPException

from app.services.link_trouble import classify_share_trouble, link_trouble_message
from supabase import Client

from app.services.analytics_service import insert_analytics_event
from app.services.visitor_key import count_album_visitors


def hash_token(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def create_token() -> str:
    return secrets.token_urlsafe(32)


def _active_share(client: Client, token: str) -> dict[str, Any] | None:
    result = client.table("share_links").select("*").eq("token_hash", hash_token(token)).limit(1).execute()
    rows = result.data or []
    if not rows:
        return None
    share = rows[0]
    if share.get("status") != "active":
        return None
    expires_at = share.get("expires_at")
    if expires_at and datetime.fromisoformat(str(expires_at).replace("Z", "+00:00")) <= datetime.now(timezone.utc):
        client.table("share_links").update({"status": "expired"}).eq("id", share["id"]).execute()
        return None
    return share


def find_share_by_token(client: Client, token: str) -> dict[str, Any] | None:
    """토큰으로 공유 링크 행을 찾는다 — **거르지 않고** 있는 그대로 (J-9).

    걸러서 가져오면 *없는 것*과 *꺼진 것*이 같아져 왜 안 열리는지 가를 수 없다.
    """
    result = client.table("share_links").select("*").eq("token_hash", hash_token(token)).limit(1).execute()
    rows = result.data or []
    return rows[0] if rows else None


def get_active_share(client: Client, token: str) -> dict[str, Any]:
    """구경용 링크를 연다. 못 열면 **왜 못 여는지** 사용자 말로 알린다(J-9)."""
    share = find_share_by_token(client, token)
    trouble = classify_share_trouble(share)
    if trouble or share is None:
        # 기간이 지난 링크는 그 사실을 행에도 적어 둔다(예전 동작 그대로).
        if share and trouble == "expired" and share.get("status") == "active":
            client.table("share_links").update({"status": "expired"}).eq("id", share["id"]).execute()
        raise HTTPException(status_code=404, detail=link_trouble_message(trouble or "gone", "share"))
    return share


def _is_expired(value: Any) -> bool:
    if not value:
        return False
    return datetime.fromisoformat(str(value).replace("Z", "+00:00")) <= datetime.now(timezone.utc)



# 공유 링크 종류(SCREEN_SPEC §1 "링크 두 종류"). DB 기본값은 'contribute' 이고,
# 이미 발급된 링크는 그대로 둔다 — 종류를 나중에 바꾸면 그 링크를 이미 받은 사람의
# 권한이 말없이 달라진다.
SHARE_KIND_VIEW = "view"
SHARE_KIND_CONTRIBUTE = "contribute"


def contribution_block_reason(share: dict[str, Any], album: dict[str, Any]) -> str | None:
    """참여를 막아야 하는 이유. 없으면 None(참여 가능).

    ★ 참여 시작 API 와 공유 조회 응답의 능력 플래그가 **이 함수 하나**를 쓴다.
    같은 사실을 두 군데서 따로 계산하면 반드시 갈라진다(SCREEN_SPEC §1).
    """
    if str(share.get("kind") or SHARE_KIND_CONTRIBUTE) == SHARE_KIND_VIEW:
        return "이 링크는 감상용이에요. 사진과 한마디는 함께 만들기 초대 링크에서 남길 수 있어요."
    return album_contribution_block_reason(album)


def album_contribution_block_reason(album: dict[str, Any]) -> str | None:
    """앨범 자체가 더 받지 않는 이유. 없으면 None.

    ★ 링크 경로와 로그인 경로가 **이 함수 하나**를 쓴다. 예전에는 링크 경로만
    ``collaboration_status`` 를 봤고, 로그인 참여자(``/album/{id}``)는 버튼이 그대로
    남아 누르면 403 이었다 — 같은 사실을 두 곳에서 따로 계산한 결과다(J-8 · §1).

    ★ 버튼만 사라지면 고장으로 보인다. **왜 그런지 한 줄**을 함께 내려보낸다(§11).
    """
    if album.get("collaboration_status") == "closed":
        return "이 앨범은 사진을 다 모았어요. 한마디는 지금도 남길 수 있어요."
    return None


def create_share_link(
    client: Client,
    album_id: str,
    profile_id: str | None,
    expires_at: datetime | None,
    kind: str = SHARE_KIND_CONTRIBUTE,
) -> tuple[dict[str, Any], str]:
    token = create_token()
    # 종류는 발급할 때 정해지고 이후 바뀌지 않는다. "구경하라고 보내기"는 view 를,
    # "함께 만들자고 보내기"는 contribute 를 발급한다.
    record = {
        "album_id": album_id,
        "token_hash": hash_token(token),
        "created_by": profile_id,
        "expires_at": expires_at.isoformat() if expires_at else None,
        "kind": SHARE_KIND_VIEW if kind == SHARE_KIND_VIEW else SHARE_KIND_CONTRIBUTE,
    }
    result = client.table("share_links").insert(record).execute()
    return (result.data or [record])[0], token


def list_share_links(client: Client, album_id: str) -> list[dict[str, Any]]:
    result = client.table("share_links").select("id, status, expires_at, view_count, created_at, deactivated_at").eq("album_id", album_id).order("created_at", desc=True).execute()
    return result.data or []


def deactivate_share_link(client: Client, album_id: str, share_id: str) -> None:
    client.table("share_links").update({"status": "inactive", "deactivated_at": datetime.now(timezone.utc).isoformat()}).eq("id", share_id).eq("album_id", album_id).execute()


def increment_view(client: Client, share_id: str) -> None:
    client.rpc("increment_share_link_view", {"target_share_id": share_id}).execute()


def log_event(client: Client, event_name: str, *, album_id: str | None = None, share_link_id: str | None = None, metadata: dict[str, Any] | None = None, visitor_key: str | None = None) -> bool:
    return insert_analytics_event(
        client,
        event_name,
        album_id=album_id,
        share_link_id=share_link_id,
        metadata=metadata,
        visitor_key=visitor_key,
    )


REACTION_CODES = ("love", "moved", "smile")


def add_reaction(client: Client, album_id: str, share_id: str | None, reaction: str, session_key: str) -> None:
    if reaction not in REACTION_CODES or len(session_key) < 16:
        raise HTTPException(status_code=400, detail="유효하지 않은 반응입니다.")
    # Dedupe by album so a re-issued link never fragments the count. share_link_id
    # is kept only as an acquisition-path record.
    client.table("share_reactions").upsert(
        {"album_id": album_id, "share_link_id": share_id, "reaction": reaction, "session_hash": hash_token(session_key)},
        on_conflict="album_id,session_hash,reaction",
    ).execute()


def reaction_counts(client: Client, album_id: str) -> dict[str, int]:
    """Anonymous per-album totals for each reaction code."""
    counts = {code: 0 for code in REACTION_CODES}
    result = client.table("share_reactions").select("reaction").eq("album_id", album_id).execute()
    for row in result.data or []:
        code = str(row.get("reaction") or "")
        if code in counts:
            counts[code] += 1
    return counts


def album_visitor_count(client: Client, album_id: str, *, owner_id: str | None = None) -> int:
    """"지금까지 N명이 다녀갔어요" — **서로 다른 사람 수**(§1).

    ★ 예전에는 share_links.view_count 를 더했다. 그것은 사람 수가 아니라 **API 호출 수**였다
    (프로덕션 실측 165/139건, 실제 사람 2명). 세는 규칙은 visitor_key 한 곳에 있다.
    """
    return count_album_visitors(client, album_id, owner_id=owner_id)


GUESTBOOK_NAME_MAX = 40
GUESTBOOK_MESSAGE_MAX = 200


def add_guestbook_entry(
    client: Client, album_id: str, author_name: str, message: str, session_key: str,
    contributor_id: str | None = None,
) -> dict[str, Any]:
    name = (author_name or "").strip()
    text = (message or "").strip()
    if not (1 <= len(name) <= GUESTBOOK_NAME_MAX) or not (1 <= len(text) <= GUESTBOOK_MESSAGE_MAX) or len(session_key) < 16:
        raise HTTPException(status_code=400, detail="이름과 메시지를 확인해 주세요.")
    row: dict[str, Any] = {
        "album_id": album_id, "author_name": name, "message": text,
        "session_hash": hash_token(session_key),
    }
    if contributor_id:
        row["contributor_id"] = contributor_id
    result = client.table("album_guestbook_entries").insert(row).execute()
    return (result.data or [row])[0]


def list_guestbook_entries(client: Client, album_id: str) -> list[dict[str, Any]]:
    """Visible (not soft-deleted) entries, newest first. No session/identity leaks."""
    result = (
        client.table("album_guestbook_entries")
        .select("id, author_name, message, created_at")
        .eq("album_id", album_id)
        .is_("deleted_at", "null")
        .order("created_at", desc=True)
        .execute()
    )
    return result.data or []


def delete_own_guestbook_entry(client: Client, album_id: str, entry_id: str, session_key: str) -> None:
    """Soft-delete only if the caller's session hash matches the author's."""
    result = (
        client.table("album_guestbook_entries")
        .select("id, album_id, session_hash, deleted_at")
        .eq("id", entry_id)
        .limit(1)
        .execute()
    )
    rows = result.data or []
    if not rows or str(rows[0].get("album_id")) != str(album_id):
        raise HTTPException(status_code=404, detail="남긴 말을 찾지 못했어요.")
    entry = rows[0]
    if len(session_key) < 16 or str(entry.get("session_hash") or "") != hash_token(session_key):
        raise HTTPException(status_code=403, detail="본인이 남긴 글만 지울 수 있어요.")
    if entry.get("deleted_at"):
        return
    client.table("album_guestbook_entries").update(
        {"deleted_at": datetime.now(timezone.utc).isoformat()}
    ).eq("id", entry_id).execute()
