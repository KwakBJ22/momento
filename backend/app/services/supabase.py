import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException
from supabase import Client, create_client

from app.config import Settings, get_settings
from app.services.image_upload_service import ProcessedPhoto


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
    owner_id: str,
    family_id: str,
    meeting_type: str,
    template: str,
    title: str,
    event_date: str,
    narrative: str,
    photo_paths: list[str],
    photo_meta: list[dict[str, Any]],
    result_path: str,
) -> dict[str, Any]:
    record = {
        "id": album_id,
        "owner_id": owner_id,
        # Phase-1 migration backfills profiles for Auth users. Keep owner_id as
        # the legacy authorization source while dual-writing the new creator FK.
        "created_by": owner_id,
        "family_id": family_id,
        "meeting_type": meeting_type,
        "template": template,
        "title": title,
        "event_date": event_date,
        "narrative": narrative,
        "photo_paths": photo_paths,
        "photo_meta": photo_meta,
        "result_path": result_path,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    client.table("albums").insert(record).execute()
    return record


def save_album_photo_records(client: Client, records: list[dict[str, Any]]) -> None:
    if records:
        client.table("album_photos").insert(records).execute()


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


def update_album_narrative(client: Client, album_id: str, narrative: str) -> dict[str, Any] | None:
    result = (
        client.table("albums")
        .update({"narrative": narrative})
        .eq("id", album_id)
        .execute()
    )
    data = result.data or []
    return data[0] if data else None


def get_album_photo_records(client: Client, album_id: str) -> list[dict[str, Any]]:
    result = (
        client.table("album_photos")
        .select("id, storage_bucket, storage_path, thumbnail_bucket, thumbnail_path, sort_order")
        .eq("album_id", album_id)
        .is_("deleted_at", "null")
        .eq("status", "ready")
        .order("sort_order")
        .execute()
    )
    return result.data or []


def get_signed_url(client: Client, bucket_name: str, path: str, expires_in: int) -> str:
    response = client.storage.from_(bucket_name).create_signed_url(path, expires_in)
    if isinstance(response, dict):
        return str(response.get("signedURL") or response.get("signedUrl") or "")
    return str(response)


def delete_album_record(client: Client, album_id: str) -> None:
    client.table("albums").delete().eq("id", album_id).execute()
