import uuid
import logging
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException
from supabase import Client, create_client

from app.config import Settings, get_settings
from app.models.album_photo_status import ALBUM_PHOTO_DELETED, ALBUM_PHOTO_READY
from app.services.image_upload_service import ProcessedPhoto
from app.services.media_upload_service import ProcessedMedia
from app.services.storage_service import (
    StorageService,
    album_media_paths,
    album_photo_paths,
    album_result_path,
    cleanup_orphan_assets,
    cleanup_temporary_uploads,
)

logger = logging.getLogger(__name__)


def _is_missing_column_error(exc: Exception, column: str) -> bool:
    """Recognize PostgREST's missing-column response during phased deploys."""
    message = " ".join(
        str(value or "")
        for value in (getattr(exc, "message", None), getattr(exc, "details", None), str(exc))
    ).lower()
    return column.lower() in message and any(marker in message for marker in ("column", "schema cache", "pgrst204", "42703"))


def get_supabase_client(settings: Settings | None = None) -> Client:
    settings = settings or get_settings()
    return create_client(settings.supabase_url, settings.supabase_service_role_key)


def upload_album_photo_assets(
    client: Client,
    family_id: str,
    album_id: str,
    photo_id: str,
    photo: ProcessedPhoto,
    settings: Settings,
) -> tuple[str, str, str]:
    del family_id  # Album paths are provider-neutral and no longer family-shaped.
    original_path, display_path, thumbnail_path = album_photo_paths("", album_id, photo_id, photo.original_extension)
    # GIF display files must retain animation. Reuse the original instead of
    # writing GIF bytes to a misleading .webp path.
    if photo.original_mime_type == "image/gif":
        display_path = original_path
    storage = StorageService.for_supabase(client, settings)
    try:
        storage.upload(
            settings.supabase_private_storage_bucket,
            original_path,
            photo.original_bytes,
            content_type=photo.original_mime_type,
        )
        if display_path != original_path:
            storage.upload(
                settings.supabase_private_storage_bucket,
                display_path,
                photo.display_bytes,
                content_type="image/webp",
            )
        storage.upload(
            settings.supabase_private_storage_bucket,
            thumbnail_path,
            photo.thumbnail_bytes,
            content_type="image/webp",
        )
    except Exception:
        delete_storage_paths(client, settings.supabase_private_storage_bucket, list({original_path, display_path, thumbnail_path}))
        raise
    return original_path, display_path, thumbnail_path


def upload_album_photo_original(
    client: Client,
    *,
    album_id: str,
    photo_id: str,
    photo: ProcessedPhoto,
    settings: Settings,
) -> str:
    """Persist the only asset required before returning a creation response."""
    original_path, _, _ = album_photo_paths("", album_id, photo_id, photo.original_extension)
    StorageService.for_supabase(client, settings).upload(
        settings.supabase_private_storage_bucket,
        original_path,
        photo.original_bytes,
        content_type=photo.original_mime_type,
    )
    return original_path


def upload_album_photo_derivatives(
    client: Client,
    *,
    album_id: str,
    photo_id: str,
    original_extension: str,
    original_mime_type: str,
    display_bytes: bytes | None,
    thumbnail_bytes: bytes,
    settings: Settings,
) -> tuple[str, str]:
    """Upload derived web assets without replacing the durable original."""
    original_path, display_path, thumbnail_path = album_photo_paths("", album_id, photo_id, original_extension)
    if original_mime_type == "image/gif":
        display_path = original_path
    storage = StorageService.for_supabase(client, settings)
    try:
        if display_bytes is not None and display_path != original_path:
            storage.upload(settings.supabase_private_storage_bucket, display_path, display_bytes, content_type="image/webp")
        storage.upload(settings.supabase_private_storage_bucket, thumbnail_path, thumbnail_bytes, content_type="image/webp")
    except Exception:
        # The original is durable; only clean up partially written derivatives.
        delete_storage_paths(client, settings.supabase_private_storage_bucket, [
            path for path in (display_path if display_path != original_path else None, thumbnail_path) if path
        ])
        raise
    return display_path, thumbnail_path


def upload_album_media_assets(
    client: Client,
    family_id: str,
    album_id: str,
    media_id: str,
    media: ProcessedMedia,
    settings: Settings,
) -> tuple[str, str | None, str | None]:
    del family_id
    original_path, preview_path, thumbnail_path = album_media_paths(album_id, media_id, bool(media.preview_bytes), bool(media.thumbnail_bytes))
    storage = StorageService.for_supabase(client, settings)
    paths = [original_path] + [path for path in (preview_path, thumbnail_path) if path]
    try:
        storage.upload(settings.supabase_private_storage_bucket, original_path, media.original_bytes, content_type=media.mime_type)
        if preview_path and media.preview_bytes and media.preview_mime_type:
            storage.upload(settings.supabase_private_storage_bucket, preview_path, media.preview_bytes, content_type=media.preview_mime_type)
        if thumbnail_path and media.thumbnail_bytes:
            storage.upload(settings.supabase_private_storage_bucket, thumbnail_path, media.thumbnail_bytes, content_type="image/webp")
    except Exception:
        delete_storage_paths(client, settings.supabase_private_storage_bucket, paths)
        raise
    return original_path, preview_path, thumbnail_path


def delete_storage_paths(client: Client, bucket_name: str, paths: list[str]) -> None:
    if not paths:
        return
    try:
        StorageService.for_supabase(client, get_settings()).delete(bucket_name, paths)
    except Exception:
        # Rollback is best-effort: preserve the original upload exception.
        pass


def upload_result_image(
    client: Client,
    album_id: str,
    image_bytes: bytes,
    settings: Settings,
) -> str:
    # Generated artifacts are private objects.  Database rows keep the path;
    # callers issue a short-lived signed URL only after authorization.
    path = album_result_path(album_id, str(uuid.uuid4()))
    StorageService.for_supabase(client, settings).upload(settings.supabase_private_storage_bucket, path, image_bytes, content_type="image/png")
    return path


def get_public_url(client: Client, path: str, settings: Settings) -> str:
    """Legacy compatibility only; never use this for generated album assets."""
    return get_signed_url(client, settings.supabase_storage_bucket, path, settings.signed_url_ttl_seconds)


def get_result_signed_url(client: Client, record: dict[str, Any], settings: Settings) -> str:
    path = str(record.get("result_path") or "").strip()
    if not path:
        return ""
    # Legacy rows point to the former albums bucket; newly created rows persist
    # momento-private explicitly.  No route returns an unsigned object URL.
    configured_bucket = str(record.get("result_bucket") or "").strip()
    # A deployment can reach Railway before the additive ``result_bucket``
    # migration. New result objects are private, so try that non-public bucket
    # first for legacy rows and only then the historical bucket.
    candidates = [configured_bucket] if configured_bucket else []
    candidates.extend([
        getattr(settings, "supabase_private_storage_bucket", "momento-private"),
        getattr(settings, "supabase_storage_bucket", "albums"),
    ])
    for bucket in dict.fromkeys(bucket for bucket in candidates if bucket):
        url = get_signed_url(client, str(bucket), path, getattr(settings, "signed_url_ttl_seconds", 300))
        if url:
            return url
    return ""


def save_album_record(
    client: Client,
    album_id: str,
    owner_id: str | None,
    family_id: str | None,
    meeting_type: str,
    template: str,
    title: str,
    event_date: str,
    narrative: str,
    photo_paths: list[str],
    photo_meta: list[dict[str, Any]],
    result_path: str,
    category: str | None = None,
    template_type: str | None = None,
    epilogue: str | None = None,
    chapter_stories: dict[str, str] | None = None,
    cover_photo_id: str | None = None,
    result_bucket: str | None = None,
    creation_status: str = "active",
) -> dict[str, Any]:
    record = {
        "id": album_id,
        "owner_id": owner_id,
        # Phase-1 migration backfills profiles for Auth users. Keep owner_id as
        # the legacy authorization source while dual-writing the new creator FK.
        "created_by": owner_id,
        "family_id": family_id,
        "meeting_type": meeting_type,
        "category": category,
        "template": template,
        "template_type": template_type,
        "title": title,
        "event_date": event_date,
        "narrative": narrative or "",
        "epilogue": epilogue if epilogue is not None else "",
        # chapter_stories kept for DB compat but unused by app
        "chapter_stories": chapter_stories if chapter_stories is not None else {},
        "photo_paths": photo_paths,
        "photo_meta": photo_meta,
        "result_path": result_path,
        "result_bucket": result_bucket or settings_bucket_name(),
        "status": creation_status,
        "cover_photo_id": cover_photo_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    try:
        client.table("albums").insert(record).execute()
        return record
    except Exception as exc:
        if not _is_missing_column_error(exc, "result_bucket"):
            raise
        # Keep creation available while the additive migration rolls out. The
        # object remains in the private bucket and is resolved securely by
        # ``get_result_signed_url`` above; no public URL fallback is used.
        legacy_record = dict(record)
        legacy_record.pop("result_bucket", None)
        logger.warning("album_result_bucket_column_unavailable; retrying compatible insert album_id=%s", album_id)
        client.table("albums").insert(legacy_record).execute()
        return legacy_record


def save_album_photo_records(client: Client, records: list[dict[str, Any]]) -> None:
    if records:
        client.table("album_photos").insert(records).execute()


def save_album_media_records(client: Client, records: list[dict[str, Any]]) -> None:
    if records:
        client.table("album_media").insert(records).execute()


def upsert_album_story_input(
    client: Client, *, album_id: str, author_profile_id: str, input_key: str, value: str
) -> dict[str, Any]:
    result = client.table("album_story_inputs").upsert(
        {
            "album_id": album_id,
            "author_profile_id": author_profile_id,
            "input_key": input_key,
            "value": value.strip(),
        },
        on_conflict="album_id,author_profile_id,input_key",
    ).execute()
    data = result.data or []
    return data[0] if data else {"input_key": input_key, "value": value.strip()}


def get_album_story_inputs(client: Client, album_id: str) -> list[dict[str, Any]]:
    result = (
        client.table("album_story_inputs")
        .select("input_key, value, author_profile_id, updated_at")
        .eq("album_id", album_id)
        .order("updated_at")
        .execute()
    )
    return result.data or []


def ensure_default_family(client: Client, user_id: str) -> str:
    """Return the user's provisioned default family through a server-only RPC."""
    result = client.rpc("ensure_default_family", {"target_profile_id": user_id}).execute()
    if not result.data:
        raise HTTPException(status_code=500, detail="Could not provision a family for this user.")
    return str(result.data)


def create_album_id() -> str:
    return str(uuid.uuid4())


def get_album_record(client: Client, album_id: str) -> dict[str, Any] | None:
    result = client.table("albums").select("*").eq("id", album_id).limit(1).execute()
    data = result.data or []
    return data[0] if data else None


ALBUM_DETAIL_LIGHT_COLUMNS = (
    "id,meeting_type,category,template,template_type,title,event_date,"
    "epilogue,narrative,chapter_stories,result_path,cover_photo_id,created_at,"
    "album_version,living_latest_edition_previous,living_append_pages"
)


def get_album_detail_light_record(client: Client, album_id: str) -> dict[str, Any] | None:
    result = (
        client.table("albums")
        .select(ALBUM_DETAIL_LIGHT_COLUMNS)
        .eq("id", album_id)
        .is_("deleted_at", "null")
        .limit(1)
        .execute()
    )
    data = result.data or []
    return data[0] if data else None


def get_album_detail_edition_record(client: Client, album_id: str) -> dict[str, Any] | None:
    columns = f"{ALBUM_DETAIL_LIGHT_COLUMNS},album_version_history"
    result = (
        client.table("albums")
        .select(columns)
        .eq("id", album_id)
        .is_("deleted_at", "null")
        .limit(1)
        .execute()
    )
    data = result.data or []
    return data[0] if data else None


def count_ready_album_photos(client: Client, album_id: str) -> int:
    result = (
        client.table("album_photos")
        .select("id", count="exact")
        .eq("album_id", album_id)
        .is_("deleted_at", "null")
        .eq("status", ALBUM_PHOTO_READY)
        .limit(0)
        .execute()
    )
    return int(result.count or 0)


def count_album_photo_memories(client: Client, album_id: str) -> int:
    result = (
        client.table("photo_memories")
        .select("id", count="exact")
        .eq("album_id", album_id)
        .is_("deleted_at", "null")
        .limit(0)
        .execute()
    )
    return int(result.count or 0)


def get_album_photo_records_by_ids(
    client: Client, album_id: str, photo_ids: list[str],
) -> list[dict[str, Any]]:
    unique_ids = sorted({str(photo_id) for photo_id in photo_ids if photo_id})
    if not unique_ids:
        return []
    result = (
        client.table("album_photos")
        .select(
            "id, storage_bucket, storage_path, display_bucket, display_path, thumbnail_bucket, thumbnail_path, sort_order, "
            "comment, caption, taken_at, latitude, longitude, location_name, location_source, orientation, width, height, "
            "uploaded_by_contributor_id, created_at"
        )
        .eq("album_id", album_id)
        .in_("id", unique_ids)
        .is_("deleted_at", "null")
        .eq("status", ALBUM_PHOTO_READY)
        .execute()
    )
    rows = result.data or []
    rows.sort(
        key=lambda row: (
            row.get("taken_at") is None,
            str(row.get("taken_at") or ""),
            int(row.get("sort_order") or 0),
        )
    )
    return rows


def list_owned_album_records(client: Client, profile_id: str) -> list[dict[str, Any]]:
    """Return only albums created by this profile, including legacy owner rows."""
    result = (
        client.table("albums")
        .select("id, title, created_at, result_path, photo_paths, cover_photo_id")
        .or_(f"created_by.eq.{profile_id},owner_id.eq.{profile_id}")
        .is_("deleted_at", "null")
        .order("created_at", desc=True)
        .execute()
    )
    return result.data or []


def list_owned_album_list_records(client: Client, profile_id: str, *, limit: int = 20) -> list[dict[str, Any]]:
    """Return the minimal, newest-first fields needed by the customer album list.

    Older guest claims can have an owner membership even when the legacy
    ``owner_id``/``created_by`` columns were not populated.  Keep that owner
    relationship visible without exposing participant-only albums.
    """
    columns = "id, title, created_at, updated_at, result_path, cover_photo_id, album_version, living_latest_edition_previous, status"
    result = (
        client.table("albums")
        .select(columns)
        .or_(f"created_by.eq.{profile_id},owner_id.eq.{profile_id}")
        .is_("deleted_at", "null")
        .order("updated_at", desc=True)
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )
    rows = result.data or []
    known_ids = {str(row.get("id") or "") for row in rows}
    membership_result = (
        client.table("album_members")
        .select("album_id")
        .eq("profile_id", profile_id)
        .eq("role", "owner")
        .eq("status", "active")
        .execute()
    )
    member_album_ids = [
        str(row.get("album_id") or "")
        for row in (membership_result.data or [])
        if str(row.get("album_id") or "") and str(row.get("album_id")) not in known_ids
    ]
    if member_album_ids:
        recovered = (
            client.table("albums")
            .select(columns)
            .in_("id", member_album_ids)
            .is_("deleted_at", "null")
            .execute()
        )
        rows.extend(recovered.data or [])
    rows.sort(
        key=lambda row: str(row.get("updated_at") or row.get("created_at") or ""),
        reverse=True,
    )
    return rows[:limit]


def list_participating_album_list_records(
    client: Client, profile_id: str, exclude_ids: set[str], *, limit: int = 20
) -> list[dict[str, Any]]:
    """Albums this user contributed to but does not own — for the "함께 만드는 앨범" list.

    Ownership is handled by list_owned_album_list_records; here we return only
    album_contributors rows (role != owner, active) whose album is not already owned,
    so an owner never shows up twice.
    """
    contributor_rows = (
        client.table("album_contributors")
        .select("album_id, role")
        .eq("user_id", profile_id)
        .eq("status", "active")
        .execute()
        .data
        or []
    )
    participating_ids: list[str] = []
    seen: set[str] = set()
    for row in contributor_rows:
        album_id = str(row.get("album_id") or "")
        if not album_id or album_id in seen or album_id in exclude_ids:
            continue
        if str(row.get("role") or "") == "owner":
            continue
        seen.add(album_id)
        participating_ids.append(album_id)
    if not participating_ids:
        return []
    columns = "id, title, created_at, updated_at, result_path, cover_photo_id, album_version, living_latest_edition_previous, status"
    result = (
        client.table("albums")
        .select(columns)
        .in_("id", participating_ids)
        .is_("deleted_at", "null")
        .order("updated_at", desc=True)
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )
    return result.data or []


def list_album_photo_list_summaries(client: Client, album_ids: list[str]) -> list[dict[str, Any]]:
    """Fetch only IDs and ordering for list counts and legacy cover fallback in one query."""
    if not album_ids:
        return []
    result = (
        client.table("album_photos")
        .select("album_id, id, sort_order")
        .in_("album_id", album_ids)
        .is_("deleted_at", "null")
        .eq("status", ALBUM_PHOTO_READY)
        .order("album_id")
        .order("sort_order")
        .execute()
    )
    return result.data or []


def list_owned_album_cover_records(
    client: Client,
    profile_id: str,
    album_ids: list[str],
) -> list[dict[str, Any]]:
    """Read only owned album cover IDs for the asynchronous cover-image request."""
    if not album_ids:
        return []
    result = (
        client.table("albums")
        .select("id, cover_photo_id")
        .or_(f"created_by.eq.{profile_id},owner_id.eq.{profile_id}")
        .in_("id", album_ids)
        .is_("deleted_at", "null")
        .execute()
    )
    return result.data or []


def list_album_photo_cover_records(client: Client, album_ids: list[str], photo_ids: list[str]) -> list[dict[str, Any]]:
    """Fetch the selected covers' storage paths in one query, never one query per album."""
    if not album_ids or not photo_ids:
        return []
    result = (
        client.table("album_photos")
        .select("album_id, id, storage_bucket, storage_path, display_bucket, display_path, thumbnail_bucket, thumbnail_path")
        .in_("album_id", album_ids)
        .in_("id", photo_ids)
        .is_("deleted_at", "null")
        .eq("status", ALBUM_PHOTO_READY)
        .execute()
    )
    return result.data or []


def get_signed_urls_batch(client: Client, assets: list[dict[str, Any]], expires_in: int) -> dict[tuple[str, str], str]:
    """Create cover URLs per storage bucket instead of one storage request per album."""
    paths_by_bucket: dict[str, list[str]] = {}
    for asset in assets:
        bucket = str(asset.get("bucket") or asset.get("thumbnail_bucket") or asset.get("storage_bucket") or "").strip()
        path = str(asset.get("path") or asset.get("thumbnail_path") or asset.get("storage_path") or "").strip()
        if bucket and path:
            paths_by_bucket.setdefault(bucket, []).append(path)

    signed_urls: dict[tuple[str, str], str] = {}
    for bucket, paths in paths_by_bucket.items():
        try:
            rows = StorageService.for_supabase(client, get_settings()).create_signed_urls(
                bucket,
                list(dict.fromkeys(paths)),
                expires_in,
            )
        except Exception:
            continue
        for row in rows or []:
            if not isinstance(row, dict):
                continue
            path = str(row.get("path") or "")
            url = str(row.get("signedURL") or row.get("signedUrl") or "")
            if path and url:
                signed_urls[(bucket, path)] = url
    return signed_urls


def update_album_narrative(client: Client, album_id: str, narrative: str) -> dict[str, Any] | None:
    """Legacy: writes epilogue (우리의 이야기). Does not touch chapter_stories."""
    result = (
        client.table("albums")
        .update({"epilogue": narrative, "narrative": narrative})
        .eq("id", album_id)
        .execute()
    )
    data = result.data or []
    return data[0] if data else None


def update_album_epilogue(client: Client, album_id: str, epilogue: str) -> dict[str, Any] | None:
    result = (
        client.table("albums")
        .update({"epilogue": epilogue, "narrative": epilogue})
        .eq("id", album_id)
        .execute()
    )
    data = result.data or []
    row = data[0] if data else None
    if row:
        bump_album_version(client, album_id)
    return get_album_record(client, album_id)


def update_album_title(client: Client, album_id: str, title: str) -> dict[str, Any] | None:
    result = (
        client.table("albums")
        .update({"title": title.strip()})
        .eq("id", album_id)
        .execute()
    )
    data = result.data or []
    if data:
        bump_album_version(client, album_id)
    return get_album_record(client, album_id)


def update_album_chapter_stories(
    client: Client, album_id: str, chapter_stories: dict[str, str]
) -> dict[str, Any] | None:
    result = (
        client.table("albums")
        .update({"chapter_stories": chapter_stories})
        .eq("id", album_id)
        .execute()
    )
    data = result.data or []
    if data:
        bump_album_version(client, album_id)
    return get_album_record(client, album_id)


def bump_album_version(client: Client, album_id: str) -> int:
    record = get_album_record(client, album_id)
    if not record:
        return 0
    next_version = int(record.get("album_version") or 0) + 1
    client.table("albums").update(
        {"album_version": next_version, "updated_at": datetime.now(timezone.utc).isoformat()}
    ).eq("id", album_id).execute()
    return next_version

def get_album_photo_records(client: Client, album_id: str) -> list[dict[str, Any]]:
    result = (
        client.table("album_photos")
        .select(
            "id, storage_bucket, storage_path, display_bucket, display_path, thumbnail_bucket, thumbnail_path, sort_order, "
            "comment, caption, taken_at, latitude, longitude, location_name, location_source, orientation, width, height, "
            "uploaded_by_contributor_id, created_at"
        )
        .eq("album_id", album_id)
        .is_("deleted_at", "null")
        .eq("status", ALBUM_PHOTO_READY)
        .order("sort_order")
        .execute()
    )
    rows = result.data or []
    # taken_at ASC, missing last, then upload/sort_order
    rows.sort(
        key=lambda row: (
            row.get("taken_at") is None,
            str(row.get("taken_at") or ""),
            int(row.get("sort_order") or 0),
        )
    )
    return rows


def get_album_photo_asset_records(client: Client, album_id: str) -> list[dict[str, Any]]:
    """Return every stored photo path, including failed and legacy rows.

    Album deletion must not rely on the screen-query filter (``ready`` and
    ``deleted_at IS NULL``), otherwise failed uploads and soft-deleted photos
    become permanent Storage orphans.
    """
    result = (
        client.table("album_photos")
        .select("storage_bucket, storage_path, display_bucket, display_path, thumbnail_bucket, thumbnail_path")
        .eq("album_id", album_id)
        .execute()
    )
    return result.data or []


def update_album_photo_comment(
    client: Client, *, album_id: str, photo_id: str, comment: str | None
) -> dict[str, Any] | None:
    result = (
        client.table("album_photos")
        .update({"comment": comment, "caption": comment})
        .eq("album_id", album_id)
        .eq("id", photo_id)
        .is_("deleted_at", "null")
        .execute()
    )
    data = result.data or []
    row = data[0] if data else None
    if row:
        bump_album_version(client, album_id)
    return row


def get_album_media_records(client: Client, album_id: str) -> list[dict[str, Any]]:
    result = (
        client.table("album_media")
        .select(
            "id, media_type, mime_type, original_filename, original_path, preview_path, thumbnail_path, "
            "file_size, width, height, duration_seconds, page_count, sort_order, processing_status, metadata, media_analysis"
        )
        .eq("album_id", album_id)
        .is_("deleted_at", "null")
        .order("sort_order")
        .execute()
    )
    return result.data or []


def get_album_media_asset_records(client: Client, album_id: str) -> list[dict[str, Any]]:
    """Return every media asset path for destructive cleanup only."""
    result = (
        client.table("album_media")
        .select("original_path, preview_path, thumbnail_path")
        .eq("album_id", album_id)
        .execute()
    )
    return result.data or []


def get_album_media_record(client: Client, album_id: str, media_id: str) -> dict[str, Any] | None:
    result = (
        client.table("album_media")
        .select("*")
        .eq("id", media_id)
        .eq("album_id", album_id)
        .is_("deleted_at", "null")
        .limit(1)
        .execute()
    )
    data = result.data or []
    return data[0] if data else None


def settings_bucket_name() -> str:
    return get_settings().supabase_private_storage_bucket


def delete_album_media_record(client: Client, album_id: str, media_id: str) -> bool:
    result = (
        client.table("album_media")
        .update({"deleted_at": datetime.now(timezone.utc).isoformat()})
        .eq("id", media_id)
        .eq("album_id", album_id)
        .is_("deleted_at", "null")
        .execute()
    )
    return bool(result.data)


def soft_delete_album_photo_with_references(client: Client, album_id: str, photo_id: str) -> bool:
    """Atomically retire a photo and every current-album reference to it.

    The RPC is the normal path. The narrow fallback keeps deployments safe when
    code arrives before the additive migration; it intentionally rebuilds from
    DB rows rather than retaining an old album document.
    """
    try:
        result = client.rpc(
            "soft_delete_album_photo",
            {"p_album_id": album_id, "p_photo_id": photo_id},
        ).execute()
        data = result.data
        if isinstance(data, list):
            return bool(data[0]) if data else False
        return bool(data)
    except Exception as exc:
        logger.warning(
            "photo_delete_rpc_fallback album_id=%s photo_id=%s error_type=%s",
            album_id[:8], photo_id[:8], type(exc).__name__,
        )

    now = datetime.now(timezone.utc).isoformat()
    photo_result = (
        client.table("album_photos")
        .update({"status": ALBUM_PHOTO_DELETED, "deleted_at": now})
        .eq("id", photo_id).eq("album_id", album_id).is_("deleted_at", "null")
        .execute()
    )
    if not photo_result.data:
        return False
    deleted_memory_rows = (
        client.table("photo_memories").select("id").eq("album_id", album_id)
        .eq("photo_id", photo_id).is_("deleted_at", "null").execute().data or []
    )
    deleted_memory_ids = {str(row.get("id")) for row in deleted_memory_rows if row.get("id")}
    client.table("album_media").update({"deleted_at": now}).eq("id", photo_id).eq("album_id", album_id).is_("deleted_at", "null").execute()
    client.table("photo_memories").update({"deleted_at": now}).eq("album_id", album_id).eq("photo_id", photo_id).is_("deleted_at", "null").execute()
    current_album = (
        client.table("albums").select(
            "cover_photo_id,applied_contribution_photo_ids,applied_contribution_memory_ids"
        ).eq("id", album_id).limit(1).execute().data or []
    )
    album_row = current_album[0] if current_album else {}
    current_cover_id = str(album_row.get("cover_photo_id") or "")
    remaining = (
        client.table("album_photos").select("id").eq("album_id", album_id)
        .eq("status", ALBUM_PHOTO_READY).is_("deleted_at", "null").order("sort_order").execute().data or []
    )
    remaining_ids = {str(row.get("id")) for row in remaining}
    next_cover_id = current_cover_id if current_cover_id in remaining_ids else (str(remaining[0]["id"]) if remaining else None)
    client.table("albums").update({
        "cover_photo_id": next_cover_id,
        "album_json": None,
        "living_append_pages": [],
        "pdf_cache": {},
        "applied_contribution_photo_ids": [
            str(value) for value in (album_row.get("applied_contribution_photo_ids") or [])
            if str(value) != photo_id
        ],
        "applied_contribution_memory_ids": [
            str(value) for value in (album_row.get("applied_contribution_memory_ids") or [])
            if str(value) not in deleted_memory_ids
        ],
        "dirty": True,
        "last_rebuild_started_at": None,
    }).eq("id", album_id).execute()
    return True


def get_signed_url(client: Client, bucket_name: str, path: str, expires_in: int) -> str:
    try:
        return StorageService.for_supabase(client, get_settings()).create_signed_url(bucket_name, path, expires_in)
    except Exception as exc:
        # A missing bucket/object or temporary Storage outage must not turn an
        # otherwise valid album-detail/public-share response into a server 500.
        logger.warning(
            "storage_signed_url_failed bucket=%s path=%s error_type=%s message=%s",
            bucket_name,
            path,
            type(exc).__name__,
            str(exc)[:240],
        )
        return ""


def delete_album_record(client: Client, album_id: str) -> None:
    client.table("albums").delete().eq("id", album_id).execute()


def delete_album_cascade(client: Client, album_id: str, actor_id: str) -> bool:
    """Atomically remove one authorized album and its RESTRICT children.

    Storage is intentionally outside this transaction; callers must collect
    the asset paths first and clean them up after a successful DB deletion.
    """
    result = client.rpc(
        "delete_album_cascade",
        {"p_album_id": album_id, "p_actor_id": actor_id},
    ).execute()
    data = result.data
    if isinstance(data, list):
        return bool(data[0]) if data else False
    return bool(data)


def delete_abandoned_guest_album(client: Client, album_id: str) -> bool:
    """Service-role delete of an ownerless, unclaimed, expired guest album.

    The DB function re-checks the abandonment invariants (owner_id/created_by NULL and no
    claimed session), so an owned or claimed album can never be removed even if a caller
    passes its id by mistake. Storage is outside this transaction, like delete_album_cascade:
    collect asset paths first, then clean them up after a successful DB deletion.
    """
    result = client.rpc(
        "delete_abandoned_guest_album",
        {"p_album_id": album_id},
    ).execute()
    data = result.data
    if isinstance(data, list):
        return bool(data[0]) if data else False
    return bool(data)


def cleanup_incomplete_album(client: Client, album_id: str) -> None:
    """Compensate a failed create in child-first order before removing assets."""
    # These rows are created by authenticated album creation routes.
    # Delete children first because album foreign keys intentionally restrict
    # deleting a completed album with dependent content.
    for table in ("album_members", "album_media", "album_photos", "share_links"):
        try:
            client.table(table).delete().eq("album_id", album_id).execute()
        except Exception:
            # Continue cleanup and leave the original exception as the request
            # failure; database logs retain any compensating-action error.
            pass
    delete_album_record(client, album_id)


def set_album_creation_status(client: Client, album_id: str, status: str) -> None:
    client.table("albums").update({"status": status, "updated_at": datetime.now(timezone.utc).isoformat()}).eq("id", album_id).execute()


def _cached_pdf_paths(record: dict[str, Any]) -> list[str]:
    cache = record.get("pdf_cache") or {}
    if not isinstance(cache, dict):
        return []
    return [str(entry.get("path")) for entry in cache.values() if isinstance(entry, dict) and entry.get("path")]


def cleanup_album_files(
    client: Client,
    settings: Settings,
    album: dict[str, Any],
    *,
    photo_rows: list[dict[str, Any]] | None = None,
    media_rows: list[dict[str, Any]] | None = None,
    dry_run: bool = True,
    remove_album_prefix: bool = False,
) -> dict[str, list[str]]:
    """Collect, and optionally remove, every known asset for one album.

    This is idempotent: repeated calls only attempt the same paths, allowing an
    operations job to retry cleanup after a storage failure.
    """
    photos = photo_rows if photo_rows is not None else get_album_photo_asset_records(client, str(album["id"]))
    media = media_rows if media_rows is not None else get_album_media_asset_records(client, str(album["id"]))
    by_bucket: dict[str, list[str]] = {}
    def add(bucket: str | None, path: str | None) -> None:
        normalized_bucket = str(bucket or "").strip()
        normalized_path = str(path or "").strip().lstrip("/")
        # Database rows contain object paths, never signed/public URLs.  Do
        # not accidentally feed a URL or query string to Storage.remove.
        if not normalized_bucket or not normalized_path or "://" in normalized_path or "?" in normalized_path:
            return
        by_bucket.setdefault(normalized_bucket, []).append(normalized_path)
    for row in photos:
        add(row.get("storage_bucket"), row.get("storage_path"))
        add(row.get("display_bucket"), row.get("display_path"))
        add(row.get("thumbnail_bucket"), row.get("thumbnail_path"))
    for row in media:
        for key in ("original_path", "preview_path", "thumbnail_path"):
            add(getattr(settings, "supabase_private_storage_bucket", "momento-private"), row.get(key))
    result_path = str(album.get("result_path") or "")
    if result_path:
        add(str(album.get("result_bucket") or getattr(settings, "supabase_storage_bucket", "albums")), result_path)
    for path in _cached_pdf_paths(album):
        add(getattr(settings, "supabase_private_storage_bucket", "momento-private"), path)
    for bucket, paths in by_bucket.items():
        by_bucket[bucket] = sorted(set(paths))
    if not dry_run:
        try:
            storage = StorageService.for_supabase(client, settings)
        except Exception as exc:
            logger.warning(
                "album_asset_cleanup_unavailable bucket_count=%s error_type=%s",
                len(by_bucket),
                type(exc).__name__,
            )
            return by_bucket
        for bucket, paths in by_bucket.items():
            try:
                # Supabase remove is idempotent for already-missing objects.
                # A bucket outage must not undo a committed album deletion.
                storage.delete(bucket, paths)
            except Exception as exc:
                logger.warning(
                    "album_asset_cleanup_failed bucket=%s path_count=%s error_type=%s",
                    bucket,
                    len(paths),
                    type(exc).__name__,
                )
        if remove_album_prefix:
            # DB paths cover current assets.  A deleted album also needs any
            # abandoned temp uploads and superseded generated files below its
            # own canonical root, without ever scanning another album.
            prefix = f"albums/{album['id']}"
            for bucket in sorted(set(by_bucket) | {getattr(settings, "supabase_private_storage_bucket", "momento-private")}):
                try:
                    leftovers = [
                        str(item["path"])
                        for item in storage.list_recursive(bucket, prefix)
                        if item.get("path")
                    ]
                    if leftovers:
                        storage.delete(bucket, sorted(set(leftovers)))
                except Exception as exc:
                    logger.warning(
                        "album_asset_prefix_cleanup_failed bucket=%s album_id=%s error_type=%s",
                        bucket,
                        str(album["id"])[:6],
                        type(exc).__name__,
                    )
    return by_bucket


def cleanup_temporary_album_uploads(
    client: Client,
    settings: Settings,
    album_id: str,
    *,
    minimum_age_hours: int = 24,
    dry_run: bool = True,
) -> list[str]:
    return cleanup_temporary_uploads(
        StorageService.for_supabase(client, settings),
        settings.supabase_private_storage_bucket,
        album_id,
        minimum_age_hours=minimum_age_hours,
        dry_run=dry_run,
    )


def cleanup_album_orphans(
    client: Client,
    settings: Settings,
    album_id: str,
    known_paths: set[str],
    *,
    exclude_prefixes: tuple[str, ...] = (),
    dry_run: bool = True,
) -> list[str]:
    return cleanup_orphan_assets(
        StorageService.for_supabase(client, settings),
        settings.supabase_private_storage_bucket,
        known_paths,
        prefix=f"albums/{album_id}",
        exclude_prefixes=exclude_prefixes,
        dry_run=dry_run,
    )
