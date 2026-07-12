from datetime import date as date_cls
from datetime import datetime, timezone
from typing import Any, get_args
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile, status

from app.config import Settings, get_settings
from app.models.schemas import (
    AlbumDetailResponse,
    AlbumMediaSummary,
    AlbumMediaUploadResponse,
    AlbumMediaUrlResponse,
    AlbumMediaUrlsResponse,
    AlbumPhotoUrlResponse,
    AlbumPhotoUrlsResponse,
    AlbumUploadResponse,
    MeetingType,
    NarrativeUpdate,
    TemplateType,
)
from app.services.image_service import (
    bytes_to_images,
    generate_album,
    image_to_png_bytes,
)
from app.services.openai_service import generate_narrative, parse_stories_json
from app.services.supabase import (
    create_album_id,
    delete_album_record,
    delete_album_media_record,
    delete_storage_paths,
    ensure_default_family,
    get_album_record,
    get_album_photo_records,
    get_album_media_record,
    get_album_media_records,
    get_public_url,
    get_signed_url,
    get_supabase_client,
    save_album_record,
    save_album_photo_records,
    save_album_media_records,
    update_album_narrative,
    upload_album_photo_assets,
    upload_album_media_assets,
    upload_result_image,
)
from app.services.image_upload_service import process_upload
from app.services.media_upload_service import process_media_upload
from app.services.auth import require_authenticated_user

router = APIRouter(prefix="/api", tags=["album"])

_VALID_MEETING_TYPES = set(get_args(MeetingType))
_VALID_TEMPLATES = set(get_args(TemplateType))


@router.post("/upload-album", response_model=AlbumUploadResponse)
async def upload_album(
    photos: list[UploadFile] = File(..., description="최대 10장의 사진"),
    stories: str = Form(..., description='JSON 배열: [{"order":0,"user":"","text":"..."}, ...]'),
    meeting_type: str = Form("friend", description="family/friend/work/university"),
    template: str = Form("B", description="앨범 템플릿 A(타임라인)/B(콜라주)/C(스토리북)"),
    title: str = Form("우리의 모임", description="모임 제목"),
    date: str = Form("", description="모임 날짜 (YYYY-MM-DD)"),
    authenticated_user_id: str = Depends(require_authenticated_user),
) -> AlbumUploadResponse:
    settings = get_settings()

    if not photos:
        raise HTTPException(status_code=400, detail="최소 1장의 사진이 필요합니다.")
    if len(photos) > settings.max_photos:
        raise HTTPException(status_code=400, detail=f"사진은 최대 {settings.max_photos}장까지 업로드할 수 있습니다.")
    if meeting_type not in _VALID_MEETING_TYPES:
        raise HTTPException(status_code=400, detail="유효하지 않은 모임 유형입니다.")

    template = (template or "B").upper()
    if template not in _VALID_TEMPLATES:
        raise HTTPException(status_code=400, detail="유효하지 않은 템플릿입니다. (A/B/C)")

    title = title.strip() or "우리의 모임"
    event_date = date.strip() or date_cls.today().isoformat()

    story_items = parse_stories_json(stories)
    if len(story_items) != len(photos):
        raise HTTPException(status_code=400, detail="사진 수와 스토리 수가 일치해야 합니다.")

    orders = [item["order"] for item in story_items]
    if len(set(orders)) != len(orders):
        raise HTTPException(status_code=400, detail="story order 값이 중복되었습니다.")
    if sorted(orders) != list(range(len(photos))):
        raise HTTPException(status_code=400, detail="story order는 0부터 연속된 정수여야 합니다.")
    for item in story_items:
        if not item["text"]:
            raise HTTPException(status_code=400, detail="모든 사진에 설명을 입력해주세요.")

    client = get_supabase_client(settings)
    family_id = ensure_default_family(client, authenticated_user_id)
    album_id = create_album_id()

    processed_photos = [process_upload(photo, settings) for photo in photos]
    items_by_order: dict[int, dict[str, Any]] = {int(item["order"]): item for item in story_items}
    uploaded_private_paths: list[str] = []
    result_path = ""
    album_saved = False

    try:
        photo_records: list[dict[str, Any]] = []
        media_records: list[dict[str, Any]] = []
        photo_paths: list[str] = []
        ordered_bytes: list[bytes] = []
        for index, processed in enumerate(processed_photos):
            photo_id = str(uuid4())
            original_path, thumbnail_path = upload_album_photo_assets(
                client, family_id, album_id, photo_id, processed, settings
            )
            uploaded_private_paths.extend([original_path, thumbnail_path])
            photo_paths.append(original_path)
            items_by_order[index]["_path"] = original_path
            ordered_bytes.append(processed.display_bytes)
            photo_records.append(
                {
                    "id": photo_id,
                    "album_id": album_id,
                    "storage_bucket": settings.supabase_private_storage_bucket,
                    "storage_path": original_path,
                    "thumbnail_bucket": settings.supabase_private_storage_bucket,
                    "thumbnail_path": thumbnail_path,
                    "original_filename": photos[index].filename,
                    "mime_type": processed.original_mime_type,
                    "byte_size": len(processed.original_bytes),
                    "checksum_sha256": processed.checksum_sha256,
                    "sort_order": index,
                    "caption": items_by_order[index]["text"],
                    "contributor_profile_id": authenticated_user_id,
                    "legacy_author_label": items_by_order[index]["user"] or None,
                    "status": "ready",
                }
            )
            media_records.append(
                {
                    "id": photo_id,
                    "album_id": album_id,
                    "uploader_id": authenticated_user_id,
                    "media_type": "gif" if processed.original_mime_type == "image/gif" else "image",
                    "mime_type": processed.original_mime_type,
                    "original_filename": photos[index].filename,
                    "original_path": original_path,
                    "thumbnail_path": thumbnail_path,
                    "file_size": len(processed.original_bytes),
                    "sort_order": index,
                    "processing_status": "ready",
                    "metadata": {"source": "album_photos"},
                }
            )

        ordered_stories = [items_by_order[i] for i in range(len(photos))]
        narrative = await generate_narrative(story_items, meeting_type, title, settings)
        album_img = generate_album(
            template,
            photos=bytes_to_images(ordered_bytes),
            stories=ordered_stories,
            title=title,
            date=event_date,
            narrative=None,
        )
        result_path = upload_result_image(client, album_id, image_to_png_bytes(album_img), settings)
        photo_meta = [
            {"order": item["order"], "user": item["user"], "text": item["text"], "path": item["_path"]}
            for item in ordered_stories
        ]
        save_album_record(
            client,
            album_id=album_id,
            owner_id=authenticated_user_id,
            family_id=family_id,
            meeting_type=meeting_type,
            template=template,
            title=title,
            event_date=event_date,
            narrative=narrative,
            photo_paths=photo_paths,
            photo_meta=photo_meta,
            result_path=result_path,
        )
        album_saved = True
        save_album_photo_records(client, photo_records)
        save_album_media_records(client, media_records)
    except Exception:
        if album_saved:
            try:
                delete_album_record(client, album_id)
            except Exception:
                pass
        delete_storage_paths(client, settings.supabase_private_storage_bucket, uploaded_private_paths)
        if result_path:
            delete_storage_paths(client, settings.supabase_storage_bucket, [result_path])
        raise

    image_url = get_public_url(client, result_path, settings)

    share_url = f"{settings.frontend_base_url.rstrip('/')}/album/{album_id}"

    return AlbumUploadResponse(
        album_id=UUID(album_id),
        meeting_type=meeting_type,  # type: ignore[arg-type]
        template=template,  # type: ignore[arg-type]
        title=title,
        date=event_date,
        narrative=narrative,
        image_url=image_url,
        share_url=share_url,
        created_at=datetime.now(timezone.utc),
    )


@router.get("/albums/{album_id}/photos", response_model=AlbumPhotoUrlsResponse)
async def get_album_photo_urls(
    album_id: str,
    authenticated_user_id: str = Depends(require_authenticated_user),
) -> AlbumPhotoUrlsResponse:
    """Issue short-lived private asset URLs only to the album owner."""
    settings = get_settings()
    client = get_supabase_client(settings)
    record = get_album_record(client, album_id)
    if not record:
        raise HTTPException(status_code=404, detail="앨범을 찾을 수 없습니다.")
    if str(record.get("owner_id") or "") != authenticated_user_id:
        raise HTTPException(status_code=403, detail="You do not have permission to view original photos.")

    photo_urls = [
        AlbumPhotoUrlResponse(
            id=UUID(str(photo["id"])),
            sort_order=int(photo["sort_order"]),
            original_url=get_signed_url(
                client, str(photo["storage_bucket"]), str(photo["storage_path"]), settings.signed_url_ttl_seconds
            ),
            thumbnail_url=get_signed_url(
                client, str(photo["thumbnail_bucket"]), str(photo["thumbnail_path"]), settings.signed_url_ttl_seconds
            ),
        )
        for photo in get_album_photo_records(client, album_id)
    ]
    return AlbumPhotoUrlsResponse(photos=photo_urls)


def _media_summary(record: dict[str, Any]) -> AlbumMediaSummary:
    return AlbumMediaSummary(
        id=UUID(str(record["id"])),
        media_type=record["media_type"],
        mime_type=record["mime_type"],
        original_filename=record.get("original_filename"),
        file_size=int(record["file_size"]),
        width=record.get("width"),
        height=record.get("height"),
        duration_seconds=record.get("duration_seconds"),
        page_count=record.get("page_count"),
        sort_order=int(record["sort_order"]),
        processing_status=record["processing_status"],
        metadata=record.get("metadata") or {},
    )


@router.post("/albums/{album_id}/media", response_model=AlbumMediaUploadResponse, status_code=status.HTTP_201_CREATED)
async def upload_media(
    album_id: str,
    file: UploadFile = File(...),
    sort_order: int = Form(..., ge=0),
    authenticated_user_id: str = Depends(require_authenticated_user),
) -> AlbumMediaUploadResponse:
    """Upload a future-facing media type without exposing private Storage."""
    settings = get_settings()
    client = get_supabase_client(settings)
    album = get_album_record(client, album_id)
    if not album:
        raise HTTPException(status_code=404, detail="앨범을 찾을 수 없습니다.")
    if str(album.get("owner_id") or "") != authenticated_user_id:
        raise HTTPException(status_code=403, detail="You do not have permission to add media.")
    family_id = str(album.get("family_id") or "")
    if not family_id:
        raise HTTPException(status_code=409, detail="이전 앨범은 가족 공간으로 이관한 뒤 미디어를 추가할 수 있습니다.")

    media = process_media_upload(file, settings)
    media_id = str(uuid4())
    original_path = preview_path = thumbnail_path = None
    try:
        original_path, preview_path, thumbnail_path = upload_album_media_assets(
            client, family_id, album_id, media_id, media, settings
        )
        record = {
            "id": media_id,
            "album_id": album_id,
            "uploader_id": authenticated_user_id,
            "media_type": media.media_type,
            "mime_type": media.mime_type,
            "original_filename": file.filename,
            "original_path": original_path,
            "preview_path": preview_path,
            "thumbnail_path": thumbnail_path,
            "file_size": len(media.original_bytes),
            "width": media.width,
            "height": media.height,
            "duration_seconds": media.duration_seconds,
            "page_count": media.page_count,
            "sort_order": sort_order,
            "processing_status": "ready" if media.media_type in {"image", "gif"} else "pending",
            "metadata": {},
        }
        save_album_media_records(client, [record])
    except Exception:
        delete_storage_paths(
            client,
            settings.supabase_private_storage_bucket,
            [path for path in (original_path, preview_path, thumbnail_path) if path],
        )
        raise
    return AlbumMediaUploadResponse(**_media_summary(record).model_dump())


@router.get("/albums/{album_id}/media", response_model=AlbumMediaUrlsResponse)
async def get_album_media_urls(
    album_id: str,
    authenticated_user_id: str = Depends(require_authenticated_user),
) -> AlbumMediaUrlsResponse:
    settings = get_settings()
    client = get_supabase_client(settings)
    album = get_album_record(client, album_id)
    if not album:
        raise HTTPException(status_code=404, detail="앨범을 찾을 수 없습니다.")
    if str(album.get("owner_id") or "") != authenticated_user_id:
        raise HTTPException(status_code=403, detail="You do not have permission to view private media.")

    media_urls = []
    for record in get_album_media_records(client, album_id):
        summary = _media_summary(record)
        media_urls.append(
            AlbumMediaUrlResponse(
                **summary.model_dump(),
                original_url=get_signed_url(client, settings.supabase_private_storage_bucket, record["original_path"], settings.signed_url_ttl_seconds),
                preview_url=(
                    get_signed_url(client, settings.supabase_private_storage_bucket, record["preview_path"], settings.signed_url_ttl_seconds)
                    if record.get("preview_path") else None
                ),
                thumbnail_url=(
                    get_signed_url(client, settings.supabase_private_storage_bucket, record["thumbnail_path"], settings.signed_url_ttl_seconds)
                    if record.get("thumbnail_path") else None
                ),
            )
        )
    return AlbumMediaUrlsResponse(media=media_urls)


@router.delete("/albums/{album_id}/media/{media_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_media(
    album_id: str,
    media_id: str,
    authenticated_user_id: str = Depends(require_authenticated_user),
) -> Response:
    settings = get_settings()
    client = get_supabase_client(settings)
    album = get_album_record(client, album_id)
    if not album:
        raise HTTPException(status_code=404, detail="앨범을 찾을 수 없습니다.")
    if str(album.get("owner_id") or "") != authenticated_user_id:
        raise HTTPException(status_code=403, detail="You do not have permission to delete media.")
    media = get_album_media_record(client, album_id, media_id)
    if not media:
        raise HTTPException(status_code=404, detail="미디어를 찾을 수 없습니다.")
    paths = [path for path in (media.get("original_path"), media.get("preview_path"), media.get("thumbnail_path")) if path]
    client.storage.from_(settings.supabase_private_storage_bucket).remove(paths)
    delete_album_media_record(client, media_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def _record_to_detail(record: dict[str, Any], settings: Settings, client: Any) -> AlbumDetailResponse:
    album_id = str(record["id"])
    image_url = get_public_url(client, record["result_path"], settings) if record.get("result_path") else ""
    return AlbumDetailResponse(
        album_id=UUID(album_id),
        meeting_type=record.get("meeting_type", "friend"),
        template=record.get("template", "B"),
        title=record.get("title", "우리의 모임"),
        date=record.get("event_date", ""),
        narrative=record.get("narrative", ""),
        image_url=image_url,
        share_url=f"{settings.frontend_base_url.rstrip('/')}/album/{album_id}",
        created_at=record["created_at"],
        media=[_media_summary(media) for media in get_album_media_records(client, album_id)],
    )


@router.get("/albums/{album_id}", response_model=AlbumDetailResponse)
async def get_album(album_id: str) -> AlbumDetailResponse:
    settings = get_settings()
    client = get_supabase_client(settings)
    record = get_album_record(client, album_id)
    if not record:
        raise HTTPException(status_code=404, detail="앨범을 찾을 수 없습니다.")
    return _record_to_detail(record, settings, client)


@router.patch("/albums/{album_id}", response_model=AlbumDetailResponse)
async def patch_album(
    album_id: str,
    body: NarrativeUpdate,
    authenticated_user_id: str = Depends(require_authenticated_user),
) -> AlbumDetailResponse:
    settings = get_settings()
    client = get_supabase_client(settings)
    record = get_album_record(client, album_id)
    if not record:
        raise HTTPException(status_code=404, detail="앨범을 찾을 수 없습니다.")
    if str(record.get("owner_id") or "") != authenticated_user_id:
        raise HTTPException(status_code=403, detail="You do not have permission to edit this album.")

    updated = update_album_narrative(client, album_id, body.narrative.strip())
    return _record_to_detail(updated or {**record, "narrative": body.narrative.strip()}, settings, client)


@router.delete("/albums/{album_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_album(
    album_id: str,
    authenticated_user_id: str = Depends(require_authenticated_user),
) -> Response:
    settings = get_settings()
    client = get_supabase_client(settings)
    record = get_album_record(client, album_id)
    if not record:
        raise HTTPException(status_code=404, detail="앨범을 찾을 수 없습니다.")
    if str(record.get("owner_id") or "") != authenticated_user_id:
        raise HTTPException(status_code=403, detail="You do not have permission to delete this album.")

    delete_album_record(client, album_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
