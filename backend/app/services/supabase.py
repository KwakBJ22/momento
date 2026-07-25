import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException
from supabase import Client, create_client

from app.config import Settings, get_settings
from app.services.image_upload_service import ProcessedPhoto
from app.services.media_upload_service import ProcessedMedia


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
) -> tuple[str, str]:
    base_path = f"families/{family_id}/albums/{album_id}/photos/{photo_id}"
    original_path = f"{base_path}/original.{photo.original_extension}"
    thumbnail_path = f"{base_path}/derived/thumbnail.webp"
    bucket = client.storage.from_(settings.supabase_private_storage_bucket)
    try:
        bucket.upload(
            original_path,
            photo.original_bytes,
            file_options={"content-type": photo.original_mime_type, "upsert": "false"},
        )
        bucket.upload(
            thumbnail_path,
            photo.thumbnail_bytes,
            file_options={"content-type": "image/webp", "upsert": "false"},
        )
    except Exception:
        delete_storage_paths(client, settings.supabase_private_storage_bucket, [original_path, thumbnail_path])
        raise
    return original_path, thumbnail_path


def upload_album_media_assets(
    client: Client,
    family_id: str,
    album_id: str,
    media_id: str,
    media: ProcessedMedia,
    settings: Settings,
) -> tuple[str, str | None, str | None]:
    base_path = f"families/{family_id}/albums/{album_id}/media/{media_id}"
    original_path = f"{base_path}/original"
    preview_path = f"{base_path}/preview" if media.preview_bytes else None
    thumbnail_path = f"{base_path}/thumbnail" if media.thumbnail_bytes else None
    bucket = client.storage.from_(settings.supabase_private_storage_bucket)
    paths = [original_path] + [path for path in (preview_path, thumbnail_path) if path]
    try:
        bucket.upload(original_path, media.original_bytes, file_options={"content-type": media.mime_type, "upsert": "false"})
        if preview_path and media.preview_bytes and media.preview_mime_type:
            bucket.upload(preview_path, media.preview_bytes, file_options={"content-type": media.preview_mime_type, "upsert": "false"})
        if thumbnail_path and media.thumbnail_bytes:
            bucket.upload(thumbnail_path, media.thumbnail_bytes, file_options={"content-type": "image/webp", "upsert": "false"})
    except Exception:
        delete_storage_paths(client, settings.supabase_private_storage_bucket, paths)
        raise
    return original_path, preview_path, thumbnail_path


def delete_storage_paths(client: Client, bucket_name: str, paths: list[str]) -> None:
    if not paths:
        return
    try:
        client.storage.from_(bucket_name).remove(paths)
    except Exception:
        # Rollback is best-effort: preserve the original upload exception.
        pass


def upload_result_image(
    client: Client,
    album_id: str,
    image_bytes: bytes,
    settings: Settings,
) -> str:
    path = f"{album_id}/result/album.png"
    client.storage.from_(settings.supabase_storage_bucket).upload(
        path,
        image_bytes,
        file_options={"content-type": "image/png", "upsert": "true"},
    )
    return path


def get_public_url(client: Client, path: str, settings: Settings) -> str:
    return client.storage.from_(settings.supabase_storage_bucket).get_public_url(path)


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
        "cover_photo_id": cover_photo_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    client.table("albums").insert(record).execute()
    return record


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
        .eq("status", "ready")
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
            "id, storage_bucket, storage_path, thumbnail_bucket, thumbnail_path, sort_order, "
            "comment, caption, taken_at, latitude, longitude, location_name, location_source, orientation, width, height, "
            "uploaded_by_contributor_id, created_at"
        )
        .eq("album_id", album_id)
        .in_("id", unique_ids)
        .is_("deleted_at", "null")
        .eq("status", "ready")
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
    """Return the minimal, newest-first fields needed by the customer album list."""
    result = (
        client.table("albums")
        .select("id, title, created_at, updated_at, result_path, cover_photo_id, album_version, living_latest_edition_previous")
        .or_(f"created_by.eq.{profile_id},owner_id.eq.{profile_id}")
        .is_("deleted_at", "null")
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )
    rows = result.data or []
    rows.sort(
        key=lambda row: str(row.get("updated_at") or row.get("created_at") or ""),
        reverse=True,
    )
    return rows[:limit]


def list_album_photo_list_summaries(client: Client, album_ids: list[str]) -> list[dict[str, Any]]:
    """Fetch only IDs and ordering for list counts and legacy cover fallback in one query."""
    if not album_ids:
        return []
    result = (
        client.table("album_photos")
        .select("album_id, id, sort_order")
        .in_("album_id", album_ids)
        .is_("deleted_at", "null")
        .eq("status", "ready")
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
        .select("album_id, id, storage_bucket, storage_path, thumbnail_bucket, thumbnail_path")
        .in_("album_id", album_ids)
        .in_("id", photo_ids)
        .is_("deleted_at", "null")
        .eq("status", "ready")
        .execute()
    )
    return result.data or []


def get_signed_urls_batch(client: Client, assets: list[dict[str, Any]], expires_in: int) -> dict[tuple[str, str], str]:
    """Create cover URLs per storage bucket instead of one storage request per album."""
    paths_by_bucket: dict[str, list[str]] = {}
    for asset in assets:
        bucket = str(asset.get("thumbnail_bucket") or asset.get("storage_bucket") or "").strip()
        path = str(asset.get("thumbnail_path") or asset.get("storage_path") or "").strip()
        if bucket and path:
            paths_by_bucket.setdefault(bucket, []).append(path)

    signed_urls: dict[tuple[str, str], str] = {}
    for bucket, paths in paths_by_bucket.items():
        try:
            rows = client.storage.from_(bucket).create_signed_urls(paths, expires_in)
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


def get_pending_guest_memory_counts(client: Client, album_ids: list[str]) -> dict[str, int]:
    """Count submitted guest memories that have not yet been claimed."""
    if not album_ids:
        return {}
    try:
        result = (
            client.table("guest_memory_submissions")
            .select("album_id")
            .in_("album_id", album_ids)
            .eq("status", "pending")
            .execute()
        )
    except Exception:
        # Older deployments may not have guest submissions yet; the list still works.
        return {}
    counts: dict[str, int] = {}
    for row in result.data or []:
        album_id = str(row.get("album_id") or "")
        if album_id:
            counts[album_id] = counts.get(album_id, 0) + 1
    return counts


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
            "id, storage_bucket, storage_path, thumbnail_bucket, thumbnail_path, sort_order, "
            "comment, caption, taken_at, latitude, longitude, location_name, location_source, orientation, width, height, "
            "uploaded_by_contributor_id, created_at"
        )
        .eq("album_id", album_id)
        .is_("deleted_at", "null")
        .eq("status", "ready")
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


def delete_album_media_record(client: Client, media_id: str) -> None:
    client.table("album_media").update({"deleted_at": datetime.now(timezone.utc).isoformat()}).eq("id", media_id).execute()


def get_signed_url(client: Client, bucket_name: str, path: str, expires_in: int) -> str:
    response = client.storage.from_(bucket_name).create_signed_url(path, expires_in)
    if isinstance(response, dict):
        return str(response.get("signedURL") or response.get("signedUrl") or "")
    return str(response)


def delete_album_record(client: Client, album_id: str) -> None:
    client.table("albums").delete().eq("id", album_id).execute()
