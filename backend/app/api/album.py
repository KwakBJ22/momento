from datetime import datetime, timezone
from typing import Any, get_args
from uuid import UUID, uuid4
import json

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Response, UploadFile, status

from app.config import Settings, get_settings
from app.models.album_styles import layout_for_template_type, normalize_template_type
from app.models.categories import ALBUM_CATEGORIES, meeting_type_for_category, normalize_category
from app.models.schemas import (
    AlbumDetailResponse,
    MyAlbumListItem,
    MyAlbumsResponse,
    AlbumPdfUrlResponse,
    AlbumMediaSummary,
    AlbumMediaUploadResponse,
    AlbumMediaUrlResponse,
    AlbumMediaUrlsResponse,
    AlbumPhotoUrlResponse,
    AlbumPhotoUrlsResponse,
    AlbumPhotoLocationUpdate,
    EpilogueGenerateResponse,
    EpilogueUpdate,
    PhotoCommentResponse,
    PhotoCommentUpdate,
    AlbumUploadResponse,
    MeetingType,
    NarrativeUpdate,
    StoryInputResponse,
    StoryInputUpdate,
    StoryRegenerateResponse,
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
    get_pending_guest_memory_counts,
    get_album_story_inputs,
    get_album_photo_records,
    get_album_media_record,
    get_album_media_records,
    get_public_url,
    list_owned_album_records,
    get_signed_url,
    get_supabase_client,
    save_album_record,
    save_album_photo_records,
    save_album_media_records,
    update_album_epilogue,
    update_album_chapter_stories,
    update_album_narrative,
    update_album_photo_comment,
    bump_album_version,
    upsert_album_story_input,
    upload_album_photo_assets,
    upload_album_media_assets,
    upload_result_image,
)
from app.services.image_upload_service import parse_captured_at, process_upload, validate_upload_limits
from app.services.photo_timeline import cover_date_from_processed, group_photos_by_taken_date, sort_photo_entries
from app.services.media_upload_service import process_media_upload
from app.services.auth import require_authenticated_user
from app.services.authorization import (
    require_album_contribute,
    require_album_delete,
    require_album_edit_settings,
    require_album_owner_story,
    require_album_read,
)
from app.services.membership import (
    get_album_access,
    get_family_membership,
    require_family_write_role,
    save_album_member,
)
from app.services.share_service import create_share_link
from app.services.collaboration_service import get_cached_pdf_path, list_photo_memories, set_cached_pdf_path
from app.services.question_service import format_existing_answers, generate_album_questions
from app.services.story_rules import MIN_DATE_STORY_PHOTO_COUNT, photo_date_key, visible_date_stories

router = APIRouter(prefix="/api", tags=["album"])
PDF_RENDERER_VERSION = 2

_VALID_MEETING_TYPES = set(get_args(MeetingType))
_VALID_TEMPLATES = set(get_args(TemplateType))
_VALID_CATEGORIES = set(ALBUM_CATEGORIES)


@router.post("/upload-album", response_model=AlbumUploadResponse)
async def upload_album(
    photos: list[UploadFile] = File(..., description="최대 10장의 사진"),
    stories: str = Form(..., description='JSON 배열: [{"order":0,"user":"","text":"..."}, ...]'),
    meeting_type: str = Form("friend", description="family/friend/work/university"),
    category: str = Form("", description="family/friend/couple/colleague/pet/travel/other"),
    template: str = Form("", description="레거시 레이아웃 A/B/C (template_type 우선)"),
    template_type: str = Form("", description="warm/joyful/special"),
    title: str = Form("우리의 모임", description="모임 제목"),
    date: str = Form("", description="(deprecated) 사용자 날짜 입력은 사용하지 않음. EXIF로 자동 결정"),
    description: str = Form("", description="선택형 앨범 보강 정보"),
    file_meta: str = Form("[]", description='[{"last_modified": 1710000000000}, ...] File.lastModified'),
    authenticated_user_id: str = Depends(require_authenticated_user),
) -> AlbumUploadResponse:
    settings = get_settings()

    if not photos:
        raise HTTPException(status_code=400, detail="최소 1장의 사진이 필요합니다.")
    if len(photos) > settings.max_photos:
        raise HTTPException(status_code=400, detail=f"사진은 최대 {settings.max_photos}장까지 업로드할 수 있습니다.")

    validate_upload_limits(photos, settings)

    album_category = normalize_category(category) if category.strip() else None
    if category.strip() and album_category not in _VALID_CATEGORIES:
        raise HTTPException(status_code=400, detail="유효하지 않은 추억 유형입니다.")
    if album_category:
        meeting_type = meeting_type_for_category(album_category)
    elif meeting_type not in _VALID_MEETING_TYPES:
        raise HTTPException(status_code=400, detail="유효하지 않은 모임 유형입니다.")
    else:
        album_category = normalize_category(meeting_type)

    album_template_type = normalize_template_type(template_type) if template_type.strip() else None
    if template.strip():
        layout = template.strip().upper()
        if layout not in _VALID_TEMPLATES:
            raise HTTPException(status_code=400, detail="유효하지 않은 템플릿입니다. (A/B/C)")
        if album_template_type is None:
            album_template_type = normalize_template_type(
                {"A": "warm", "B": "joyful", "C": "special"}.get(layout, "warm")
            )
    else:
        album_template_type = album_template_type or normalize_template_type(None)
        layout = layout_for_template_type(album_template_type)

    title = title.strip() or "우리의 모임"
    # date Form은 하위 호환용으로만 받고, 커버 날짜는 EXIF taken_at으로 덮어쓴다.
    _ = date

    story_items = parse_stories_json(stories)
    if len(story_items) != len(photos):
        raise HTTPException(status_code=400, detail="사진 수와 스토리 수가 일치해야 합니다.")

    orders = [item["order"] for item in story_items]
    if len(set(orders)) != len(orders):
        raise HTTPException(status_code=400, detail="story order 값이 중복되었습니다.")
    if sorted(orders) != list(range(len(photos))):
        raise HTTPException(status_code=400, detail="story order는 0부터 연속된 정수여야 합니다.")
    for item in story_items:
        item["text"] = str(item.get("text", "")).strip()

    try:
        meta_list = json.loads(file_meta) if file_meta.strip() else []
        if not isinstance(meta_list, list):
            meta_list = []
    except json.JSONDecodeError:
        meta_list = []

    client = get_supabase_client(settings)
    family_id = ensure_default_family(client, authenticated_user_id)
    family_membership = get_family_membership(client, family_id, authenticated_user_id)
    require_family_write_role(family_membership["role"] if family_membership else None)
    album_id = create_album_id()

    items_by_order: dict[int, dict[str, Any]] = {int(item["order"]): item for item in story_items}
    entries: list[dict[str, Any]] = []
    for upload_order, photo in enumerate(photos):
        raw_meta = meta_list[upload_order] if upload_order < len(meta_list) and isinstance(meta_list[upload_order], dict) else {}
        captured_at = parse_captured_at(raw_meta.get("captured_at"))
        processed = process_upload(photo, settings, captured_at=captured_at)
        entries.append(
            {
                "processed": processed,
                "upload": photo,
                "story": dict(items_by_order[upload_order]),
                "upload_order": upload_order,
            }
        )
    entries = sort_photo_entries(entries)
    _day_groups = group_photos_by_taken_date(entries)  # structure for future day UI
    event_date = cover_date_from_processed([entry["processed"] for entry in entries])

    uploaded_private_paths: list[str] = []
    result_path = ""
    album_saved = False

    try:
        photo_records: list[dict[str, Any]] = []
        media_records: list[dict[str, Any]] = []
        photo_paths: list[str] = []
        ordered_bytes: list[bytes] = []
        ordered_stories: list[dict[str, Any]] = []
        for entry in entries:
            processed = entry["processed"]
            sort_order = int(entry["sort_order"])
            story = entry["story"]
            upload = entry["upload"]
            photo_id = str(uuid4())
            original_path, thumbnail_path = upload_album_photo_assets(
                client, family_id, album_id, photo_id, processed, settings
            )
            uploaded_private_paths.extend([original_path, thumbnail_path])
            photo_paths.append(original_path)
            story["_path"] = original_path
            story["order"] = sort_order
            ordered_bytes.append(processed.display_bytes)
            ordered_stories.append(story)
            taken_at_iso = processed.taken_at.isoformat() if processed.taken_at else None
            photo_records.append(
                {
                    "id": photo_id,
                    "album_id": album_id,
                    "storage_bucket": settings.supabase_private_storage_bucket,
                    "storage_path": original_path,
                    "thumbnail_bucket": settings.supabase_private_storage_bucket,
                    "thumbnail_path": thumbnail_path,
                    "original_filename": upload.filename,
                    "mime_type": processed.original_mime_type,
                    "byte_size": len(processed.original_bytes),
                    "checksum_sha256": processed.checksum_sha256,
                    "sort_order": sort_order,
                    "caption": story["text"],
                    "comment": story["text"].strip() or None,
                    "contributor_profile_id": authenticated_user_id,
                    "legacy_author_label": story["user"] or None,
                    "status": "ready",
                    "taken_at": taken_at_iso,
                    "latitude": processed.latitude,
                    "longitude": processed.longitude,
                    "location_name": None,
                    "location_source": (
                        "exif"
                        if processed.latitude is not None and processed.longitude is not None
                        else "unknown"
                    ),
                    "orientation": processed.orientation,
                    "width": processed.width or None,
                    "height": processed.height or None,
                }
            )
            media_records.append(
                {
                    "id": photo_id,
                    "album_id": album_id,
                    "uploader_id": authenticated_user_id,
                    "media_type": "gif" if processed.original_mime_type == "image/gif" else "image",
                    "mime_type": processed.original_mime_type,
                    "original_filename": upload.filename,
                    "original_path": original_path,
                    "thumbnail_path": thumbnail_path,
                    "file_size": len(processed.original_bytes),
                    "width": processed.width or None,
                    "height": processed.height or None,
                    "sort_order": sort_order,
                    "processing_status": "ready",
                    "taken_at": taken_at_iso,
                    "latitude": processed.latitude,
                    "longitude": processed.longitude,
                    "orientation": processed.orientation,
                    "metadata": {
                        "source": "album_photos",
                        "datetime_original": processed.datetime_original,
                        "create_date": processed.create_date,
                        "upload_order": entry["upload_order"],
                        "day_group_count": len(_day_groups),
                        "location_source": (
                            "exif"
                            if processed.latitude is not None and processed.longitude is not None
                            else "unknown"
                        ),
                    },
                }
            )

        # 에필로그는 owner가 AI/직접 작성. 업로드 시 AI 호출하지 않음.
        narrative = await generate_narrative(
            ordered_stories, meeting_type, title, settings,
            event_date=event_date,
            description="Create the album's closing story from the uploaded photos and captions.",
            existing_answers="", media_records=media_records, category=album_category,
            template_type=album_template_type, client=client, album_id=album_id,
            family_id=family_id, actor_profile_id=authenticated_user_id,
        )
        chapter_inputs: dict[str, list[dict[str, Any]]] = {}
        for index, story in enumerate(ordered_stories):
            key = photo_date_key(photo_records[index])
            if key != "0":
                chapter_inputs.setdefault(key, []).append(story)
        chapter_stories: dict[str, str] = {}
        for key, stories_for_date in chapter_inputs.items():
            if len(stories_for_date) < MIN_DATE_STORY_PHOTO_COUNT:
                continue
            chapter_stories[key] = await generate_narrative(
                stories_for_date, meeting_type, title, settings,
                event_date=key if key != "0" else event_date,
                description="Create one factual date episode in 3 to 6 short Korean lines. No heading.",
                existing_answers="", media_records=[], category=album_category,
                template_type=album_template_type, client=client, album_id=album_id,
                family_id=family_id, actor_profile_id=authenticated_user_id,
            )
        album_img = generate_album(
            layout,
            photos=bytes_to_images(ordered_bytes),
            stories=ordered_stories,
            title=title,
            date=event_date,
            narrative=None,
        )
        result_path = upload_result_image(client, album_id, image_to_png_bytes(album_img), settings)
        photo_meta = [
            {
                "order": item["order"],
                "user": item["user"],
                "text": item["text"],
                "path": item["_path"],
                "taken_at": photo_records[index].get("taken_at"),
            }
            for index, item in enumerate(ordered_stories)
        ]
        save_album_record(
            client,
            album_id=album_id,
            owner_id=authenticated_user_id,
            family_id=family_id,
            meeting_type=meeting_type,
            template=layout,
            title=title,
            event_date=event_date,
            # 에필로그만 유지. AI 초안은 만들지 않고 owner가 AI/직접 작성.
            narrative=narrative,
            epilogue=narrative,
            chapter_stories=chapter_stories,
            photo_paths=photo_paths,
            photo_meta=photo_meta,
            result_path=result_path,
            category=album_category,
            template_type=album_template_type,
        )
        album_saved = True
        save_album_photo_records(client, photo_records)
        save_album_media_records(client, media_records)
        save_album_member(
            client,
            album_id=album_id,
            profile_id=authenticated_user_id,
            role="owner",
            invited_by=authenticated_user_id,
        )
        try:
            await generate_album_questions(
                client,
                album_id=album_id,
                album={
                    "id": album_id,
                    "title": title,
                    "event_date": event_date,
                    "meeting_type": meeting_type,
                    "narrative": narrative,
                },
                media_records=media_records,
                force=False,
                settings=settings,
            )
        except HTTPException:
            # Album creation should still succeed; the client can retry question generation.
            pass
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
    _, share_token = create_share_link(client, album_id, authenticated_user_id, None)
    share_url = f"{settings.frontend_base_url.rstrip('/')}/s/{share_token}"

    photo_urls = [
        AlbumPhotoUrlResponse(
            id=UUID(str(photo["id"])),
            sort_order=int(photo["sort_order"]),
            comment=str(photo.get("comment") or "").strip() or None,
            original_url=get_signed_url(
                client, str(photo["storage_bucket"]), str(photo["storage_path"]), settings.signed_url_ttl_seconds
            ),
            thumbnail_url=get_signed_url(
                client, str(photo["thumbnail_bucket"]), str(photo["thumbnail_path"]), settings.signed_url_ttl_seconds
            ),
            width=next((m.get("width") for m in media_records if str(m["id"]) == str(photo["id"])), None),
            height=next((m.get("height") for m in media_records if str(m["id"]) == str(photo["id"])), None),
            taken_at=next((m.get("taken_at") for m in media_records if str(m["id"]) == str(photo["id"])), None),
            latitude=photo.get("latitude"),
            longitude=photo.get("longitude"),
            location_name=photo.get("location_name"),
            location_source=photo.get("location_source"),
            orientation=next((m.get("orientation") for m in media_records if str(m["id"]) == str(photo["id"])), None)
            or photo.get("orientation"),
        )
        for photo in photo_records
    ]

    return AlbumUploadResponse(
        album_id=UUID(album_id),
        meeting_type=meeting_type,  # type: ignore[arg-type]
        category=album_category,
        template=layout,  # type: ignore[arg-type]
        template_type=album_template_type,
        title=title,
        date=event_date,
        narrative=narrative,
        epilogue=narrative,
        chapter_stories=chapter_stories,
        image_url=image_url,
        share_url=share_url,
        created_at=datetime.now(timezone.utc),
        saved=True,
        photos=photo_urls,
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
    access = get_album_access(client, record, authenticated_user_id)
    require_album_read(access)

    media_by_id = {str(media["id"]): media for media in get_album_media_records(client, album_id)}
    photo_urls = [
        AlbumPhotoUrlResponse(
            id=UUID(str(photo["id"])),
            sort_order=int(photo["sort_order"]),
            comment=str(photo.get("comment") or "").strip() or None,
            original_url=get_signed_url(
                client, str(photo["storage_bucket"]), str(photo["storage_path"]), settings.signed_url_ttl_seconds
            ),
            thumbnail_url=get_signed_url(
                client, str(photo["thumbnail_bucket"]), str(photo["thumbnail_path"]), settings.signed_url_ttl_seconds
            ),
            width=photo.get("width") if photo.get("width") is not None else (media_by_id.get(str(photo["id"])) or {}).get("width"),
            height=photo.get("height") if photo.get("height") is not None else (media_by_id.get(str(photo["id"])) or {}).get("height"),
            taken_at=photo.get("taken_at") or (media_by_id.get(str(photo["id"])) or {}).get("taken_at"),
            latitude=photo.get("latitude") if photo.get("latitude") is not None else (media_by_id.get(str(photo["id"])) or {}).get("latitude"),
            longitude=photo.get("longitude") if photo.get("longitude") is not None else (media_by_id.get(str(photo["id"])) or {}).get("longitude"),
            location_name=photo.get("location_name"),
            location_source=photo.get("location_source"),
            orientation=photo.get("orientation") or (media_by_id.get(str(photo["id"])) or {}).get("orientation"),
        )
        for photo in get_album_photo_records(client, album_id)
    ]
    return AlbumPhotoUrlsResponse(photos=photo_urls)


@router.patch("/albums/{album_id}/photos/{photo_id}/location", response_model=AlbumPhotoUrlResponse)
async def update_photo_location(
    album_id: str,
    photo_id: str,
    body: AlbumPhotoLocationUpdate,
    authenticated_user_id: str = Depends(require_authenticated_user),
) -> AlbumPhotoUrlResponse:
    """사용자가 사진 장소를 직접 수정."""
    settings = get_settings()
    client = get_supabase_client(settings)
    album = get_album_record(client, album_id)
    if not album:
        raise HTTPException(status_code=404, detail="앨범을 찾을 수 없습니다.")
    access = get_album_access(client, album, authenticated_user_id)
    require_album_contribute(access)

    name = (body.location_name or "").strip() or None
    payload: dict[str, Any] = {
        "location_name": name,
        "location_source": body.location_source if name or body.latitude is not None else "unknown",
    }
    if body.latitude is not None:
        payload["latitude"] = body.latitude
    if body.longitude is not None:
        payload["longitude"] = body.longitude
    if not name and body.latitude is None and body.longitude is None:
        payload["location_source"] = "unknown"

    updated = (
        client.table("album_photos")
        .update(payload)
        .eq("id", photo_id)
        .eq("album_id", album_id)
        .execute()
    )
    rows = updated.data or []
    if not rows:
        raise HTTPException(status_code=404, detail="사진을 찾을 수 없습니다.")
    photo = rows[0]
    return AlbumPhotoUrlResponse(
        id=UUID(str(photo["id"])),
        sort_order=int(photo.get("sort_order") or 0),
        comment=str(photo.get("comment") or "").strip() or None,
        original_url=get_signed_url(
            client, str(photo["storage_bucket"]), str(photo["storage_path"]), settings.signed_url_ttl_seconds
        ),
        thumbnail_url=get_signed_url(
            client, str(photo["thumbnail_bucket"]), str(photo["thumbnail_path"]), settings.signed_url_ttl_seconds
        ),
        width=photo.get("width"),
        height=photo.get("height"),
        taken_at=photo.get("taken_at"),
        latitude=photo.get("latitude"),
        longitude=photo.get("longitude"),
        location_name=photo.get("location_name"),
        location_source=photo.get("location_source"),
        orientation=photo.get("orientation"),
    )


@router.patch("/albums/{album_id}/photos/{photo_id}/comment", response_model=PhotoCommentResponse)
async def save_photo_comment(
    album_id: str,
    photo_id: str,
    body: PhotoCommentUpdate,
    authenticated_user_id: str = Depends(require_authenticated_user),
) -> PhotoCommentResponse:
    client = get_supabase_client()
    album = get_album_record(client, album_id)
    if not album:
        raise HTTPException(status_code=404, detail="앨범을 찾을 수 없습니다.")
    access = get_album_access(client, album, authenticated_user_id)
    require_album_contribute(access)
    comment = body.comment.strip() if body.comment else None
    saved = update_album_photo_comment(client, album_id=album_id, photo_id=photo_id, comment=comment)
    if not saved:
        raise HTTPException(status_code=404, detail="사진을 찾을 수 없습니다.")
    return PhotoCommentResponse(id=UUID(str(saved["id"])), comment=saved.get("comment"))


_STORY_INPUT_KEYS = {"memory_hint", "people", "highlight"}


@router.put("/albums/{album_id}/story-inputs/{input_key}", response_model=StoryInputResponse)
async def save_story_input(
    album_id: str,
    input_key: str,
    body: StoryInputUpdate,
    authenticated_user_id: str = Depends(require_authenticated_user),
) -> StoryInputResponse:
    if input_key not in _STORY_INPUT_KEYS:
        raise HTTPException(status_code=404, detail="알 수 없는 보강 입력입니다.")
    client = get_supabase_client()
    album = get_album_record(client, album_id)
    if not album:
        raise HTTPException(status_code=404, detail="앨범을 찾을 수 없습니다.")
    access = get_album_access(client, album, authenticated_user_id)
    require_album_contribute(access)
    saved = upsert_album_story_input(
        client,
        album_id=album_id,
        author_profile_id=authenticated_user_id,
        input_key=input_key,
        value=body.value,
    )
    return StoryInputResponse(key=input_key, value=str(saved.get("value") or ""))


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
    access = get_album_access(client, album, authenticated_user_id)
    require_album_contribute(access)
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
    access = get_album_access(client, album, authenticated_user_id)
    require_album_read(access)

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
    access = get_album_access(client, album, authenticated_user_id)
    require_album_contribute(access)
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
    epilogue = str(record.get("epilogue") or record.get("narrative") or "").strip()
    chapter_stories = visible_date_stories(
        record.get("chapter_stories"),
        get_album_photo_records(client, album_id),
    )
    return AlbumDetailResponse(
        album_id=UUID(album_id),
        meeting_type=record.get("meeting_type", "friend"),
        category=record.get("category"),
        template=record.get("template", "B"),
        template_type=normalize_template_type(record.get("template_type")),
        title=record.get("title", "우리의 모임"),
        date=record.get("event_date", ""),
        narrative=epilogue,
        epilogue=epilogue,
        chapter_stories=chapter_stories,
        image_url=image_url,
        share_url=f"{settings.frontend_base_url.rstrip('/')}/album/{album_id}",
        created_at=record["created_at"],
        media=[_media_summary(media) for media in get_album_media_records(client, album_id)],
        album_version=int(record.get("album_version") or 0),
        saved=True,
    )


@router.get("/albums/mine", response_model=MyAlbumsResponse)
async def get_my_albums(
    authenticated_user_id: str = Depends(require_authenticated_user),
) -> MyAlbumsResponse:
    """List the signed-in creator's albums without exposing family/member albums."""
    settings = get_settings()
    client = get_supabase_client(settings)
    records = list_owned_album_records(client, authenticated_user_id)
    memory_counts = get_pending_guest_memory_counts(client, [str(record["id"]) for record in records])
    return MyAlbumsResponse(
        albums=[
            MyAlbumListItem(
                album_id=UUID(str(record["id"])),
                title=str(record.get("title") or "우리의 추억"),
                created_at=record["created_at"],
                image_url=get_public_url(client, str(record["result_path"]), settings) if record.get("result_path") else "",
                photo_count=len(record.get("photo_paths") or []),
                new_memory_count=memory_counts.get(str(record["id"]), 0),
            )
            for record in records
        ]
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
    """Legacy: updates epilogue only (owner)."""
    settings = get_settings()
    client = get_supabase_client(settings)
    record = get_album_record(client, album_id)
    if not record:
        raise HTTPException(status_code=404, detail="앨범을 찾을 수 없습니다.")
    access = get_album_access(client, record, authenticated_user_id)
    require_album_owner_story(access)

    epilogue = body.narrative.strip()
    updated = update_album_narrative(client, album_id, epilogue)
    return _record_to_detail(updated or {**record, "epilogue": epilogue, "narrative": epilogue}, settings, client)


@router.patch("/albums/{album_id}/epilogue", response_model=AlbumDetailResponse)
async def patch_epilogue(
    album_id: str,
    body: EpilogueUpdate,
    authenticated_user_id: str = Depends(require_authenticated_user),
) -> AlbumDetailResponse:
    settings = get_settings()
    client = get_supabase_client(settings)
    record = get_album_record(client, album_id)
    if not record:
        raise HTTPException(status_code=404, detail="앨범을 찾을 수 없습니다.")
    access = get_album_access(client, record, authenticated_user_id)
    require_album_owner_story(access)

    epilogue = body.epilogue.strip()
    updated = update_album_epilogue(client, album_id, epilogue)
    return _record_to_detail(updated or {**record, "epilogue": epilogue, "narrative": epilogue}, settings, client)


@router.post("/albums/{album_id}/epilogue/generate", response_model=EpilogueGenerateResponse)
async def generate_epilogue(
    album_id: str,
    authenticated_user_id: str = Depends(require_authenticated_user),
) -> EpilogueGenerateResponse:
    """앨범 전체 사진·메모를 종합한 에필로그 1개 생성."""
    settings = get_settings()
    client = get_supabase_client(settings)
    album = get_album_record(client, album_id)
    if not album:
        raise HTTPException(status_code=404, detail="앨범을 찾을 수 없습니다.")
    access = get_album_access(client, album, authenticated_user_id)
    require_album_owner_story(access)

    existing = str(album.get("epilogue") or "").strip()
    photo_records = get_album_photo_records(client, album_id)
    photo_stories = [
        {
            "order": int(item.get("sort_order") or index),
            "user": "",
            "text": str(item.get("comment") or ""),
        }
        for index, item in enumerate(photo_records)
    ]
    # 협업 메모도 함께 전달
    for mem in list_photo_memories(client, album_id):
        text = str(mem.get("comment") or "").strip()
        if text:
            photo_stories.append(
                {
                    "order": len(photo_stories),
                    "user": str(mem.get("author_name") or ""),
                    "text": text,
                }
            )
    description = (
        "앨범 전체를 마무리하는 하나의 에필로그만 작성하세요. "
        "챕터별 요약이나 개별 사진 설명을 나열하지 마세요. "
        "모든 사진과 메모를 참고해 자연스러운 마무리 글을 쓰세요. "
        "기존 문장을 그대로 반복하지 마세요."
    )
    if existing:
        description += f"\n(참고: 사용자가 이미 남긴 초안이 있으면 덮어쓸 새 초안을 작성합니다.)\n초안: {existing[:200]}"

    generated = await generate_narrative(
        photo_stories,
        str(album.get("meeting_type") or "family"),
        str(album.get("title") or "우리의 모임"),
        settings,
        event_date=str(album.get("event_date") or ""),
        description=description,
        existing_answers=format_existing_answers(client, album_id),
        media_records=get_album_media_records(client, album_id),
        category=str(album.get("category") or "") or None,
        template_type=str(album.get("template_type") or "") or None,
        client=client,
        album_id=album_id,
        family_id=str(album.get("family_id") or "") or None,
        actor_profile_id=authenticated_user_id,
    )
    text = generated.strip()
    if not text:
        return EpilogueGenerateResponse(
            epilogue="",
            warning="이야기를 만들지 못했어요. 다시 시도해 주세요.",
            rejected=True,
        )
    update_album_epilogue(client, album_id, text)

    chapter_inputs: dict[str, list[dict[str, Any]]] = {}
    for index, photo in enumerate(photo_records):
        key = photo_date_key(photo)
        if key == "0":
            continue
        chapter_inputs.setdefault(key, []).append({
            "order": int(photo.get("sort_order") or index),
            "user": "",
            "text": str(photo.get("comment") or "").strip(),
        })

    chapter_stories: dict[str, str] = {}
    for key, date_photos in chapter_inputs.items():
        if len(date_photos) < MIN_DATE_STORY_PHOTO_COUNT:
            continue
        date_label = key if key != "0" else str(album.get("event_date") or "")
        date_description = (
            "Write one short date episode for this album section. Use only the supplied "
            "photo captions and media facts. Do not write a caption for each photo, do not "
            "invent details, and return 3 to 6 natural Korean lines without a heading."
        )
        try:
            chapter_text = await generate_narrative(
                date_photos,
                str(album.get("meeting_type") or "family"),
                str(album.get("title") or "Momento"),
                settings,
                event_date=date_label,
                description=date_description,
                existing_answers="",
                media_records=[],
                category=str(album.get("category") or "") or None,
                template_type=str(album.get("template_type") or "") or None,
                client=client,
                album_id=album_id,
                family_id=str(album.get("family_id") or "") or None,
                actor_profile_id=authenticated_user_id,
            )
        except Exception:
            continue
        if chapter_text.strip():
            chapter_stories[key] = chapter_text.strip()

    if chapter_stories:
        update_album_chapter_stories(client, album_id, chapter_stories)
    return EpilogueGenerateResponse(
        epilogue=text,
        chapter_stories=chapter_stories,
        warning=None,
        rejected=False,
    )


@router.post("/albums/{album_id}/story/regenerate", response_model=StoryRegenerateResponse)
async def regenerate_story(
    album_id: str,
    authenticated_user_id: str = Depends(require_authenticated_user),
) -> StoryRegenerateResponse:
    """Legacy alias → epilogue AI generate."""
    result = await generate_epilogue(album_id, authenticated_user_id)
    if result.rejected:
        raise HTTPException(status_code=409, detail=result.warning or "이야기를 만들지 못했어요.")
    return StoryRegenerateResponse(narrative=result.epilogue)


@router.get("/albums/{album_id}/pdf", response_model=AlbumPdfUrlResponse)
async def get_album_pdf(
    album_id: str,
    version: int | None = Query(default=None),
    renderer_version: int = Query(default=PDF_RENDERER_VERSION),
    authenticated_user_id: str = Depends(require_authenticated_user),
) -> AlbumPdfUrlResponse:
    settings = get_settings()
    client = get_supabase_client(settings)
    record = get_album_record(client, album_id)
    if not record:
        raise HTTPException(status_code=404, detail="앨범을 찾을 수 없습니다.")
    access = get_album_access(client, record, authenticated_user_id)
    require_album_read(access)

    album_version = int(record.get("album_version") or 0)
    target_version = version if version is not None else album_version
    cached_path = get_cached_pdf_path(record, f"{target_version}:r{renderer_version}")
    if not cached_path:
        return AlbumPdfUrlResponse(url=None, album_version=album_version, cached=False)

    url = get_public_url(client, cached_path, settings)
    return AlbumPdfUrlResponse(url=url, album_version=album_version, cached=True)


@router.put("/albums/{album_id}/pdf")
async def upload_album_pdf(
    album_id: str,
    version: int = Query(...),
    renderer_version: int = Query(default=PDF_RENDERER_VERSION),
    file: UploadFile = File(...),
    authenticated_user_id: str = Depends(require_authenticated_user),
) -> AlbumPdfUrlResponse:
    settings = get_settings()
    client = get_supabase_client(settings)
    record = get_album_record(client, album_id)
    if not record:
        raise HTTPException(status_code=404, detail="앨범을 찾을 수 없습니다.")
    access = get_album_access(client, record, authenticated_user_id)
    require_album_read(access)

    if version != int(record.get("album_version") or 0):
        raise HTTPException(status_code=409, detail="앨범 버전이 변경되었어요. PDF를 다시 생성해 주세요.")

    content = await file.read()
    if not content.startswith(b"%PDF"):
        raise HTTPException(status_code=400, detail="PDF 파일이 아닙니다.")

    path = f"albums/{album_id}/pdf/v{version}-r{renderer_version}.pdf"
    client.storage.from_(settings.supabase_storage_bucket).upload(
        path,
        content,
        {"content-type": "application/pdf", "upsert": "true"},
    )
    set_cached_pdf_path(client, record, f"{version}:r{renderer_version}", path)
    url = get_public_url(client, path, settings)
    return AlbumPdfUrlResponse(url=url, album_version=version, cached=True)


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
    access = get_album_access(client, record, authenticated_user_id)
    require_album_delete(access)

    delete_album_record(client, album_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
