"""Data hygiene for guest albums — abandoned-album deletion and orphan-object audit.

Two things accumulate over time and nobody cleans them up:
  (A) A guest album whose session expired and was never claimed has no owner, so no
      user-facing delete path ever removes it.
  (B) If a DB delete succeeds but the follow-up Storage delete fails, files are left
      behind with no album row pointing at them.

This module finds those, always dry-run first. It reuses the exact deletion order the
account-withdrawal path uses (snapshot asset paths -> DB cascade -> Storage cleanup),
except the cascade is delete_abandoned_guest_album (the actor-authorized
delete_album_cascade cannot remove an ownerless album). Deletion is DB-guarded a second
time, so an owned or claimed album can never be removed.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

from supabase import Client

from app.config import Settings
from app.services.storage_service import StorageService
from app.services.supabase import (
    cleanup_album_files,
    delete_abandoned_guest_album,
    get_album_media_asset_records,
    get_album_photo_asset_records,
    get_album_record,
)

logger = logging.getLogger(__name__)

# Default per-run deletion ceiling. A single run never removes more than this so a bug
# or a surprising query result cannot wipe many albums at once; override with --limit.
DEFAULT_DELETE_LIMIT = 100
# Extra grace after the LAST session of an album expired, before it is deletable. The
# claim flow can extend a session (e.g. after a refused over-limit claim); this makes
# sure a recently-extended-then-expired album still gets a full week of runway.
ABANDON_GRACE_DAYS = 7


@dataclass(frozen=True)
class GuestAlbumCandidate:
    album_id: str
    photo_count: int
    total_bytes: int
    last_expiry: str  # ISO 8601 of the album's latest session expiry


@dataclass(frozen=True)
class OrphanStoragePrefix:
    bucket: str
    album_id: str
    object_count: int


def _short(album_id: str) -> str:
    # Log convention: only the first 6 chars of an id; never captions or filenames.
    return str(album_id)[:6]


def _parse_dt(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def find_abandoned_guest_albums(
    client: Client,
    *,
    now: datetime,
    grace_days: int = ABANDON_GRACE_DAYS,
    limit: int = DEFAULT_DELETE_LIMIT,
) -> list[GuestAlbumCandidate]:
    """Albums that satisfy ALL abandonment conditions, capped at `limit`.

    Conditions: owner_id IS NULL AND created_by IS NULL; the album has guest sessions;
    none of them is claimed; every one is expired; and the last expiry is more than
    `grace_days` in the past. Anything ambiguous (no sessions, an unparseable expiry) is
    skipped rather than deleted.
    """
    rows = (
        client.table("albums")
        .select("id, owner_id, created_by")
        .is_("owner_id", "null")
        .is_("created_by", "null")
        .execute()
        .data
        or []
    )
    candidates: list[GuestAlbumCandidate] = []
    for album in rows:
        # Redundant with the query filter and the DB guard — never touch an owned album.
        if album.get("owner_id") is not None or album.get("created_by") is not None:
            continue
        album_id = str(album["id"])
        sessions = (
            client.table("guest_album_sessions").select("*").eq("album_id", album_id).execute().data or []
        )
        if not sessions:
            continue  # Ownerless with no session: unknown provenance — do not delete.
        if any(session.get("claimed_profile_id") for session in sessions):
            continue  # Claimed by someone — never delete, even if also expired.
        expiries: list[datetime] = []
        all_expired = True
        for session in sessions:
            expiry = _parse_dt(session.get("expires_at"))
            if expiry is None:
                all_expired = False  # Missing/unparseable expiry is not safe to delete.
                break
            if expiry > now:
                all_expired = False
                break
            expiries.append(expiry)
        if not all_expired or not expiries:
            continue
        last_expiry = max(expiries)
        if last_expiry + timedelta(days=grace_days) >= now:
            continue  # Grace period not elapsed yet.

        photos = (
            client.table("album_photos").select("byte_size").eq("album_id", album_id).execute().data or []
        )
        total_bytes = sum(int(photo.get("byte_size") or 0) for photo in photos)
        candidates.append(
            GuestAlbumCandidate(
                album_id=album_id,
                photo_count=len(photos),
                total_bytes=total_bytes,
                last_expiry=last_expiry.isoformat(),
            )
        )
        if len(candidates) >= limit:
            break
    return candidates


def delete_guest_album(client: Client, settings: Settings, album_id: str, *, dry_run: bool) -> bool:
    """Snapshot asset paths, then (unless dry-run) cascade-delete the DB rows and Storage.

    Returns True only when a real deletion happened. Mirrors account_service order.
    """
    record = get_album_record(client, album_id)
    if not record:
        return False
    # Final in-code guard mirroring the DB guard — never delete an owned album.
    if record.get("owner_id") is not None or record.get("created_by") is not None:
        logger.warning("guest_cleanup_skip_owned album_id=%s", _short(album_id))
        return False
    # Snapshot the asset paths BEFORE the cascade removes the rows that hold them.
    photo_assets = get_album_photo_asset_records(client, album_id)
    media_assets = get_album_media_asset_records(client, album_id)
    if dry_run:
        return False
    if not delete_abandoned_guest_album(client, album_id):
        # The DB guard refused (owned/claimed/already gone) — leave Storage alone.
        logger.warning("guest_cleanup_delete_refused album_id=%s", _short(album_id))
        return False
    cleanup_album_files(
        client,
        settings,
        record,
        photo_rows=photo_assets,
        media_rows=media_assets,
        dry_run=False,
        remove_album_prefix=True,
    )
    logger.info("guest_cleanup_deleted album_id=%s", _short(album_id))
    return True


def find_orphan_storage_albums(
    client: Client,
    settings: Settings,
    *,
    storage: StorageService | None = None,
    buckets: list[str] | None = None,
) -> list[OrphanStoragePrefix]:
    """Storage album prefixes (albums/<id>/...) with no matching row in public.albums.

    Report-only classifier: it never deletes. Objects under a prefix whose id still
    exists in the albums table are treated as live and excluded.
    """
    storage = storage or StorageService.for_supabase(client, settings)
    known = {
        str(row["id"])
        for row in (client.table("albums").select("id").execute().data or [])
        if row.get("id")
    }
    buckets = buckets or [settings.supabase_private_storage_bucket, settings.supabase_storage_bucket]
    counts: dict[tuple[str, str], int] = {}
    for bucket in buckets:
        for item in storage.list_recursive(bucket, "albums"):
            path = str(item.get("path") or "")
            parts = path.split("/")
            # Expect albums/<album_id>/...  Anything shorter/odd is ignored, not deleted.
            if len(parts) < 3 or parts[0] != "albums" or not parts[1]:
                continue
            album_id = parts[1]
            if album_id in known:
                continue  # Live album — its objects are not orphans.
            counts[(bucket, album_id)] = counts.get((bucket, album_id), 0) + 1
    return [
        OrphanStoragePrefix(bucket=bucket, album_id=album_id, object_count=count)
        for (bucket, album_id), count in sorted(counts.items())
    ]


def delete_orphan_storage_prefix(
    client: Client,
    settings: Settings,
    orphan: OrphanStoragePrefix,
    *,
    storage: StorageService | None = None,
) -> int:
    """Delete every object under one orphan album prefix. Returns the object count.

    Guarded again at call time: if a matching album row now exists, do nothing.
    """
    exists = (
        client.table("albums").select("id").eq("id", orphan.album_id).limit(1).execute().data or []
    )
    if exists:
        logger.warning("orphan_cleanup_skip_live album_id=%s", _short(orphan.album_id))
        return 0
    storage = storage or StorageService.for_supabase(client, settings)
    prefix = f"albums/{orphan.album_id}"
    paths = [str(item["path"]) for item in storage.list_recursive(orphan.bucket, prefix) if item.get("path")]
    if paths:
        storage.delete(orphan.bucket, sorted(set(paths)))
    logger.info("orphan_cleanup_deleted album_id=%s object_count=%s", _short(orphan.album_id), len(paths))
    return len(paths)
