import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException, UploadFile
from supabase import Client, create_client

from app.config import Settings, get_settings


def get_supabase_client(settings: Settings | None = None) -> Client:
    settings = settings or get_settings()
    return create_client(settings.supabase_url, settings.supabase_service_role_key)


def validate_image(file: UploadFile, settings: Settings) -> bytes:
    if file.content_type not in settings.allowed_image_types:
        raise HTTPException(
            status_code=400,
            detail=f"지원하지 않는 이미지 형식입니다: {file.content_type}. JPEG, PNG, WEBP만 가능합니다.",
        )

    content = file.file.read()
    max_bytes = settings.max_file_size_mb * 1024 * 1024
    if len(content) > max_bytes:
        raise HTTPException(
            status_code=400,
            detail=f"이미지 크기는 {settings.max_file_size_mb}MB 이하여야 합니다.",
        )
    if len(content) == 0:
        raise HTTPException(status_code=400, detail="빈 이미지 파일입니다.")

    return content


def upload_photo(
    client: Client,
    album_id: str,
    order: int,
    content: bytes,
    content_type: str,
    settings: Settings,
) -> str:
    ext = content_type.split("/")[-1]
    if ext == "jpeg":
        ext = "jpg"
    path = f"{album_id}/photos/{order:02d}.{ext}"

    client.storage.from_(settings.supabase_storage_bucket).upload(
        path,
        content,
        file_options={"content-type": content_type, "upsert": "true"},
    )
    return path


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


def delete_album_record(client: Client, album_id: str) -> None:
    client.table("albums").delete().eq("id", album_id).execute()
