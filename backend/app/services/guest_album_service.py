"""Guest (no-login) album ownership.

A visitor can create an album without an account. The album is stored with a
null owner and bound to a one-time **guest session token**: the raw token is
returned once to the browser, only its SHA-256 hash is stored. Every guest
access is authorized by re-hashing that token and matching an *active,
unexpired* session for the requested album — the check is always server-side.

At login the album is transferred to the account via the race-safe
``claim_guest_album_ownership`` RPC (see
``supabase/migrations/20260726100000_secure_guest_claim_and_assets.sql``).

Not to be confused with share-link *contributors* (guest_id / album_contributors),
who add to someone else's already-owned album — a guest-album owner owns the album.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import HTTPException
from supabase import Client

from app.services.share_service import create_token, hash_token


def create_guest_session(client: Client, album_id: str) -> str:
    """Bind a freshly created album to a new guest token; return the raw token."""
    token = create_token()
    client.table("guest_album_sessions").insert(
        {"album_id": album_id, "token_hash": hash_token(token)}
    ).execute()
    return token


def _active_session_for_token(client: Client, token: str) -> dict[str, Any] | None:
    if not token:
        return None
    result = (
        client.table("guest_album_sessions")
        .select("*")
        .eq("token_hash", hash_token(token))
        .limit(1)
        .execute()
    )
    rows = result.data or []
    if not rows:
        return None
    session = rows[0]
    if session.get("status") != "active":
        return None
    expires_at = session.get("expires_at")
    if expires_at:
        try:
            expired = datetime.fromisoformat(str(expires_at).replace("Z", "+00:00")) <= datetime.now(timezone.utc)
        except (TypeError, ValueError):
            return None
        if expired:
            return None
    return session


def guest_session_matches(client: Client, album_id: str, token: str | None) -> bool:
    """True only if the token owns an active, unexpired session for this album."""
    if not token:
        return False
    session = _active_session_for_token(client, token)
    return bool(session and str(session.get("album_id")) == str(album_id))


def get_guest_session(client: Client, token: str | None) -> dict[str, Any] | None:
    """Raw session row for a token, any status (used to decide claim eligibility)."""
    if not token:
        return None
    result = (
        client.table("guest_album_sessions")
        .select("*")
        .eq("token_hash", hash_token(token))
        .limit(1)
        .execute()
    )
    rows = result.data or []
    return rows[0] if rows else None


def extend_guest_session(client: Client, token: str, *, days: int) -> None:
    """Push a pending guest session's expiry out (and keep it active) so a user who
    was refused a claim (e.g. over the album limit) can come back and save it later.
    We never delete the album to enforce a limit — the data is preserved."""
    if not token:
        return
    new_expiry = (datetime.now(timezone.utc) + timedelta(days=days)).isoformat()
    client.table("guest_album_sessions").update(
        {"expires_at": new_expiry, "status": "active"}
    ).eq("token_hash", hash_token(token)).execute()


# Error text raised by the claim RPC, mapped to caller-facing HTTP status.
_CLAIM_ERROR_STATUS: tuple[tuple[str, int], ...] = (
    ("expired", 410),
    ("already claimed by another user", 403),
    ("not found", 404),
)


def claim_guest_album(client: Client, token: str, profile_id: str, family_id: str) -> str:
    """Transfer a guest album to an account. Idempotent for the same owner."""
    if not token:
        raise HTTPException(status_code=400, detail="보관할 임시 앨범 정보를 찾을 수 없어요.")
    try:
        result = client.rpc(
            "claim_guest_album_ownership",
            {"p_token_hash": hash_token(token), "p_profile_id": profile_id, "p_family_id": family_id},
        ).execute()
    except Exception as exc:  # postgrest APIError etc. — map the RPC's RAISE messages.
        message = str(getattr(exc, "message", "") or getattr(exc, "details", "") or exc).lower()
        for needle, code in _CLAIM_ERROR_STATUS:
            if needle in message:
                raise HTTPException(status_code=code, detail=_claim_message(code)) from exc
        raise HTTPException(status_code=409, detail="임시 앨범을 보관하지 못했어요. 잠시 후 다시 시도해주세요.") from exc
    album_id = result.data
    if isinstance(album_id, list):
        album_id = album_id[0] if album_id else None
    if not album_id:
        raise HTTPException(status_code=404, detail="임시 앨범을 찾을 수 없어요.")
    return str(album_id)


def _claim_message(code: int) -> str:
    if code == 410:
        return "임시 앨범 보관 기간이 지났어요. 새로 만들어주세요."
    if code == 403:
        return "이미 다른 계정으로 보관된 앨범이에요."
    return "임시 앨범을 찾을 수 없어요."
