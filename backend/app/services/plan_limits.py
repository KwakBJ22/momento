"""Per-user plan limits — the single place that decides a user's caps.

Today every user gets the free-tier limits from settings. When paid plans arrive,
branch here and nowhere else: no other module should read the limit values or
recompute the owned-album count directly.
"""
from __future__ import annotations

from supabase import Client

from app.config import get_settings


def get_user_limits(user_id: str) -> dict[str, int]:
    """The album/photo caps for a user. (user_id is accepted so future paid tiers
    can vary limits per user without changing any call site.)"""
    settings = get_settings()
    return {"max_albums": settings.max_albums_per_user, "max_photos": settings.max_photos}


def count_owned_albums(client: Client, user_id: str) -> int:
    """Count only LIVE albums the user owns, so the cap never counts deleted ones.

    Soft-deleted albums (``deleted_at`` set) are excluded here; hard-deleted ones
    are already gone. This deliberately does NOT reuse
    ``account_service.list_all_owned_album_ids`` — that one INCLUDES deleted albums
    on purpose (withdrawal must clean them up), which is the opposite of what a
    creation limit needs.
    """
    result = (
        client.table("albums")
        .select("id", count="exact")
        .or_(f"created_by.eq.{user_id},owner_id.eq.{user_id}")
        .is_("deleted_at", "null")
        .execute()
    )
    return int(result.count or len(result.data or []))
