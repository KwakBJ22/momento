from __future__ import annotations

from datetime import datetime, timezone

from fastapi import HTTPException
from supabase import Client

from app.services.share_service import create_token, hash_token


def create_guest_session(client: Client, album_id: str) -> str:
    token = create_token()
    client.table("guest_album_sessions").insert({"album_id": album_id, "token_hash": hash_token(token)}).execute()
    return token


def claim_guest_album(client: Client, token: str, profile_id: str, family_id: str) -> str:
    result = client.table("guest_album_sessions").select("*").eq("token_hash", hash_token(token)).eq("status", "active").limit(1).execute()
    rows = result.data or []
    if not rows:
        raise HTTPException(status_code=404, detail="임시 앨범을 찾을 수 없습니다.")
    session = rows[0]
    if datetime.fromisoformat(str(session["expires_at"]).replace("Z", "+00:00")) <= datetime.now(timezone.utc):
        client.table("guest_album_sessions").update({"status": "expired"}).eq("id", session["id"]).execute()
        raise HTTPException(status_code=410, detail="임시 앨범 보관 시간이 지났습니다.")
    client.table("albums").update({"owner_id": profile_id, "created_by": profile_id, "family_id": family_id}).eq("id", session["album_id"]).execute()
    client.table("guest_album_sessions").update({"status": "claimed", "claimed_profile_id": profile_id, "claimed_at": datetime.now(timezone.utc).isoformat()}).eq("id", session["id"]).execute()
    return str(session["album_id"])
