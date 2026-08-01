from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import HTTPException
from supabase import Client

from app.services.analytics_service import insert_analytics_event


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


def get_active_share(client: Client, token: str) -> dict[str, Any]:
    share = _active_share(client, token)
    if not share:
        raise HTTPException(status_code=404, detail="공유 링크를 찾을 수 없거나 만료되었습니다.")
    return share


def create_share_link(
    client: Client,
    album_id: str,
    profile_id: str | None,
    expires_at: datetime | None,
) -> tuple[dict[str, Any], str]:
    token = create_token()
    # `kind` is intentionally left to the DB default ('contribute') so link creation
    # keeps working whether or not the kind migration has been applied yet. View-link
    # creation is added with the 감상-링크 UX (reactions/guestbook step).
    record = {
        "album_id": album_id,
        "token_hash": hash_token(token),
        "created_by": profile_id,
        "expires_at": expires_at.isoformat() if expires_at else None,
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


def log_event(client: Client, event_name: str, *, album_id: str | None = None, share_link_id: str | None = None, metadata: dict[str, Any] | None = None) -> bool:
    return insert_analytics_event(
        client,
        event_name,
        album_id=album_id,
        share_link_id=share_link_id,
        metadata=metadata,
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


def album_visitor_count(client: Client, album_id: str) -> int:
    """Sum view_count over every share link of an album (active or not), so a
    re-issued link never splits the "누가 다녀갔다" count."""
    result = client.table("share_links").select("view_count").eq("album_id", album_id).execute()
    return sum(int(row.get("view_count") or 0) for row in (result.data or []))


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
        raise HTTPException(status_code=404, detail="방명록 글을 찾지 못했어요.")
    entry = rows[0]
    if len(session_key) < 16 or str(entry.get("session_hash") or "") != hash_token(session_key):
        raise HTTPException(status_code=403, detail="본인이 남긴 글만 지울 수 있어요.")
    if entry.get("deleted_at"):
        return
    client.table("album_guestbook_entries").update(
        {"deleted_at": datetime.now(timezone.utc).isoformat()}
    ).eq("id", entry_id).execute()
