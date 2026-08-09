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

#: 탈퇴한 사람의 이름 자리에 남기는 값 — **빈 값이다** (K-17 · SCREEN_SPEC §5 27차).
#:
#: ★ 예전에는 `탈퇴한 사용자` 라는 글자를 넣었다. 그런데 그 이름은 **남의 앨범**에
#:   남는다. 그 사람의 추억에 남의 탈퇴 사실이 박히는 것이고, 인쇄물에도 들어간다.
#:   비워 두면 `함께 만든 사람` 줄이 그 이름을 그냥 건너뛴다(빈 이름을 거른다).
#: ★ 컬럼이 NOT NULL 이라 NULL 이 아니라 빈 문자열이다.
WITHDRAWN_DISPLAY_NAME = ""


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


def count_withdrawal_impact(client: Client, user_id: str) -> dict[str, int]:
    """탈퇴하면 무엇이 얼마나 사라지는지 **세는 한 곳** (K-17 · SCREEN_SPEC §5 27차).

    화면은 이 숫자를 그대로 보여주기만 한다. **프런트가 보내는 숫자를 믿지 않는다**(§10) —
    지우는 쪽도 여기와 같은 `list_all_owned_album_ids` 를 쓰므로, 보여준 수와 실제로
    지워지는 것이 어긋나지 않는다.

    셋을 센다:
      owned_albums   내가 만든 앨범        → 앨범·사진·파일까지 전부 지운다
      owned_photos   그 앨범들의 사진
      other_photos   남의 앨범에 내가 올린 사진 → **그대로 두고 이름만 지운다**

    ★ 화면마다 따로 세지 않는다(§1). 세는 식이 둘이면 언젠가 다른 값을 말한다.
    """
    owned_ids = list_all_owned_album_ids(client, user_id)
    owned_photos = 0
    if owned_ids:
        rows = (
            client.table("album_photos")
            .select("id")
            .in_("album_id", owned_ids)
            .execute()
            .data
            or []
        )
        owned_photos = len(rows)
    # 남의 앨범에 남긴 것 — 내가 올렸지만 내 앨범이 아닌 사진.
    mine = (
        client.table("album_photos")
        .select("id,album_id")
        .eq("contributor_profile_id", user_id)
        .execute()
        .data
        or []
    )
    owned = set(owned_ids)
    other_photos = sum(1 for row in mine if str(row.get("album_id") or "") not in owned)
    return {
        "owned_albums": len(owned_ids),
        "owned_photos": owned_photos,
        "other_album_photos": other_photos,
    }


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
    dropping the profile would not remove them. 이것을 안 지우면 화면에서 한
    **"이름만 지워져요" 가 거짓말이 된다**(K-17).
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
