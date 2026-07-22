from __future__ import annotations

from datetime import datetime, timezone

from fastapi import HTTPException
from supabase import Client

from app.services.share_service import create_token, get_active_share, hash_token


def create_guest_session(client: Client, album_id: str) -> str:
    token = create_token()
    client.table("guest_album_sessions").insert({"album_id": album_id, "token_hash": hash_token(token)}).execute()
    return token


def _validate_guest_session(session: dict, profile_id: str) -> tuple[str, bool]:
    album_id = str(session.get("album_id") or "").strip()
    if not album_id:
        raise HTTPException(status_code=409, detail="Guest album session is missing its album id.")
    if session.get("status") == "claimed":
        if str(session.get("claimed_profile_id") or "") == profile_id:
            return album_id, True
        raise HTTPException(status_code=403, detail="This guest album is already claimed by another user.")
    if session.get("status") != "active":
        raise HTTPException(status_code=404, detail="Active guest album session was not found.")
    expires_at = session.get("expires_at")
    if not expires_at:
        raise HTTPException(status_code=409, detail="Guest album session is missing its expiration time.")
    try:
        expired = datetime.fromisoformat(str(expires_at).replace("Z", "+00:00")) <= datetime.now(timezone.utc)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=409, detail="Guest album session has an invalid expiration time.") from exc
    if expired:
        return album_id, False
    return album_id, False


def _claim_session(client: Client, session: dict, profile_id: str, family_id: str) -> str:
    album_id, already_claimed = _validate_guest_session(session, profile_id)
    if already_claimed:
        return album_id
    expires_at = datetime.fromisoformat(str(session["expires_at"]).replace("Z", "+00:00"))
    if expires_at <= datetime.now(timezone.utc):
        client.table("guest_album_sessions").update({"status": "expired"}).eq("id", session["id"]).execute()
        raise HTTPException(status_code=410, detail="Guest album claim period has expired.")
    session_id = session.get("id")
    if not session_id:
        raise HTTPException(status_code=409, detail="Guest album session is missing its session id.")
    client.table("albums").update({"owner_id": profile_id, "created_by": profile_id, "family_id": family_id}).eq("id", album_id).execute()
    client.table("guest_album_sessions").update(
        {"status": "claimed", "claimed_profile_id": profile_id, "claimed_at": datetime.now(timezone.utc).isoformat()}
    ).eq("id", session_id).execute()
    return album_id


def claim_guest_album(client: Client, token: str, profile_id: str, family_id: str) -> str:
    """Attach a guest album once; repeat calls by the same owner are successful."""
    result = client.table("guest_album_sessions").select("*").eq("token_hash", hash_token(token)).limit(1).execute()
    rows = result.data or []
    if not rows:
        raise HTTPException(status_code=404, detail="Guest album session was not found.")
    return _claim_session(client, rows[0], profile_id, family_id)


def claim_guest_album_by_id(client: Client, album_id: str, profile_id: str, family_id: str) -> str:
    """Recover a guest claim after Magic Link navigation lost local storage."""
    result = client.table("guest_album_sessions").select("*").eq("album_id", album_id).limit(1).execute()
    rows = result.data or []
    if not rows:
        raise HTTPException(status_code=404, detail="Guest album recovery information was not found.")
    claimed_album_id = _claim_session(client, rows[0], profile_id, family_id)
    if claimed_album_id != album_id:
        raise HTTPException(status_code=409, detail="Guest album session does not match the requested album.")
    return claimed_album_id


def claim_guest_album_by_share_token(client: Client, share_token: str, profile_id: str, family_id: str) -> str:
    share = get_active_share(client, share_token)
    album_id = str(share.get("album_id") or "").strip()
    if not album_id:
        raise HTTPException(status_code=409, detail="Share link is missing its album id.")
    return claim_guest_album_by_id(client, album_id, profile_id, family_id)
