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


def add_reaction(client: Client, share_id: str, reaction: str, session_key: str) -> None:
    if reaction not in {"remember", "warm", "smile"} or len(session_key) < 16:
        raise HTTPException(status_code=400, detail="유효하지 않은 반응입니다.")
    client.table("share_reactions").upsert({"share_link_id": share_id, "reaction": reaction, "session_hash": hash_token(session_key)}, on_conflict="share_link_id,session_hash,reaction").execute()
