from __future__ import annotations

import logging
import time
from collections import defaultdict, deque
from datetime import datetime, timezone
from functools import wraps
from typing import Any
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from postgrest.exceptions import APIError

from app.config import get_settings
from app.models.album_styles import layout_for_template_type, normalize_template_type
from app.models.categories import ALBUM_CATEGORIES, meeting_type_for_category, normalize_category
from app.models.schemas import (
    AlbumPhotoUrlResponse,
    GuestAlbumClaimRequest,
    GuestAlbumUploadResponse,
    GuestAnalyticsEventRequest,
)
from app.services.auth import require_authenticated_user
from app.services.guest_service import claim_guest_album, create_guest_session
from app.services.image_service import bytes_to_images, generate_album, image_to_png_bytes
from app.services.image_upload_service import parse_captured_at, process_upload, validate_upload_limits
from app.services.openai_service import generate_narrative, parse_stories_json
from app.services.photo_timeline import cover_date_from_processed, group_photos_by_taken_date, sort_photo_entries
from app.services.share_service import create_share_link, log_event
from app.services.story_rules import MIN_DATE_STORY_PHOTO_COUNT, photo_date_key
from app.services.supabase import (
    create_album_id,
    cleanup_incomplete_album,
    delete_storage_paths,
    ensure_default_family,
    get_album_record,
    get_signed_url,
    get_supabase_client,
    save_album_media_records,
    save_album_photo_records,
    save_album_record,
    set_album_creation_status,
    upload_album_photo_assets,
    upload_result_image,
)
import json

router = APIRouter(prefix="/api", tags=["guest-onboarding"])
logger = logging.getLogger(__name__)
_GUEST_UPLOADS: dict[str, deque[float]] = defaultdict(deque)
_WINDOW_SECONDS = 60
_MAX_UPLOADS_PER_WINDOW = 3


def _claim_error_details(handler):
    @wraps(handler)
    async def wrapped(*args, **kwargs):
        try:
            return await handler(*args, **kwargs)
        except HTTPException as exc:
            logger.warning("guest_album_claim_rejected status=%s detail=%s", exc.status_code, exc.detail)
            raise
        except APIError as exc:
            detail = str(getattr(exc, "message", None) or exc)
            logger.exception("guest_album_claim_supabase_failed detail=%s", detail)
            raise HTTPException(status_code=502, detail=f"Guest album claim database error: {detail}") from exc
        except (KeyError, TypeError, ValueError) as exc:
            detail = str(exc)
            logger.exception("guest_album_claim_data_failed detail=%s", detail)
            raise HTTPException(status_code=409, detail=f"Guest album claim data error: {detail}") from exc
        except Exception as exc:
            detail = str(exc)
            logger.exception("guest_album_claim_failed detail=%s", detail)
            raise HTTPException(status_code=500, detail=f"Guest album claim failed: {detail}") from exc
    return wrapped


def _upload_file_metadata(files: list[UploadFile]) -> list[dict[str, str | int | None]]:
    """Return safe diagnostics only; never read or log binary upload content."""
    metadata: list[dict[str, str | int | None]] = []
    for upload in files:
        try:
            position = upload.file.tell()
            upload.file.seek(0, 2)
            size = upload.file.tell()
            upload.file.seek(position)
        except (AttributeError, OSError):
            size = None
        metadata.append({"filename": upload.filename, "mime_type": upload.content_type, "size_bytes": size})
    return metadata


def _allow_guest_upload(request: Request) -> None:
    """Small in-process backstop; production should also enforce this at the edge."""
    key = request.client.host if request.client else "unknown"
    now = time.monotonic()
    attempts = _GUEST_UPLOADS[key]
    while attempts and attempts[0] <= now - _WINDOW_SECONDS:
        attempts.popleft()
    if len(attempts) >= _MAX_UPLOADS_PER_WINDOW:
        raise HTTPException(status_code=429, detail="잠시 후 다시 시도해주세요.")
    attempts.append(now)


def _safe_event(client: Any, event_name: str, album_id: str | None = None) -> bool:
    return log_event(client, event_name, album_id=album_id, metadata={"source": "guest_onboarding"})


@router.post("/guest-analytics", status_code=202)
async def track_guest_event(payload: GuestAnalyticsEventRequest) -> None:
    """Accept only an allowlisted event name; analytics never blocks the client."""
    try:
        ok = _safe_event(get_supabase_client(get_settings()), payload.event_name)
        if ok:
            logger.info("guest_analytics_accepted event_name=%s inserted=true", payload.event_name)
        else:
            logger.warning("guest_analytics_accepted event_name=%s inserted=false", payload.event_name)
    except Exception:
        logger.warning("guest_analytics_accepted event_name=%s inserted=false reason=client_error", payload.event_name)


@router.post("/guest/upload-album", response_model=GuestAlbumUploadResponse)
async def upload_guest_album(
    request: Request,
    photos: list[UploadFile] = File(...),
    stories: str = Form("[]"),
    meeting_type: str = Form("family"),
    category: str = Form(""),
    template: str = Form(""),
    template_type: str = Form(""),
    title: str = Form("우리의 추억"),
    description: str = Form(""),
    file_meta: str = Form("[]"),
    cover_photo_order: int = Form(-1),
    website: str = Form(""),
) -> GuestAlbumUploadResponse:
    started_at = time.perf_counter()
    request_id = str(uuid4())
    file_metadata = _upload_file_metadata(photos)
    logger.info(
        "guest_upload_request_received request_id=%s photo_count=%s content_length=%s",
        request_id,
        len(photos),
        request.headers.get("content-length"),
    )
    logger.info("guest_upload_files_parsed request_id=%s files=%s", request_id, file_metadata)
    if website.strip():
        raise HTTPException(status_code=400, detail="요청을 처리할 수 없어요.")
    _allow_guest_upload(request)
    settings = get_settings()
    total_upload_bytes = sum(int(item["size_bytes"] or 0) for item in file_metadata)
    if not photos:
        raise HTTPException(status_code=400, detail="최소 1장의 사진이 필요합니다.")
    if len(photos) > settings.max_photos:
        raise HTTPException(status_code=400, detail=f"사진은 최대 {settings.max_photos}장까지 업로드할 수 있습니다.")
    validate_upload_limits(photos, settings)
    album_category = normalize_category(category) if category.strip() else normalize_category(meeting_type)
    if album_category not in ALBUM_CATEGORIES and meeting_type not in {"family", "friend", "work", "university"}:
        raise HTTPException(status_code=400, detail="앨범 설정을 확인해주세요.")
    if category.strip():
        meeting_type = meeting_type_for_category(album_category)
    elif meeting_type not in {"family", "friend", "work", "university"}:
        raise HTTPException(status_code=400, detail="앨범 설정을 확인해주세요.")
    album_template_type = normalize_template_type(template_type) if template_type.strip() else None
    if template.strip():
        layout = template.strip().upper()
        if layout not in {"A", "B", "C"}:
            raise HTTPException(status_code=400, detail="앨범 설정을 확인해주세요.")
        if album_template_type is None:
            album_template_type = normalize_template_type(
                {"A": "warm", "B": "joyful", "C": "special"}.get(layout, "warm")
            )
    else:
        album_template_type = album_template_type or normalize_template_type(None)
        layout = layout_for_template_type(album_template_type)

    try:
        story_items = parse_stories_json(stories)
    except HTTPException:
        story_items = []
    if not story_items:
        story_items = [{"order": index, "user": "", "text": ""} for index in range(len(photos))]
    if len(story_items) != len(photos) or sorted(int(item.get("order", -1)) for item in story_items) != list(range(len(photos))):
        raise HTTPException(status_code=400, detail="사진 순서를 다시 확인해주세요.")
    for item in story_items:
        item["text"] = str(item.get("text", "")).strip()
        item["user"] = str(item.get("user", "")).strip()

    logger.info(
        "guest_upload_validation_completed request_id=%s photo_count=%s total_upload_bytes=%s",
        request_id,
        len(photos),
        total_upload_bytes,
    )
    client = get_supabase_client(settings)
    _safe_event(client, "upload_started")
    operation_id = (request.headers.get("X-Momento-Operation-Id") or "").strip()
    try:
        album_id = str(UUID(operation_id)) if operation_id else create_album_id()
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid album creation operation.")
    if get_album_record(client, album_id):
        raise HTTPException(status_code=409, detail="This album creation request is already being processed.")
    guest_scope_id = str(uuid4())
    title = title.strip() or "우리의 추억"
    try:
        meta_list = json.loads(file_meta) if file_meta.strip() else []
        if not isinstance(meta_list, list):
            meta_list = []
    except json.JSONDecodeError:
        meta_list = []

    entries: list[dict[str, Any]] = []
    for upload_order, photo in enumerate(photos):
        raw_meta = meta_list[upload_order] if upload_order < len(meta_list) and isinstance(meta_list[upload_order], dict) else {}
        captured_at = parse_captured_at(raw_meta.get("captured_at"))
        try:
            processed = process_upload(photo, settings, captured_at=captured_at)
        except Exception:
            logger.exception(
                "guest_upload_failed request_id=%s stage=image_processing files=%s",
                request_id,
                file_metadata,
            )
            raise
        entries.append(
            {
                "processed": processed,
                "upload": photo,
                "story": dict(story_items[upload_order]),
                "upload_order": upload_order,
            }
        )
    entries = sort_photo_entries(entries)
    _day_groups = group_photos_by_taken_date(entries)
    event_date = cover_date_from_processed([entry["processed"] for entry in entries])
    uploaded_paths: list[str] = []
    result_path = ""
    album_saved = False
    share_url = ""
    try:
        photo_records: list[dict[str, Any]] = []
        media_records: list[dict[str, Any]] = []
        photo_paths: list[str] = []
        ordered_bytes: list[bytes] = []
        ordered_stories: list[dict[str, Any]] = []
        logger.info("guest_upload_storage_upload_started request_id=%s album_id=%s", request_id, album_id)
        for entry in entries:
            processed = entry["processed"]
            sort_order = int(entry["sort_order"])
            story = entry["story"]
            upload = entry["upload"]
            photo_id = str(uuid4())
            original_path, thumbnail_path = upload_album_photo_assets(client, guest_scope_id, album_id, photo_id, processed, settings)
            uploaded_paths.extend([original_path, thumbnail_path])
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
                        "source": "guest_onboarding",
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
        # 에필로그는 비워 두고 owner가 AI/직접 작성
        logger.info("guest_upload_storage_upload_completed request_id=%s album_id=%s", request_id, album_id)
        cover_photo_id = next(
            (str(record["id"]) for entry, record in zip(entries, photo_records) if int(entry["upload_order"]) == cover_photo_order),
            str(photo_records[0]["id"]),
        )
        narrative = await generate_narrative(
            ordered_stories, meeting_type, title, settings,
            event_date=event_date,
            description="Create the album's closing story from the uploaded photos and captions.",
            existing_answers="", media_records=media_records, category=album_category,
            template_type=album_template_type, client=client, album_id=album_id,
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
            )
        album_photos = bytes_to_images(ordered_bytes)
        try:
            image = generate_album(
                layout,
                photos=album_photos,
                stories=ordered_stories,
                title=title,
                date=event_date,
                narrative=None,
            )
        finally:
            for album_photo in album_photos:
                album_photo.close()
        try:
            result_bytes = image_to_png_bytes(image)
        finally:
            image.close()
        result_path = upload_result_image(client, album_id, result_bytes, settings)
        save_album_record(
            client,
            album_id,
            None,
            None,
            meeting_type,
            layout,
            title,
            event_date,
            "",
            photo_paths,
            [{"order": item["order"], "user": item["user"], "text": item["text"], "path": item["_path"], "taken_at": photo_records[index].get("taken_at")} for index, item in enumerate(ordered_stories)],
            result_path,
            category=album_category,
            template_type=album_template_type,
            epilogue=narrative,
            chapter_stories=chapter_stories,
            cover_photo_id=cover_photo_id,
            result_bucket=settings.supabase_private_storage_bucket,
            creation_status="processing",
        )
        album_saved = True
        save_album_photo_records(client, photo_records)
        save_album_media_records(client, media_records)
        logger.info("guest_upload_database_insert_completed request_id=%s album_id=%s", request_id, album_id)
        token = create_guest_session(client, album_id)
        _, share_token = create_share_link(client, album_id, None, None)
        set_album_creation_status(client, album_id, "active")
        share_url = f"{settings.frontend_base_url.rstrip('/')}/s/{share_token}"
    except Exception as exc:
        logger.exception(
            "guest_upload_failed request_id=%s stage=album_creation album_id=%s photo_count=%s files=%s",
            request_id,
            album_id,
            len(photos),
            file_metadata,
        )
        if album_saved:
            try:
                cleanup_incomplete_album(client, album_id)
            except Exception:
                pass
        delete_storage_paths(client, settings.supabase_private_storage_bucket, uploaded_paths)
        if result_path:
            delete_storage_paths(client, settings.supabase_private_storage_bucket, [result_path])
        if isinstance(exc, HTTPException):
            raise
        if isinstance(exc, APIError) and getattr(exc, "code", None) == "PGRST205":
            raise HTTPException(
                status_code=503,
                detail="게스트 앨범 저장 준비가 아직 완료되지 않았어요. 데이터베이스 마이그레이션을 적용한 뒤 다시 시도해주세요.",
            ) from exc
        raise
    logger.info("Guest album upload completed: album_id=%s duration_seconds=%.2f", album_id, time.perf_counter() - started_at)
    _safe_event(client, "upload_completed", album_id)
    _safe_event(client, "album_created", album_id)
    _safe_event(client, "guest_album_generated", album_id)
    photo_urls = [
        AlbumPhotoUrlResponse(
            id=UUID(str(photo["id"])),
            sort_order=int(photo["sort_order"]),
            comment=str(photo.get("comment") or "").strip() or None,
            original_url=get_signed_url(
                client, settings.supabase_private_storage_bucket, str(photo["storage_path"]), settings.signed_url_ttl_seconds
            ),
            thumbnail_url=get_signed_url(
                client, settings.supabase_private_storage_bucket, str(photo["thumbnail_path"]), settings.signed_url_ttl_seconds
            ),
            width=next((m.get("width") for m in media_records if str(m["id"]) == str(photo["id"])), None),
            height=next((m.get("height") for m in media_records if str(m["id"]) == str(photo["id"])), None),
            taken_at=next((m.get("taken_at") for m in media_records if str(m["id"]) == str(photo["id"])), None),
            latitude=next((m.get("latitude") for m in media_records if str(m["id"]) == str(photo["id"])), None),
            longitude=next((m.get("longitude") for m in media_records if str(m["id"]) == str(photo["id"])), None),
            location_name=photo.get("location_name"),
            location_source=photo.get("location_source"),
            orientation=next((m.get("orientation") for m in media_records if str(m["id"]) == str(photo["id"])), None),
        )
        for photo in photo_records
    ]
    cover_image_url = next((photo.thumbnail_url for photo in photo_urls if str(photo.id) == cover_photo_id), None)
    response = GuestAlbumUploadResponse(
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
        image_url=get_signed_url(client, settings.supabase_private_storage_bucket, result_path, settings.signed_url_ttl_seconds),
        cover_photo_id=UUID(cover_photo_id),
        cover_image_url=cover_image_url,
        share_url=share_url,
        created_at=datetime.now(timezone.utc),
        guest_token=token,
        saved=True,
        photos=photo_urls,
    )
    logger.info("guest_upload_response_returned request_id=%s album_id=%s", request_id, album_id)
    return response


@router.post("/guest-albums/claim")
@_claim_error_details
async def claim_guest_album_after_login(
    payload: GuestAlbumClaimRequest,
    authenticated_user_id: str = Depends(require_authenticated_user),
) -> dict[str, str]:
    settings = get_settings()
    client = get_supabase_client(settings)
    if not payload.guest_token:
        # Album ids and public share links are identifiers, never ownership
        # credentials.  Only the creation-browser ownership secret can claim.
        raise HTTPException(status_code=400, detail="앨범을 보관하려면 생성한 브라우저의 보관 정보가 필요합니다.")
    family_id = ensure_default_family(client, authenticated_user_id)
    album_id = claim_guest_album(client, payload.guest_token, authenticated_user_id, family_id)
    logger.info("guest_album_claim_completed album_id=%s profile_id=%s family_id=%s", album_id, authenticated_user_id, family_id)
    _safe_event(client, "guest_album_claimed", album_id)
    return {"album_id": album_id, "family_id": family_id}
