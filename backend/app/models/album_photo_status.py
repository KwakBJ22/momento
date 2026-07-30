"""Shared status policy for persisted ``album_photos`` rows."""
from __future__ import annotations

from typing import Any, Final, Literal, TypeAlias


AlbumPhotoStatus: TypeAlias = Literal["uploading", "ready", "failed", "deleted"]

ALBUM_PHOTO_UPLOADING: Final[AlbumPhotoStatus] = "uploading"
ALBUM_PHOTO_READY: Final[AlbumPhotoStatus] = "ready"
ALBUM_PHOTO_FAILED: Final[AlbumPhotoStatus] = "failed"
ALBUM_PHOTO_DELETED: Final[AlbumPhotoStatus] = "deleted"

# Only ready photos may be rendered or used by initial generation, retries,
# and rebuilds. Failed/deleted rows are always excluded.
ALBUM_PHOTO_READY_STATUSES: Final[tuple[AlbumPhotoStatus, ...]] = (ALBUM_PHOTO_READY,)


def is_ready_album_photo(photo: dict[str, Any]) -> bool:
    return photo.get("status") in ALBUM_PHOTO_READY_STATUSES and not photo.get("deleted_at")


def is_deleted_album_photo(photo: dict[str, Any]) -> bool:
    return photo.get("status") == ALBUM_PHOTO_DELETED or bool(photo.get("deleted_at"))


def ready_album_photo_query(query: Any) -> Any:
    """Apply the common usable-photo filter to a PostgREST query."""
    # This is deliberately an equality filter while ready is the sole usable
    # state; it also keeps the rule compatible with lightweight query doubles.
    return query.eq("status", ALBUM_PHOTO_READY)


def promote_legacy_uploading_album_photos(client: Any, album_id: str) -> None:
    """Recover old rows saved after upload but incorrectly left uploading."""
    table = client.table("album_photos")
    if not hasattr(table, "update"):
        return
    table.update({"status": ALBUM_PHOTO_READY}).eq(
        "album_id", album_id
    ).eq("status", ALBUM_PHOTO_UPLOADING).is_("deleted_at", "null").execute()
