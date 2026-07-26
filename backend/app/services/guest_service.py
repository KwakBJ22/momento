from __future__ import annotations

from fastapi import HTTPException
from supabase import Client

from app.services.share_service import create_token, hash_token


def create_guest_session(client: Client, album_id: str) -> str:
    token = create_token()
    client.table("guest_album_sessions").insert({"album_id": album_id, "token_hash": hash_token(token)}).execute()
    return token


def claim_guest_album(client: Client, token: str, profile_id: str, family_id: str) -> str:
    """Claim only with the non-public ownership secret issued at creation time.

    The RPC locks the session row and changes the album owner, membership, and
    session status together.  A public share token or album id is intentionally
    not a recovery credential.
    """
    if not token or not token.strip():
        raise HTTPException(status_code=400, detail="Guest album ownership token is required.")
    try:
        result = client.rpc(
            "claim_guest_album_ownership",
            {
                "p_token_hash": hash_token(token),
                "p_profile_id": profile_id,
                "p_family_id": family_id,
            },
        ).execute()
    except Exception as exc:
        message = str(exc)
        if "already claimed by another" in message:
            raise HTTPException(status_code=403, detail="This guest album is already claimed by another user.") from exc
        if "expired" in message:
            raise HTTPException(status_code=410, detail="Guest album claim period has expired.") from exc
        if "not found" in message or "invalid" in message:
            raise HTTPException(status_code=404, detail="Guest album session was not found.") from exc
        raise HTTPException(status_code=409, detail="Guest album could not be claimed safely.") from exc
    rows = result.data or []
    album_id = rows[0] if isinstance(rows, list) and rows else result.data
    if isinstance(album_id, dict):
        album_id = album_id.get("claim_guest_album_ownership")
    if not album_id:
        raise HTTPException(status_code=409, detail="Guest album could not be claimed safely.")
    return str(album_id)


def claim_guest_album_by_id(client: Client, album_id: str, profile_id: str, family_id: str) -> str:
    raise HTTPException(status_code=403, detail="Album id alone cannot claim a guest album.")


def claim_guest_album_by_share_token(client: Client, share_token: str, profile_id: str, family_id: str) -> str:
    raise HTTPException(status_code=403, detail="A public share token cannot claim a guest album.")
