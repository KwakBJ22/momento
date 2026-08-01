"""Account withdrawal.

Withdrawal removes everything the user made and every trace of who they were,
while leaving other people's albums intact.

Order matters.  Albums go first because each one owns Storage objects whose
paths have to be read before its rows disappear, and because that is the part
worth retrying on its own.  The remaining name text is anonymized next, while
the rows can still be found by profile id.  Only then is the profile removed:
`delete_profile_cascade` drops the membership rows and every surviving
reference is ON DELETE SET NULL, so a memory left inside someone else's album
stays in that album without an author.  With the profile row gone,
`auth.users` can finally be hard deleted, which is what actually erases the
login identity and email address.
"""

from __future__ import annotations

import logging
from typing import Any

from supabase import Client

from app.config import Settings
from app.services.supabase import (
    cleanup_album_files,
    delete_album_cascade,
    get_album_media_asset_records,
    get_album_photo_asset_records,
    get_album_record,
)

logger = logging.getLogger(__name__)

WITHDRAWN_DISPLAY_NAME = "탈퇴한 사용자"


def list_all_owned_album_ids(client: Client, user_id: str) -> list[str]:
    """Every album this user owns, including ones already marked deleted.

    `albums.created_by` still references the profile with ON DELETE RESTRICT,
    so a soft-deleted album left behind would block withdrawal forever.
    """
    result = (
        client.table("albums")
        .select("id")
        .or_(f"created_by.eq.{user_id},owner_id.eq.{user_id}")
        .execute()
    )
    return [str(row["id"]) for row in (result.data or []) if row.get("id")]


def delete_owned_albums(client: Client, settings: Settings, user_id: str) -> int:
    """Delete every album this user owns, including its Storage objects.

    An album that disappears between the listing and the cascade is skipped
    rather than failing the whole withdrawal, so the request stays retryable.
    """
    deleted = 0
    for album_id in list_all_owned_album_ids(client, user_id):
        record = get_album_record(client, album_id)
        if not record:
            continue
        # Snapshot asset paths before the cascade removes the rows that hold
        # them, exactly as the single-album delete route does.
        photo_assets = get_album_photo_asset_records(client, album_id)
        media_assets = get_album_media_asset_records(client, album_id)
        if not delete_album_cascade(client, album_id, user_id):
            logger.warning("account_delete_album_skipped album_id=%s", album_id[:6])
            continue
        cleanup_album_files(
            client,
            settings,
            record,
            photo_rows=photo_assets,
            media_rows=media_assets,
            dry_run=False,
            remove_album_prefix=True,
        )
        deleted += 1
    return deleted


def anonymize_authored_names(client: Client, user_id: str) -> None:
    """Clear the name text stored alongside contributions to other albums.

    These columns hold a copy of the display name rather than a reference, so
    dropping the profile would not remove them.
    """
    (
        client.table("album_contributors")
        .update({"display_name": WITHDRAWN_DISPLAY_NAME, "relationship": None})
        .eq("user_id", user_id)
        .execute()
    )
    (
        client.table("photo_memories")
        .update({"author_name": WITHDRAWN_DISPLAY_NAME, "relationship": None})
        .eq("author_id", user_id)
        .execute()
    )


def delete_profile_cascade(client: Client, user_id: str) -> bool:
    """Remove the profile row and its membership rows in one transaction."""
    result = client.rpc("delete_profile_cascade", {"p_profile_id": user_id}).execute()
    data = result.data
    if isinstance(data, list):
        return bool(data[0]) if data else False
    return bool(data)


def delete_auth_user(client: Client, user_id: str) -> None:
    """Erase the login identity, including the email held by Supabase Auth."""
    client.auth.admin.delete_user(user_id)


def delete_account(client: Client, settings: Settings, user_id: str) -> dict[str, Any]:
    albums_deleted = delete_owned_albums(client, settings, user_id)
    anonymize_authored_names(client, user_id)
    if not delete_profile_cascade(client, user_id):
        raise RuntimeError("profile_delete_blocked")
    delete_auth_user(client, user_id)
    logger.info("account_deleted albums=%s", albums_deleted)
    return {"albums_deleted": albums_deleted}
