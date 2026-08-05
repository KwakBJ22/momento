from datetime import datetime, timezone
from typing import Any, get_args
from uuid import UUID, uuid4
import asyncio
import json
import logging
import time

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, Header, HTTPException, Query, Request, Response, UploadFile, status

from app.config import Settings, get_settings
from app.models.album_photo_status import ALBUM_PHOTO_READY
from app.models.album_styles import layout_for_template_type, normalize_template_type
from app.models.categories import ALBUM_CATEGORIES, meeting_type_for_category, normalize_category
from app.models.schemas import (
    AlbumDetailResponse,
    LivingAppendPagesResponse,
    CurrentEditionSummary,
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
    AlbumCoverPhotoResponse,
    AlbumCoverPhotoUpdate,
    EpilogueGenerateResponse,
    EpilogueUpdate,
    AlbumTitleUpdate,
    ChapterStoryUpdate,
    PhotoCommentResponse,
    PhotoCommentUpdate,
    AlbumUploadResponse,
    GuestAlbumClaimRequest,
    AlbumGenerationStatusResponse,
    AlbumGenerationPreviewItem,
    AlbumGenerationPreviewResponse,
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
    cleanup_incomplete_album,
    cleanup_album_files,
    delete_album_cascade,
    delete_album_record,
    delete_album_media_record,
    soft_delete_album_photo_with_references,
    delete_storage_paths,
    ensure_default_family,
    get_album_record,
    get_album_detail_light_record,
    get_album_detail_edition_record,
    count_ready_album_photos,
    count_album_photo_memories,
    get_album_photo_records_by_ids,
    get_album_story_inputs,
    get_album_photo_records,
    get_album_photo_asset_records,
    get_album_media_record,
    get_album_media_records,
    get_album_media_asset_records,
    get_result_signed_url,
    get_public_url,  # compatibility import for legacy integration mocks; not used for assets
    get_signed_urls_batch,
    list_album_photo_cover_records,
    list_album_photo_list_summaries,
    list_owned_album_cover_records,
    list_owned_album_list_records,
    list_participating_album_list_records,
    get_signed_url,
    get_supabase_client,
    save_album_record,
    set_album_creation_status,
    save_album_photo_records,
    save_album_media_records,
    update_album_epilogue,
    update_album_title,
    update_album_chapter_stories,
    update_album_narrative,
    update_album_photo_comment,
    bump_album_version,
    upsert_album_story_input,
    upload_album_photo_assets,
    upload_album_photo_original,
    upload_album_media_assets,
    upload_result_image,
)
from app.services.image_upload_service import parse_captured_at, process_upload, validate_upload_limits
from app.services.album_generation_service import (
    create_generation_job,
    generation_status,
    get_generation_job_for_album,
    has_current_generation_photos,
    run_initial_album_generation,
)
from app.services.photo_timeline import cover_date_from_processed, group_photos_by_taken_date, sort_photo_entries
from app.services.media_upload_service import process_media_upload
from app.services.auth import optional_strict_authenticated_user, require_authenticated_user
from app.services.authorization import (
    NO_ALBUM_ACCESS,
    AlbumAccess,
    guest_album_owner_access,
    require_album_contribute,
    require_album_delete,
    require_album_edit_settings,
    require_album_owner_story,
    require_album_read,
)
from app.services import guest_album_service
from app.services.plan_limits import count_owned_albums, get_user_limits
from app.services.operations import get_operation_id, get_operation_stage, set_operation_stage
from app.services.membership import (
    get_album_access,
    get_family_membership,
    require_family_write_role,
    save_album_member,
)
from app.services.share_service import create_share_link
from app.services.share_service import log_event
from app.services.collaboration_service import (
    album_document_photo_ids,
    get_contributor,
    get_cached_pdf_path,
    get_cached_pdf_bucket,
    list_photo_memories,
    set_cached_pdf_path,
    unpack_edition_snapshot,
)
from app.services.question_service import format_existing_answers, generate_album_questions
from app.services.story_rules import MIN_DATE_STORY_PHOTO_COUNT, photo_date_key, visible_date_stories
from app.services.storage_service import StorageService, album_pdf_path

router = APIRouter(prefix="/api", tags=["album"])
PDF_RENDERER_VERSION = 2
logger = logging.getLogger(__name__)

_VALID_MEETING_TYPES = set(get_args(MeetingType))
_VALID_TEMPLATES = set(get_args(TemplateType))
_VALID_CATEGORIES = set(ALBUM_CATEGORIES)


def _upload_file_diagnostics(photos: list[UploadFile]) -> dict[str, object]:
    """Collect only safe multipart diagnostics without consuming uploads."""
    extensions: set[str] = set()
    mime_types: set[str] = set()
    sizes: list[int] = []
    for photo in photos:
        filename = photo.filename or ""
        extensions.add(filename.rsplit(".", 1)[-1].lower() if "." in filename else "none")
        mime_types.add((photo.content_type or "unknown").lower())
        try:
            current = photo.file.tell()
            photo.file.seek(0, 2)
            sizes.append(int(photo.file.tell()))
            photo.file.seek(current)
        except (AttributeError, OSError):
            sizes.append(-1)
    return {
        "photo_count": len(photos),
        "extensions": ",".join(sorted(extensions)) or "none",
        "mime_types": ",".join(sorted(mime_types)) or "unknown",
        "total_bytes": sum(size for size in sizes if size >= 0),
        "file_sizes": ",".join(str(size) for size in sizes),
    }


def _log_upload_stage(stage: str, status_value: str, *, album_id: str | None = None, **details: object) -> None:
    """Emit one searchable, privacy-safe line for the upload request path."""
    set_operation_stage(stage)
    fields = [f"stage={stage}", f"status={status_value}"]
    if album_id:
        fields.append(f"album_id={album_id[:8]}")
    fields.extend(f"{key}={value}" for key, value in details.items() if value is not None)
    logger.info("event=album_upload_stage %s", " ".join(fields))


def _require_photo_mutation_access(
    client: Any,
    *,
    album_id: str,
    photo_id: str,
    authenticated_user_id: str,
    access: Any,
) -> dict[str, Any]:
    """Allow contributors to mutate only the photo they submitted.

    The service-role client bypasses RLS, so this ownership relation must be
    checked before every authenticated photo mutation.
    """
    require_album_contribute(access)
    result = (
        client.table("album_photos")
        .select("*")
        .eq("id", photo_id)
        .eq("album_id", album_id)
        .limit(1)
        .execute()
    )
    rows = result.data or []
    if not rows:
        raise HTTPException(status_code=404, detail="사진을 찾을 수 없습니다.")
    photo = rows[0]
    if access.can_edit_settings:
        return photo
    if str(photo.get("contributor_profile_id") or "") == authenticated_user_id:
        return photo
    contributor = get_contributor(client, album_id, user_id=authenticated_user_id)
    if contributor and str(photo.get("uploaded_by_contributor_id") or "") == str(contributor.get("id") or ""):
        return photo
    raise HTTPException(status_code=403, detail="본인이 추가한 사진만 수정할 수 있습니다.")


def _require_media_mutation_access(media: dict[str, Any], access: Any, authenticated_user_id: str) -> None:
    require_album_contribute(access)
    if access.can_edit_settings:
        return
    if str(media.get("uploader_id") or "") == authenticated_user_id:
        return
    raise HTTPException(status_code=403, detail="본인이 추가한 미디어만 삭제할 수 있습니다.")


def _actor_album_access(client: Any, album: dict[str, Any], user_id: str | None, guest_token: str | None) -> AlbumAccess:
    """Access for either a logged-in user OR a valid guest-session token holder.

    Logged-in users go through the normal family/album role resolution unchanged.
    A guest album (unclaimed) is owned by whoever holds its session token, so a
    matching token grants owner-level access; anything else gets no access. The
    guest token is always verified server-side against ``guest_album_sessions``.
    """
    if user_id:
        return get_album_access(client, album, user_id)
    if guest_album_service.guest_session_matches(client, str(album.get("id") or ""), guest_token):
        return guest_album_owner_access()
    return NO_ALBUM_ACCESS


_GUEST_TOKEN_HEADER = Header(default=None, alias="X-Momento-Guest-Album-Token")


def _resolve_cover_photo(album: dict[str, Any], photos: list[dict[str, Any]]) -> dict[str, Any] | None:
    if not isinstance(photos, list):
        return None
    requested = str(album.get("cover_photo_id") or "").strip()
    if requested:
        selected = next((photo for photo in photos if str(photo.get("id")) == requested), None)
        if selected:
            return selected
    return photos[0] if photos else None


def _cover_image_url(client: Any, settings: Settings, album: dict[str, Any], photos: list[dict[str, Any]]) -> tuple[str | None, str | None]:
    cover = _resolve_cover_photo(album, photos)
    if not cover:
        return None, None
    return (
        str(cover.get("id")),
        get_signed_url(
            client,
            str(cover.get("thumbnail_bucket") or cover.get("storage_bucket")),
            str(cover.get("thumbnail_path") or cover.get("storage_path")),
            settings.signed_url_ttl_seconds,
        ),
    )


def _my_album_list_items(
    client: Any,
    settings: Settings,
    records: list[dict[str, Any]],
    memory_counts: dict[str, int],
    photo_rows: list[dict[str, Any]],
) -> list[MyAlbumListItem]:
    """Build list cards from batch rows without per-album photo or storage requests."""
    photos_by_album: dict[str, list[dict[str, Any]]] = {}
    for photo in photo_rows:
        album_id = str(photo.get("album_id") or "")
        if album_id:
            photos_by_album.setdefault(album_id, []).append(photo)

    items: list[MyAlbumListItem] = []
    for record in records:
        album_id = str(record["id"])
        photos = photos_by_album.get(album_id, [])
        requested_cover_id = str(record.get("cover_photo_id") or "").strip()
        available_ids = {str(photo.get("id")) for photo in photos}
        cover_photo_id = requested_cover_id if requested_cover_id in available_ids else (str(photos[0]["id"]) if photos else None)
        has_cover = bool(cover_photo_id)
        items.append(
            MyAlbumListItem(
                album_id=UUID(album_id),
                title=str(record.get("title") or "우리의 추억"),
                created_at=record["created_at"],
                updated_at=record.get("updated_at"),
                image_url=(
                    ""
                    if has_cover
                    else (
                        get_result_signed_url(client, record, settings)
                        if record.get("result_path")
                        else ""
                    )
                ),
                cover_photo_id=UUID(cover_photo_id) if cover_photo_id else None,
                cover_image_url=None,
                photo_count=len(photos),
                new_memory_count=int(memory_counts.get(album_id, 0)),
                is_latest_edition=True,
                status=str(record.get("status") or "active"),
            )
        )
    return items


def _attach_my_album_cover_urls(
    client: Any,
    settings: Settings,
    profile_id: str,
    items: list[MyAlbumListItem],
) -> list[MyAlbumListItem]:
    """Sign cover thumbnails in one batch so the list never flashes PDF previews."""
    targets = [
        (str(item.album_id), str(item.cover_photo_id))
        for item in items
        if item.cover_photo_id
    ]
    if not targets:
        return items
    album_ids = [album_id for album_id, _ in targets]
    cover_photo_ids = [photo_id for _, photo_id in targets]
    covers = _owned_cover_urls(client, settings, profile_id, album_ids, cover_photo_ids)
    return _apply_cover_urls(items, covers)


def _attach_participating_cover_urls(
    client: Any,
    settings: Settings,
    items: list[MyAlbumListItem],
) -> list[MyAlbumListItem]:
    """Sign covers for albums the user contributed to (participation already established,
    so no ownership gate) — same batch signing as owned albums."""
    targets = [(str(item.album_id), str(item.cover_photo_id)) for item in items if item.cover_photo_id]
    if not targets:
        return items
    covers = _sign_cover_thumbnails(client, settings, [a for a, _ in targets], [p for _, p in targets])
    return _apply_cover_urls(items, covers)


def _apply_cover_urls(items: list[MyAlbumListItem], covers: dict[str, str]) -> list[MyAlbumListItem]:
    if not covers:
        return items
    return [
        item.model_copy(
            update={
                "cover_image_url": covers.get(str(item.album_id)) or item.cover_image_url,
                "image_url": covers.get(str(item.album_id)) or item.image_url,
            }
        )
        if covers.get(str(item.album_id))
        else item
        for item in items
    ]


def _sign_cover_thumbnails(
    client: Any,
    settings: Settings,
    album_ids: list[str],
    cover_photo_ids: list[str],
) -> dict[str, str]:
    """Batch-sign requested cover thumbnails. Caller is responsible for authorizing access."""
    requested_ids = {str(photo_id) for photo_id in cover_photo_ids}
    if not album_ids or not requested_ids:
        return {}
    rows = list_album_photo_cover_records(client, album_ids, sorted(requested_ids))
    signed_urls = get_signed_urls_batch(client, rows, settings.signed_url_ttl_seconds)
    covers: dict[str, str] = {}
    for row in rows:
        bucket = str(row.get("thumbnail_bucket") or row.get("storage_bucket") or "")
        path = str(row.get("thumbnail_path") or row.get("storage_path") or "")
        url = signed_urls.get((bucket, path))
        if url:
            covers[str(row["album_id"])] = url
    return covers


def _owned_cover_urls(
    client: Any,
    settings: Settings,
    profile_id: str,
    album_ids: list[str],
    cover_photo_ids: list[str],
) -> dict[str, str]:
    """Resolve requested cover thumbnails in constant query count for owned albums only."""
    owned = list_owned_album_cover_records(client, profile_id, album_ids)
    owned_ids = [str(row["id"]) for row in owned]
    if not owned_ids:
        return {}
    return _sign_cover_thumbnails(client, settings, owned_ids, cover_photo_ids)


@router.post("/upload-album", response_model=AlbumUploadResponse, status_code=status.HTTP_202_ACCEPTED)
async def upload_album(
    request: Request,
    background_tasks: BackgroundTasks,
    photos: list[UploadFile] = File(..., description="최대 30장의 사진"),
    stories: str = Form(..., description='JSON 배열: [{"order":0,"user":"","text":"..."}, ...]'),
    meeting_type: str = Form("friend", description="family/friend/work/university"),
    category: str = Form("", description="family/friend/couple/colleague/pet/travel/other"),
    template: str = Form("", description="레거시 레이아웃 A/B/C (template_type 우선)"),
    template_type: str = Form("", description="warm/joyful/special"),
    title: str = Form("우리의 모임", description="모임 제목"),
    date: str = Form("", description="(deprecated) 사용자 날짜 입력은 사용하지 않음. EXIF로 자동 결정"),
    description: str = Form("", description="선택형 앨범 보강 정보"),
    file_meta: str = Form("[]", description='[{"last_modified": 1710000000000}, ...] File.lastModified'),
    cover_photo_order: int = Form(-1),
    dropped_video_count: int = Form(0, description="프런트에서 걸러진 동영상 수(수요 계측용)"),
    authenticated_user_id: str | None = Depends(optional_strict_authenticated_user),
) -> AlbumUploadResponse:
    request_started = time.perf_counter()
    settings = get_settings()
    upload_diagnostics = _upload_file_diagnostics(photos)
    # FastAPI has completed multipart parsing before this handler is entered.
    # Do not log filenames, paths, captions, or identities here.
    _log_upload_stage("request_authentication", "started")
    _log_upload_stage("request_authentication", "completed", authenticated=True, guest_token_check="not_applicable")
    _log_upload_stage("multipart_parsing", "started")
    _log_upload_stage("multipart_parsing", "completed", **upload_diagnostics)

    if dropped_video_count and dropped_video_count > 0:
        # Videos are filtered out in the frontend (no client-side compression + the 40MB
        # total guard; needs per-photo upload first), so they never arrive as files — the
        # count rides along here. Demand signal for prioritizing per-photo upload + video
        # support. Best-effort; a caller who abandons before upload is not counted.
        log_event(get_supabase_client(settings), "video_dropped", metadata={"video_count": int(dropped_video_count)})

    if not photos:
        raise HTTPException(status_code=400, detail="최소 1장의 사진이 필요합니다.")
    if len(photos) > settings.max_photos:
        # The frontend trims past 30 before sending, so this backend 400 is rare;
        # record it (best-effort) when it does happen to inform the photo cap. Its own
        # event name (not upload_failed) so it never pollutes the upload-failure metric.
        log_event(get_supabase_client(settings), "photo_limit_reached", metadata={"photo_count": len(photos)})
        raise HTTPException(status_code=400, detail=f"사진은 최대 {settings.max_photos}장까지 업로드할 수 있습니다.")

    _log_upload_stage("file_validation", "started", **upload_diagnostics)
    validate_upload_limits(photos, settings)
    _log_upload_stage("file_validation", "completed", **upload_diagnostics)

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

    _log_upload_stage("request_payload_validation", "started", photo_count=len(photos))
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
    _log_upload_stage("request_payload_validation", "completed", photo_count=len(photos))

    try:
        meta_list = json.loads(file_meta) if file_meta.strip() else []
        if not isinstance(meta_list, list):
            meta_list = []
    except json.JSONDecodeError:
        meta_list = []

    _log_upload_stage("supabase_client", "started", photo_count=len(photos))
    client = get_supabase_client(settings)
    # No login: create an unclaimed album bound to a guest session (below). A
    # guest has no family, so skip family provisioning and leave owner/family null.
    # Guests own nothing, so the album limit does not apply to them.
    if authenticated_user_id:
        # Abuse-protection ceiling (see config.max_albums_per_user) — normal users
        # never reach it. Checked BEFORE any photo processing / Storage upload.
        limits = get_user_limits(authenticated_user_id)
        if count_owned_albums(client, authenticated_user_id) >= limits["max_albums"]:
            # album_limit_reached: NOT a monetization signal — it's an abuse-detection
            # signal now that the ceiling is high. Don't expose the number or upsell.
            # Dedicated event name (not upload_failed) — this is a limit hit, not a failure.
            log_event(client, "album_limit_reached", metadata={"owner_id": authenticated_user_id})
            raise HTTPException(
                status_code=403,
                detail="앨범을 너무 많이 만들었어요. 잠시 후 다시 시도해 주세요.",
            )
        family_id = ensure_default_family(client, authenticated_user_id)
        family_membership = get_family_membership(client, family_id, authenticated_user_id)
        require_family_write_role(family_membership["role"] if family_membership else None)
    else:
        family_id = None
    operation_id = (request.headers.get("X-Momento-Operation-Id") or "").strip()
    try:
        album_id = str(UUID(operation_id)) if operation_id else create_album_id()
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid album creation operation.")
    _log_upload_stage("album_id_allocation", "completed", album_id=album_id, photo_count=len(photos))
    logger.info("event=album_generation_request_received album_id=%s photo_count=%s", album_id[:8], len(photos))
    existing_album = get_album_record(client, album_id)
    if existing_album:
        existing_job = get_generation_job_for_album(client, album_id)
        if existing_job:
            return AlbumUploadResponse(
                album_id=UUID(album_id), meeting_type=str(existing_album.get("meeting_type") or meeting_type),
                category=existing_album.get("category"), template=str(existing_album.get("template") or layout),
                template_type=existing_album.get("template_type"), title=str(existing_album.get("title") or title),
                date=str(existing_album.get("event_date") or ""), narrative=str(existing_album.get("narrative") or ""),
                epilogue=existing_album.get("epilogue"), chapter_stories=existing_album.get("chapter_stories") or {},
                image_url="", cover_photo_id=UUID(str(existing_album["cover_photo_id"])) if existing_album.get("cover_photo_id") else None,
                share_url="", created_at=datetime.now(timezone.utc), saved=False, photos=[],
                generation_job_id=UUID(str(existing_job["id"])), generation_status=str(existing_job.get("status") or "pending"),
                progress=int(existing_job.get("progress") or 20),
            )
        raise HTTPException(status_code=409, detail="This album creation request is already being processed.")

    items_by_order: dict[int, dict[str, Any]] = {int(item["order"]): item for item in story_items}
    entries: list[dict[str, Any]] = []
    original_upload_started = time.perf_counter()
    _log_upload_stage("image_preparation", "started", album_id=album_id, **upload_diagnostics)
    logger.info("event=album_generation_original_upload_started album_id=%s photo_count=%s", album_id[:8], len(photos))
    for upload_order, photo in enumerate(photos):
        raw_meta = meta_list[upload_order] if upload_order < len(meta_list) and isinstance(meta_list[upload_order], dict) else {}
        captured_at = parse_captured_at(raw_meta.get("captured_at"))
        # Originals and basic metadata are the only synchronous work. Web
        # derivatives and album storytelling run from the persisted job.
        processed = process_upload(photo, settings, captured_at=captured_at, generate_derivatives=False)
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
    _log_upload_stage("image_preparation", "completed", album_id=album_id, photo_count=len(entries))

    # Persist the original upload and a minimal draft before scheduling the
    # slower work. This is deliberately kept separate from the legacy block
    # below so in-flight deployments retain a narrow, recoverable boundary.
    uploaded_private_paths: list[str] = []
    album_saved = False
    try:
        photo_records: list[dict[str, Any]] = []
        media_records: list[dict[str, Any]] = []
        photo_paths: list[str] = []
        ordered_stories: list[dict[str, Any]] = []
        selected_cover_photo_id: str | None = None
        _log_upload_stage("storage_original_upload", "started", album_id=album_id, photo_count=len(entries))
        for entry in entries:
            processed = entry["processed"]
            upload = entry["upload"]
            story = dict(entry["story"])
            sort_order = int(entry["sort_order"])
            photo_id = str(uuid4())
            original_path = upload_album_photo_original(
                client, album_id=album_id, photo_id=photo_id, photo=processed, settings=settings,
            )
            uploaded_private_paths.append(original_path)
            story["_path"] = original_path
            story["order"] = sort_order
            ordered_stories.append(story)
            photo_paths.append(original_path)
            taken_at_iso = processed.taken_at.isoformat() if processed.taken_at else None
            photo_records.append({
                "id": photo_id, "album_id": album_id,
                "storage_bucket": settings.supabase_private_storage_bucket, "storage_path": original_path,
                "display_bucket": settings.supabase_private_storage_bucket, "display_path": original_path,
                # The worker replaces this original fallback with WebP. Keeping
                # a valid path here also supports databases that have not yet
                # applied the nullable-derivative migration.
                "thumbnail_bucket": settings.supabase_private_storage_bucket, "thumbnail_path": original_path,
                "original_filename": upload.filename, "mime_type": processed.original_mime_type,
                "byte_size": len(processed.original_bytes), "checksum_sha256": processed.checksum_sha256,
                "sort_order": sort_order, "caption": story["text"], "comment": story["text"].strip() or None,
                "contributor_profile_id": authenticated_user_id, "legacy_author_label": story["user"] or None,
                # This row is inserted only after its original object upload
                # has succeeded.  It is therefore a valid generation input;
                # ``uploading`` would make the retry path incorrectly treat
                # it as absent before derivatives are created.
                "status": ALBUM_PHOTO_READY, "taken_at": taken_at_iso, "latitude": processed.latitude,
                "longitude": processed.longitude, "location_name": None,
                "location_source": "exif" if processed.latitude is not None and processed.longitude is not None else "unknown",
                "orientation": processed.orientation, "width": processed.width or None, "height": processed.height or None,
            })
            if int(entry["upload_order"]) == cover_photo_order:
                selected_cover_photo_id = photo_id
            media_records.append({
                "id": photo_id, "album_id": album_id, "uploader_id": authenticated_user_id,
                "media_type": "gif" if processed.original_mime_type == "image/gif" else "image",
                "mime_type": processed.original_mime_type, "original_filename": upload.filename,
                "original_path": original_path, "thumbnail_path": None, "file_size": len(processed.original_bytes),
                "width": processed.width or None, "height": processed.height or None, "sort_order": sort_order,
                "processing_status": "processing", "taken_at": taken_at_iso, "latitude": processed.latitude,
                "longitude": processed.longitude, "orientation": processed.orientation,
                "metadata": {"source": "album_photos", "datetime_original": processed.datetime_original,
                             "create_date": processed.create_date, "upload_order": entry["upload_order"],
                             "day_group_count": len(_day_groups),
                             "location_source": "exif" if processed.latitude is not None and processed.longitude is not None else "unknown"},
            })
        originals_uploaded_at = time.perf_counter()
        _log_upload_stage(
            "storage_original_upload", "completed", album_id=album_id, photo_count=len(photo_records),
            photo_ids=",".join(str(record["id"])[:8] for record in photo_records),
        )
        logger.info(
            "event=album_generation_original_upload_completed album_id=%s photo_count=%s upload_originals_ms=%s",
            album_id[:8], len(entries), round((originals_uploaded_at - original_upload_started) * 1000),
        )
        cover_photo_id = selected_cover_photo_id or str(photo_records[0]["id"])
        photo_meta = [{"order": item["order"], "user": item["user"], "text": item["text"], "path": item["_path"],
                       "taken_at": next((photo.get("taken_at") for photo in photo_records if int(photo["sort_order"]) == int(item["order"])), None)}
                      for item in ordered_stories]
        _log_upload_stage("album_db_insert", "started", album_id=album_id)
        save_album_record(
            client, album_id=album_id, owner_id=authenticated_user_id, family_id=family_id,
            meeting_type=meeting_type, template=layout, title=title, event_date=event_date,
            narrative="", epilogue="", chapter_stories={}, photo_paths=photo_paths, photo_meta=photo_meta,
            result_path="", result_bucket=settings.supabase_private_storage_bucket, creation_status="processing",
            category=album_category, template_type=album_template_type, cover_photo_id=cover_photo_id,
        )
        album_saved = True
        _log_upload_stage("album_db_insert", "completed", album_id=album_id)
        _log_upload_stage("photo_db_insert", "started", album_id=album_id, photo_count=len(photo_records))
        save_album_photo_records(client, photo_records)
        _log_upload_stage(
            "photo_db_insert", "completed", album_id=album_id, photo_count=len(photo_records),
            photo_ids=",".join(str(record["id"])[:8] for record in photo_records),
        )
        _log_upload_stage("media_db_insert", "started", album_id=album_id, media_count=len(media_records))
        save_album_media_records(client, media_records)
        _log_upload_stage("media_db_insert", "completed", album_id=album_id, media_count=len(media_records))
        # A guest has no profile row, so no owner membership is written now — the
        # claim RPC inserts the owner membership at login.
        if authenticated_user_id:
            save_album_member(client, album_id=album_id, profile_id=authenticated_user_id, role="owner", invited_by=authenticated_user_id)
        _, share_token = create_share_link(client, album_id, authenticated_user_id, None)
        _log_upload_stage("album_json_generation", "deferred", album_id=album_id)
        _log_upload_stage("cover_photo_assignment", "completed", album_id=album_id, photo_id=cover_photo_id[:8])
        _log_upload_stage("generation_job_create", "started", album_id=album_id)
        job = create_generation_job(client, album_id)
        _log_upload_stage("generation_job_create", "completed", album_id=album_id, job_id=str(job["id"])[:8])
        records_created_at = time.perf_counter()
        logger.info(
            "event=album_generation_photo_records_created album_id=%s job_id=%s photo_count=%s create_records_ms=%s",
            album_id[:8], str(job["id"])[:8], len(photo_records), round((records_created_at - originals_uploaded_at) * 1000),
        )
    except Exception as exc:
        logger.exception(
            "event=album_upload_failed stage=%s album_id=%s photo_count=%s error_type=%s error_message=%s",
            get_operation_stage() or "unknown", album_id[:8], len(entries), type(exc).__name__, str(exc)[:240],
        )
        try:
            if album_saved:
                cleanup_incomplete_album(client, album_id)
        except Exception as cleanup_exc:
            logger.exception(
                "event=album_upload_db_cleanup_failed album_id=%s error_type=%s",
                album_id[:8], type(cleanup_exc).__name__,
            )
        try:
            delete_storage_paths(client, settings.supabase_private_storage_bucket, uploaded_private_paths)
        except Exception as cleanup_exc:
            logger.exception(
                "event=album_upload_storage_cleanup_failed album_id=%s path_count=%s error_type=%s",
                album_id[:8], len(uploaded_private_paths), type(cleanup_exc).__name__,
            )
        raise

    try:
        _log_upload_stage("background_schedule", "started", album_id=album_id, job_id=str(job["id"])[:8])
        background_tasks.add_task(run_initial_album_generation, str(job["id"]))
    except Exception as exc:
        logger.exception(
            "event=album_generation_schedule_failed album_id=%s job_id=%s error_type=%s",
            album_id[:8], str(job["id"])[:8], type(exc).__name__,
        )
        client.table("album_generation_jobs").update({"status": "failed", "error_code": "schedule_failed"}).eq("id", job["id"]).execute()
        client.table("albums").update({"status": "failed"}).eq("id", album_id).execute()
        raise HTTPException(status_code=500, detail="앨범 만들기를 시작하지 못했습니다. 다시 시도해주세요.") from exc
    _log_upload_stage("background_schedule", "completed", album_id=album_id, job_id=str(job["id"])[:8])
    logger.info(
        "event=album_generation_accepted_response_ready album_id=%s job_id=%s photo_count=%s request_to_accepted_ms=%s upload_originals_ms=%s create_records_ms=%s status=accepted",
        album_id[:8], str(job["id"])[:8], len(photo_records), round((time.perf_counter() - request_started) * 1000),
        round((originals_uploaded_at - original_upload_started) * 1000),
        round((records_created_at - originals_uploaded_at) * 1000),
    )
    # No login: bind the album to a guest session and hand the browser the raw
    # token (only its hash is stored). This is what lets the guest view/edit and
    # later claim the album — the album row itself stays owner-less until claimed.
    guest_token: str | None = None
    if not authenticated_user_id:
        guest_token = guest_album_service.create_guest_session(client, album_id)
        log_event(client, "guest_album_generated", album_id=album_id)
    _log_upload_stage("response_serialization", "started", album_id=album_id, job_id=str(job["id"])[:8])
    response_payload = AlbumUploadResponse(
        album_id=UUID(album_id), meeting_type=meeting_type, category=album_category, template=layout,
        template_type=album_template_type, title=title, date=event_date, narrative="", epilogue="", chapter_stories={},
        image_url="", cover_photo_id=UUID(cover_photo_id), cover_image_url=None,
        share_url=f"{settings.frontend_base_url.rstrip('/')}/s/{share_token}", created_at=datetime.now(timezone.utc),
        saved=True, photos=[], generation_job_id=UUID(str(job["id"])), generation_status=str(job.get("status") or "pending"),
        progress=int(job.get("progress") or 20), guest_token=guest_token,
    )
    _log_upload_stage("response_serialization", "completed", album_id=album_id, job_id=str(job["id"])[:8])
    # Metric: album completion rate = album_created / upload_started.
    log_event(client, "upload_started", album_id=album_id, metadata={"owner_id": authenticated_user_id, "photo_count": len(photos)})
    return response_payload

    # Kept below only for source-history context during the rollout. The
    # return above is the active creation path.
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
            asset_paths = upload_album_photo_assets(client, family_id, album_id, photo_id, processed, settings)
            # Accept the former original/thumbnail tuple during a rolling
            # deployment; those rows still render through the original as their
            # display fallback.
            if len(asset_paths) == 2:
                original_path, thumbnail_path = asset_paths
                display_path = original_path
            else:
                original_path, display_path, thumbnail_path = asset_paths
            uploaded_private_paths.extend([original_path, display_path, thumbnail_path])
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
                    "display_bucket": settings.supabase_private_storage_bucket,
                    "display_path": display_path,
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
                    "status": ALBUM_PHOTO_READY,
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
            result_bucket=settings.supabase_private_storage_bucket,
            creation_status="processing",
            category=album_category,
            template_type=album_template_type,
            cover_photo_id=cover_photo_id,
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
        set_album_creation_status(client, album_id, "active")
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
                cleanup_incomplete_album(client, album_id)
            except Exception:
                pass
        delete_storage_paths(client, settings.supabase_private_storage_bucket, uploaded_private_paths)
        if result_path:
            delete_storage_paths(client, settings.supabase_private_storage_bucket, [result_path])
        raise

    image_url = get_signed_url(client, settings.supabase_private_storage_bucket, result_path, settings.signed_url_ttl_seconds)
    _, share_token = create_share_link(client, album_id, authenticated_user_id, None)
    share_url = f"{settings.frontend_base_url.rstrip('/')}/s/{share_token}"
    log_event(client, "album_created", album_id=album_id, metadata={"owner_id": authenticated_user_id})

    photo_urls = [
        AlbumPhotoUrlResponse(
            id=UUID(str(photo["id"])),
            sort_order=int(photo["sort_order"]),
            comment=str(photo.get("comment") or "").strip() or None,
            original_url=get_signed_url(
                client, str(photo["storage_bucket"]), str(photo["storage_path"]), settings.signed_url_ttl_seconds
            ),
            display_url=get_signed_url(
                client, str(photo.get("display_bucket") or photo["storage_bucket"]), str(photo.get("display_path") or photo["storage_path"]), settings.signed_url_ttl_seconds
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
    cover_image_url = next((photo.thumbnail_url for photo in photo_urls if str(photo.id) == cover_photo_id), None)

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
        cover_photo_id=UUID(cover_photo_id),
        cover_image_url=cover_image_url,
        share_url=share_url,
        created_at=datetime.now(timezone.utc),
        saved=True,
        photos=photo_urls,
    )


def _generation_status_response(album_id: str, job: dict[str, Any]) -> AlbumGenerationStatusResponse:
    state = str(job.get("status") or "pending")
    return AlbumGenerationStatusResponse(
        album_id=UUID(album_id), generation_job_id=UUID(str(job["id"])), status=state,
        progress=int(job.get("progress") or 0), current_step=str(job.get("current_step") or "upload_completed"),
        ready=state == "completed", error_code=str(job["error_code"]) if job.get("error_code") else None,
    )


@router.get("/albums/{album_id}/generation-preview", response_model=AlbumGenerationPreviewResponse)
async def get_album_generation_preview(
    album_id: str,
    authenticated_user_id: str | None = Depends(optional_strict_authenticated_user),
    guest_token: str | None = _GUEST_TOKEN_HEADER,
) -> AlbumGenerationPreviewResponse:
    """Return at most five existing assets for a creation-screen preview."""
    settings = get_settings()
    client = get_supabase_client(settings)
    album = get_album_record(client, album_id)
    if not album:
        raise HTTPException(status_code=404, detail="앨범을 찾을 수 없습니다.")
    access = _actor_album_access(client, album, authenticated_user_id, guest_token)
    require_album_owner_story(access)
    rows = (
        client.table("album_photos")
        .select("id,storage_bucket,storage_path,display_bucket,display_path,thumbnail_bucket,thumbnail_path")
        .eq("album_id", album_id).is_("deleted_at", "null").order("sort_order").limit(5).execute().data or []
    )
    assets: list[dict[str, str]] = []
    selected: list[tuple[str, str, str]] = []
    for row in rows:
        bucket = str(row.get("thumbnail_bucket") or row.get("display_bucket") or row.get("storage_bucket") or "")
        path = str(row.get("thumbnail_path") or row.get("display_path") or row.get("storage_path") or "")
        if bucket and path:
            assets.append({"bucket": bucket, "path": path})
            selected.append((str(row["id"]), bucket, path))
    signed = get_signed_urls_batch(client, assets, settings.signed_url_ttl_seconds)
    return AlbumGenerationPreviewResponse(previews=[
        AlbumGenerationPreviewItem(photo_id=UUID(photo_id), url=signed.get((bucket, path)) or None)
        for photo_id, bucket, path in selected
    ])


@router.get("/albums/{album_id}/generation-status", response_model=AlbumGenerationStatusResponse)
async def get_album_generation_status(
    album_id: str,
    authenticated_user_id: str | None = Depends(optional_strict_authenticated_user),
    guest_token: str | None = _GUEST_TOKEN_HEADER,
) -> AlbumGenerationStatusResponse:
    client = get_supabase_client(get_settings())
    album = get_album_record(client, album_id)
    if not album:
        raise HTTPException(status_code=404, detail="앨범을 찾을 수 없습니다.")
    access = _actor_album_access(client, album, authenticated_user_id, guest_token)
    require_album_owner_story(access)
    job = generation_status(client, album_id)
    if not job:
        # Only completed legacy albums may bypass a persisted job.  A legacy
        # `creating` record without a job is an interrupted upload, not a
        # completed album; surface a retryable failure instead of polling it
        # forever.
        if not album.get("result_path") and str(album.get("status") or "") not in {"active", "completed"}:
            has_photos = has_current_generation_photos(client, album_id)
            error_code = "missing_generation_job_retryable" if has_photos else "missing_generation_job_no_photos"
            client.table("albums").update({"status": "failed"}).eq("id", album_id).execute()
            return AlbumGenerationStatusResponse(
                album_id=UUID(album_id), generation_job_id=UUID(int=0), status="failed", progress=0,
                current_step="failed", ready=False, error_code=error_code,
            )
        return AlbumGenerationStatusResponse(
            album_id=UUID(album_id), generation_job_id=UUID(int=0), status="completed", progress=100,
            current_step="completed", ready=True,
        )
    return _generation_status_response(album_id, job)


@router.post("/albums/{album_id}/generation-retry", response_model=AlbumGenerationStatusResponse, status_code=status.HTTP_202_ACCEPTED)
async def retry_album_generation(
    album_id: str,
    background_tasks: BackgroundTasks,
    authenticated_user_id: str | None = Depends(optional_strict_authenticated_user),
    guest_token: str | None = _GUEST_TOKEN_HEADER,
) -> AlbumGenerationStatusResponse:
    client = get_supabase_client(get_settings())
    album = get_album_record(client, album_id)
    if not album:
        raise HTTPException(status_code=404, detail="앨범을 찾을 수 없습니다.")
    access = _actor_album_access(client, album, authenticated_user_id, guest_token)
    require_album_owner_story(access)
    job = generation_status(client, album_id)
    if not job:
        if not has_current_generation_photos(client, album_id):
            raise HTTPException(status_code=422, detail="사진을 추가한 뒤 앨범을 만들어주세요.")
        job = create_generation_job(client, album_id)
    state = str(job.get("status") or "pending")
    if state == "completed":
        return _generation_status_response(album_id, job)
    if state == "processing":
        return _generation_status_response(album_id, job)
    if not has_current_generation_photos(client, album_id):
        raise HTTPException(status_code=422, detail="사진을 추가한 뒤 앨범을 만들어주세요.")
    client.table("album_generation_jobs").update({
        "status": "pending", "progress": 20, "current_step": "upload_completed", "error_code": None,
        "retry_count": int(job.get("retry_count") or 0) + 1,
    }).eq("id", job["id"]).execute()
    client.table("albums").update({"status": "processing"}).eq("id", album_id).execute()
    background_tasks.add_task(run_initial_album_generation, str(job["id"]))
    refreshed = generation_status(client, album_id) or job
    return _generation_status_response(album_id, refreshed)


@router.get("/albums/{album_id}/photos", response_model=AlbumPhotoUrlsResponse)
async def get_album_photo_urls(
    album_id: str,
    edition: int | None = None,
    authenticated_user_id: str | None = Depends(optional_strict_authenticated_user),
    guest_token: str | None = _GUEST_TOKEN_HEADER,
) -> AlbumPhotoUrlsResponse:
    """Issue short-lived private asset URLs only to the album owner (or its guest holder)."""
    settings = get_settings()
    client = get_supabase_client(settings)
    record = get_album_record(client, album_id)
    if not record:
        raise HTTPException(status_code=404, detail="앨범을 찾을 수 없습니다.")
    access = _actor_album_access(client, record, authenticated_user_id, guest_token)
    require_album_read(access)

    document, _ = _edition_document_and_pages(record, edition)
    document_photo_ids = album_document_photo_ids(document)
    # Keep photo comments in the private photo payload.  The detail endpoint is
    # intentionally light, but photo memories are part of the rendered photo
    # content (and not optional decoration), so dropping this collection makes
    # existing participant memories disappear from the album.
    all_photos, memories = await asyncio.gather(
        asyncio.to_thread(get_album_photo_records, client, album_id),
        asyncio.to_thread(list_photo_memories, client, album_id),
    )
    # album_photos already contains the display metadata for current uploads.
    # Keep the album_media fallback only for legacy rows that do not have it,
    # rather than paying for a second complete media list on every album view.
    needs_legacy_media = any(
        photo.get("width") is None
        or photo.get("height") is None
        or not photo.get("taken_at")
        or not photo.get("orientation")
        for photo in all_photos
    )
    media_records = (
        await asyncio.to_thread(get_album_media_records, client, album_id)
        if needs_legacy_media
        else []
    )
    media_by_id = {str(media["id"]): media for media in media_records}
    visible_photos = [photo for photo in all_photos if not document_photo_ids or str(photo["id"]) in document_photo_ids]
    signed_urls = _batch_signed_urls_for_photos(client, settings, visible_photos)
    photo_urls: list[AlbumPhotoUrlResponse] = []
    for photo in visible_photos:
        media = media_by_id.get(str(photo["id"])) or {}
        row = _album_photo_response(client, settings, photo, memories, signed_urls=signed_urls)
        photo_urls.append(
            row.model_copy(
                update={
                    "width": photo.get("width") if photo.get("width") is not None else media.get("width"),
                    "height": photo.get("height") if photo.get("height") is not None else media.get("height"),
                    "taken_at": photo.get("taken_at") or media.get("taken_at"),
                    "latitude": photo.get("latitude") if photo.get("latitude") is not None else media.get("latitude"),
                    "longitude": photo.get("longitude") if photo.get("longitude") is not None else media.get("longitude"),
                    "orientation": photo.get("orientation") or media.get("orientation"),
                }
            )
        )
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
    _require_photo_mutation_access(
        client,
        album_id=album_id,
        photo_id=photo_id,
        authenticated_user_id=authenticated_user_id,
        access=access,
    )

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
        display_url=get_signed_url(
            client,
            str(photo.get("display_bucket") or photo["storage_bucket"]),
            str(photo.get("display_path") or photo["storage_path"]),
            settings.signed_url_ttl_seconds,
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
    authenticated_user_id: str | None = Depends(optional_strict_authenticated_user),
    guest_token: str | None = _GUEST_TOKEN_HEADER,
) -> PhotoCommentResponse:
    client = get_supabase_client()
    album = get_album_record(client, album_id)
    if not album:
        raise HTTPException(status_code=404, detail="앨범을 찾을 수 없습니다.")
    access = _actor_album_access(client, album, authenticated_user_id, guest_token)
    _require_photo_mutation_access(
        client,
        album_id=album_id,
        photo_id=photo_id,
        authenticated_user_id=authenticated_user_id,
        access=access,
    )
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
    media = get_album_media_record(client, album_id, media_id)
    if not media:
        raise HTTPException(status_code=404, detail="미디어를 찾을 수 없습니다.")
    _require_media_mutation_access(media, access, authenticated_user_id)
    photo_rows = (
        client.table("album_photos").select("storage_path,display_path,thumbnail_path")
        .eq("id", media_id).eq("album_id", album_id).is_("deleted_at", "null").limit(1).execute().data or []
    )
    paths = {
        str(path) for path in (
            media.get("original_path"), media.get("preview_path"), media.get("thumbnail_path"),
            *(photo_rows[0].values() if photo_rows else ()),
        ) if path
    }
    deleted = soft_delete_album_photo_with_references(client, album_id, media_id) if photo_rows else delete_album_media_record(client, album_id, media_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="미디어를 찾을 수 없습니다.")
    try:
        StorageService.for_supabase(client, settings).delete(settings.supabase_private_storage_bucket, sorted(paths))
    except Exception as exc:
        logger.warning("media_storage_cleanup_failed album_id=%s media_id=%s error_type=%s", album_id[:8], media_id[:8], type(exc).__name__)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def _edition_document_and_pages(
    record: dict[str, Any], edition: int | None,
) -> tuple[dict[str, Any] | None, list[dict[str, Any]]]:
    if edition is None:
        document = record.get("album_json") if isinstance(record.get("album_json"), dict) else None
        pages = record.get("living_append_pages")
        return document, list(pages) if isinstance(pages, list) else []
    history = record.get("album_version_history") or {}
    snapshot = history.get(str(edition)) if isinstance(history, dict) else None
    document, pages = unpack_edition_snapshot(snapshot)
    if document is None:
        raise HTTPException(status_code=404, detail="이전 앨범을 찾을 수 없습니다.")
    return document, pages


def _previous_edition_number(record: dict[str, Any], edition: int | None) -> int | None:
    """Return the next older saved snapshot without exposing internal versions in UI."""
    if edition is None:
        value = record.get("living_latest_edition_previous")
        return int(value) if value is not None else None
    history = record.get("album_version_history") or {}
    if not isinstance(history, dict):
        return None
    older: list[int] = []
    for key in history:
        try:
            value = int(key)
        except (TypeError, ValueError):
            continue
        if value < edition:
            older.append(value)
    return max(older) if older else None


def _batch_signed_urls_for_photos(
    client: Any,
    settings: Settings,
    photos: list[dict[str, Any]],
) -> dict[tuple[str, str], str]:
    assets: list[dict[str, Any]] = []
    for photo in photos:
        storage_bucket = str(photo.get("storage_bucket") or "")
        storage_path = str(photo.get("storage_path") or "")
        if storage_bucket and storage_path:
            assets.append({"bucket": storage_bucket, "path": storage_path})
        display_bucket = str(photo.get("display_bucket") or storage_bucket)
        display_path = str(photo.get("display_path") or "")
        if display_bucket and display_path:
            assets.append({"bucket": display_bucket, "path": display_path})
        thumb_bucket = str(photo.get("thumbnail_bucket") or "")
        thumb_path = str(photo.get("thumbnail_path") or "")
        if thumb_bucket and thumb_path:
            assets.append({"bucket": thumb_bucket, "path": thumb_path})
    if not assets:
        return {}
    return get_signed_urls_batch(client, assets, settings.signed_url_ttl_seconds)


def _album_photo_response(
    client: Any,
    settings: Settings,
    photo: dict[str, Any],
    memories: list[dict[str, Any]],
    *,
    signed_urls: dict[tuple[str, str], str] | None = None,
) -> AlbumPhotoUrlResponse:
    photo_id = str(photo["id"])
    photo_memories = [memory for memory in memories if str(memory.get("photo_id") or "") == photo_id]
    memory_comments = [
        {"author": memory.get("author_name"), "text": str(memory.get("comment") or memory.get("content") or "").strip()}
        for memory in photo_memories
        if str(memory.get("comment") or memory.get("content") or "").strip()
    ] or None
    photo_comment = str(photo.get("comment") or photo.get("caption") or "").strip() or None
    storage_bucket = str(photo["storage_bucket"])
    storage_path = str(photo["storage_path"])
    thumb_bucket = str(photo["thumbnail_bucket"])
    thumb_path = str(photo["thumbnail_path"])
    display_bucket = str(photo.get("display_bucket") or storage_bucket)
    display_path = str(photo.get("display_path") or storage_path)
    if signed_urls is not None:
        original_url = signed_urls.get((storage_bucket, storage_path), "")
        display_url = signed_urls.get((display_bucket, display_path), original_url)
        thumbnail_url = signed_urls.get((thumb_bucket, thumb_path), "")
    else:
        original_url = get_signed_url(client, storage_bucket, storage_path, settings.signed_url_ttl_seconds)
        display_url = get_signed_url(client, display_bucket, display_path, settings.signed_url_ttl_seconds)
        thumbnail_url = get_signed_url(client, thumb_bucket, thumb_path, settings.signed_url_ttl_seconds)
    return AlbumPhotoUrlResponse(
        id=UUID(photo_id),
        sort_order=int(photo.get("sort_order") or 0),
        comment=photo_comment,
        comments=memory_comments,
        original_url=original_url,
        display_url=display_url or original_url,
        thumbnail_url=thumbnail_url,
        width=photo.get("width"),
        height=photo.get("height"),
        taken_at=photo.get("taken_at"),
        latitude=photo.get("latitude"),
        longitude=photo.get("longitude"),
        location_name=photo.get("location_name"),
        location_source=photo.get("location_source"),
        orientation=photo.get("orientation"),
    )


def _living_append_payload(
    client: Any,
    settings: Settings,
    pages: list[dict[str, Any]],
    photos: list[dict[str, Any]],
    memories: list[dict[str, Any]],
    *,
    signed_urls: dict[tuple[str, str], str] | None = None,
) -> list[dict[str, Any]]:
    photo_by_id = {str(photo["id"]): photo for photo in photos}
    memory_by_id = {str(memory["id"]): memory for memory in memories}
    payload: list[dict[str, Any]] = []
    for page in pages:
        if not isinstance(page, dict):
            continue
        page_photos = [
            _album_photo_response(client, settings, photo_by_id[photo_id], memories, signed_urls=signed_urls).model_dump(mode="json")
            for photo_id in page.get("photo_ids") or []
            if str(photo_id) in photo_by_id
        ]
        page_memories = [
            {
                "id": str(memory["id"]),
                "author_name": memory.get("author_name") or "참여자",
                "content": str(memory.get("comment") or "").strip(),
                "created_at": memory.get("created_at"),
            }
            for memory_id in page.get("memory_ids") or []
            if (memory := memory_by_id.get(str(memory_id))) and str(memory.get("comment") or "").strip()
        ]
        if page_photos or page_memories:
            payload.append({
                "id": str(page.get("id") or ""),
                "type": "append_page",
                "created_at": page.get("created_at"),
                "photos": page_photos,
                "memories": page_memories,
            })
    return payload


def _living_append_page_count(record: dict[str, Any], edition: int | None) -> int:
    _, append_pages = _edition_document_and_pages(record, edition)
    return len(append_pages)


def _detail_from_record(
    record: dict[str, Any],
    settings: Settings,
    client: Any,
    *,
    edition: int | None,
    current_edition: CurrentEditionSummary,
    living_append_pages: list[dict[str, Any]] | None = None,
) -> AlbumDetailResponse:
    album_id = str(record["id"])
    image_url = get_result_signed_url(client, record, settings)
    epilogue = str(record.get("epilogue") or record.get("narrative") or "").strip()
    cover_photo_id = record.get("cover_photo_id")
    # Fill cover_image_url from a SINGLE signed cover photo (the chosen cover, else the
    # first photo). Every share path uses resolveShareImageUrl(cover_image_url || …); when
    # this was None the client fell back to image_url — the unreadable 9-grid result image.
    # Sign exactly one photo: the light detail must never sign the whole album.
    _cover_photo_records = get_album_photo_records(client, album_id)
    _resolved_cover_id, cover_image_url = _cover_image_url(client, settings, record, _cover_photo_records)
    raw_stories = record.get("chapter_stories")
    chapter_stories = (
        {str(key): str(value).strip() for key, value in raw_stories.items() if str(value).strip()}
        if isinstance(raw_stories, dict)
        else {}
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
        cover_photo_id=UUID(str(cover_photo_id)) if cover_photo_id else None,
        cover_image_url=cover_image_url,
        share_url="",
        created_at=record["created_at"],
        media=[],
        album_version=int(record.get("album_version") or 0),
        living_append_pages=list(living_append_pages or []),
        current_edition=current_edition,
        edition_previous=_previous_edition_number(record, edition),
        edition_is_latest=edition is None and bool(record.get("living_latest_edition_previous") is not None),
        saved=True,
    )


def _edition_photo_count(client: Any, record: dict[str, Any], edition: int) -> int:
    document, _ = _edition_document_and_pages(record, edition)
    document_photo_ids = album_document_photo_ids(document)
    if document_photo_ids:
        return len(document_photo_ids)
    return count_ready_album_photos(client, str(record["id"]))


def _record_to_detail_light(
    record: dict[str, Any],
    settings: Settings,
    client: Any,
    *,
    edition: int | None,
    photo_count: int,
    memory_count: int,
) -> AlbumDetailResponse:
    living_count = _living_append_page_count(record, edition)
    return _detail_from_record(
        record,
        settings,
        client,
        edition=edition,
        current_edition=CurrentEditionSummary(
            photo_count=photo_count,
            memory_count=memory_count,
            living_append_page_count=living_count,
        ),
        living_append_pages=[],
    )


def _signed_living_append_pages(
    client: Any,
    settings: Settings,
    record: dict[str, Any],
    album_id: str,
    edition: int | None,
) -> list[dict[str, Any]]:
    _, append_pages = _edition_document_and_pages(record, edition)
    if not append_pages:
        return []
    photo_ids: list[str] = []
    memory_ids: set[str] = set()
    for page in append_pages:
        if not isinstance(page, dict):
            continue
        photo_ids.extend(str(photo_id) for photo_id in (page.get("photo_ids") or []))
        memory_ids.update(str(memory_id) for memory_id in (page.get("memory_ids") or []))
    photos = get_album_photo_records_by_ids(client, album_id, photo_ids)
    memories = [
        memory
        for memory in list_photo_memories(client, album_id)
        if str(memory.get("id") or "") in memory_ids
    ] if memory_ids else []
    signed_urls = _batch_signed_urls_for_photos(client, settings, photos)
    return _living_append_payload(client, settings, append_pages, photos, memories, signed_urls=signed_urls)


def _record_to_detail(
    record: dict[str, Any], settings: Settings, client: Any, edition: int | None = None,
) -> AlbumDetailResponse:
    """Legacy full detail builder; PATCH responses use the lightweight shape."""
    album_id = str(record["id"])
    photo_count = (
        _edition_photo_count(client, record, edition)
        if edition is not None
        else count_ready_album_photos(client, album_id)
    )
    memory_count = count_album_photo_memories(client, album_id)
    return _record_to_detail_light(
        record,
        settings,
        client,
        edition=edition,
        photo_count=photo_count,
        memory_count=memory_count,
    )


@router.get("/albums/mine", response_model=MyAlbumsResponse)
async def get_my_albums(
    response: Response,
    authenticated_user_id: str = Depends(require_authenticated_user),
) -> MyAlbumsResponse:
    """List the signed-in creator's albums without exposing family/member albums."""
    started_at = time.perf_counter()
    response.headers["Cache-Control"] = "no-store"
    settings = get_settings()
    client = get_supabase_client(settings)
    records = list_owned_album_list_records(client, authenticated_user_id, limit=20)
    album_ids = [str(record["id"]) for record in records]
    photo_rows = await asyncio.to_thread(list_album_photo_list_summaries, client, album_ids)
    # Albums the user was invited to and contributed to (never owned — excluded here so an
    # owner is never double-listed).
    participating_records = list_participating_album_list_records(
        client, authenticated_user_id, set(album_ids), limit=20
    )
    participating_ids = [str(record["id"]) for record in participating_records]
    participating_photo_rows = await asyncio.to_thread(
        list_album_photo_list_summaries, client, participating_ids
    )
    payload = MyAlbumsResponse(
        albums=_attach_my_album_cover_urls(
            client,
            settings,
            authenticated_user_id,
            _my_album_list_items(client, settings, records, {}, photo_rows),
        ),
        participating=_attach_participating_cover_urls(
            client,
            settings,
            _my_album_list_items(client, settings, participating_records, {}, participating_photo_rows),
        ),
    )
    duration_ms = round((time.perf_counter() - started_at) * 1000)
    response.headers["Server-Timing"] = f"my-albums;dur={duration_ms}"
    logger.info(
        "my_albums_list_completed album_count=%s db_query_count=3 duration_ms=%s",
        len(payload.albums),
        duration_ms,
    )
    return payload


@router.get("/albums/mine/covers")
async def get_my_album_covers(
    album_ids: list[str] = Query(default=[]),
    cover_photo_ids: list[str] = Query(default=[]),
    authenticated_user_id: str = Depends(require_authenticated_user),
) -> dict[str, dict[str, str]]:
    """Fetch card cover URLs after the lightweight album-list response is already visible."""
    settings = get_settings()
    client = get_supabase_client(settings)
    # The list route is capped at 20; preserve that bound for this follow-up too.
    covers = _owned_cover_urls(
        client,
        settings,
        authenticated_user_id,
        [str(album_id) for album_id in album_ids[:20]],
        [str(photo_id) for photo_id in cover_photo_ids[:20]],
    )
    return {"covers": covers}


@router.get("/albums/{album_id}", response_model=AlbumDetailResponse)
async def get_album(
    album_id: str,
    response: Response,
    edition: int | None = None,
    authenticated_user_id: str | None = Depends(optional_strict_authenticated_user),
    guest_token: str | None = _GUEST_TOKEN_HEADER,
) -> AlbumDetailResponse:
    started_at = time.perf_counter()
    settings = get_settings()
    client = get_supabase_client(settings)
    if edition is not None:
        record = await asyncio.to_thread(get_album_detail_edition_record, client, album_id)
        if not record:
            raise HTTPException(status_code=404, detail="앨범을 찾을 수 없습니다.")
        photo_count = await asyncio.to_thread(_edition_photo_count, client, record, edition)
        memory_count = await asyncio.to_thread(count_album_photo_memories, client, album_id)
        detail = _record_to_detail_light(
            record,
            settings,
            client,
            edition=edition,
            photo_count=photo_count,
            memory_count=memory_count,
        )
    else:
        record, photo_count, memory_count = await asyncio.gather(
            asyncio.to_thread(get_album_detail_light_record, client, album_id),
            asyncio.to_thread(count_ready_album_photos, client, album_id),
            asyncio.to_thread(count_album_photo_memories, client, album_id),
        )
        if not record:
            raise HTTPException(status_code=404, detail="앨범을 찾을 수 없습니다.")
        detail = _record_to_detail_light(
            record,
            settings,
            client,
            edition=None,
            photo_count=photo_count,
            memory_count=memory_count,
        )
    access = _actor_album_access(client, record, authenticated_user_id, guest_token)
    require_album_read(access)
    detail = detail.model_copy(update={
        "can_edit": access.is_album_owner,
        "can_contribute": access.can_contribute,
        "can_delete": access.can_delete_album,
    })
    duration_ms = round((time.perf_counter() - started_at) * 1000)
    response.headers["Cache-Control"] = "no-store"
    response.headers["Server-Timing"] = f"album-detail;dur={duration_ms}"
    if authenticated_user_id and access.is_album_owner and edition is None:
        # Metric: D7 return rate = owners who revisit their album within 7 days.
        log_event(client, "album_revisited", album_id=album_id, metadata={"owner_id": authenticated_user_id})
    logger.info(
        "album_detail_completed album_id=%s edition=%s duration_ms=%s light=true",
        album_id,
        edition,
        duration_ms,
    )
    return detail


@router.get("/albums/{album_id}/living-append-pages", response_model=LivingAppendPagesResponse)
async def get_album_living_append_pages(
    album_id: str,
    edition: int | None = None,
    authenticated_user_id: str = Depends(require_authenticated_user),
) -> LivingAppendPagesResponse:
    """Signed Living Album append pages; loaded after the main album screen."""
    started_at = time.perf_counter()
    settings = get_settings()
    client = get_supabase_client(settings)
    record = await asyncio.to_thread(
        get_album_detail_edition_record if edition is not None else get_album_detail_light_record,
        client,
        album_id,
    )
    if not record:
        raise HTTPException(status_code=404, detail="앨범을 찾을 수 없습니다.")
    access = get_album_access(client, record, authenticated_user_id)
    require_album_read(access)
    pages = await asyncio.to_thread(_signed_living_append_pages, client, settings, record, album_id, edition)
    duration_ms = round((time.perf_counter() - started_at) * 1000)
    logger.info(
        "album_living_append_completed album_id=%s edition=%s page_count=%s duration_ms=%s",
        album_id,
        edition,
        len(pages),
        duration_ms,
    )
    return LivingAppendPagesResponse(living_append_pages=pages)


@router.patch("/albums/{album_id}/cover-photo", response_model=AlbumCoverPhotoResponse)
async def update_album_cover_photo(
    album_id: str,
    body: AlbumCoverPhotoUpdate,
    authenticated_user_id: str = Depends(require_authenticated_user),
) -> AlbumCoverPhotoResponse:
    settings = get_settings()
    client = get_supabase_client(settings)
    album = get_album_record(client, album_id)
    if not album:
        raise HTTPException(status_code=404, detail="앨범을 찾을 수 없습니다.")
    access = get_album_access(client, album, authenticated_user_id)
    require_album_edit_settings(access)

    photos = get_album_photo_records(client, album_id)
    requested = str(body.photo_id) if body.photo_id else None
    selected_photo = next((photo for photo in photos if str(photo.get("id")) == requested), None) if requested else None
    if requested and not selected_photo:
        raise HTTPException(status_code=400, detail="앨범에 포함된 사진만 대표사진으로 선택할 수 있습니다.")
    applied_photo_ids = {str(photo_id) for photo_id in (album.get("applied_contribution_photo_ids") or [])}
    if selected_photo and selected_photo.get("uploaded_by_contributor_id") and requested not in applied_photo_ids:
        raise HTTPException(status_code=400, detail="앨범에 반영된 사진만 대표사진으로 선택할 수 있습니다.")
    selected_id = requested or (str(photos[0]["id"]) if photos else None)
    client.table("albums").update({"cover_photo_id": selected_id}).eq("id", album_id).execute()
    log_event(client, "cover_photo_changed", album_id=album_id, metadata={"owner_id": authenticated_user_id})
    updated_album = {**album, "cover_photo_id": selected_id}
    cover_photo_id, cover_image_url = _cover_image_url(client, settings, updated_album, photos)
    return AlbumCoverPhotoResponse(
        cover_photo_id=UUID(cover_photo_id) if cover_photo_id else None,
        cover_image_url=cover_image_url,
    )


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
    authenticated_user_id: str | None = Depends(optional_strict_authenticated_user),
    guest_token: str | None = _GUEST_TOKEN_HEADER,
) -> AlbumDetailResponse:
    settings = get_settings()
    client = get_supabase_client(settings)
    record = get_album_record(client, album_id)
    if not record:
        raise HTTPException(status_code=404, detail="앨범을 찾을 수 없습니다.")
    access = _actor_album_access(client, record, authenticated_user_id, guest_token)
    require_album_owner_story(access)

    epilogue = body.epilogue.strip()
    updated = update_album_epilogue(client, album_id, epilogue)
    return _record_to_detail(updated or {**record, "epilogue": epilogue, "narrative": epilogue}, settings, client)


@router.patch("/albums/{album_id}/title", response_model=AlbumDetailResponse)
async def patch_album_title(
    album_id: str,
    body: AlbumTitleUpdate,
    authenticated_user_id: str | None = Depends(optional_strict_authenticated_user),
    guest_token: str | None = _GUEST_TOKEN_HEADER,
) -> AlbumDetailResponse:
    settings = get_settings()
    client = get_supabase_client(settings)
    record = get_album_record(client, album_id)
    if not record:
        raise HTTPException(status_code=404, detail="앨범을 찾을 수 없습니다.")
    access = _actor_album_access(client, record, authenticated_user_id, guest_token)
    require_album_owner_story(access)

    title = body.title.strip()
    updated = update_album_title(client, album_id, title)
    return _record_to_detail(updated or {**record, "title": title}, settings, client)


@router.patch("/albums/{album_id}/chapter-story", response_model=AlbumDetailResponse)
async def patch_chapter_story(
    album_id: str,
    body: ChapterStoryUpdate,
    authenticated_user_id: str | None = Depends(optional_strict_authenticated_user),
    guest_token: str | None = _GUEST_TOKEN_HEADER,
) -> AlbumDetailResponse:
    """Owner-only edit of a single date story (chapter_stories[date]). Empty removes it."""
    settings = get_settings()
    client = get_supabase_client(settings)
    record = get_album_record(client, album_id)
    if not record:
        raise HTTPException(status_code=404, detail="앨범을 찾을 수 없습니다.")
    access = _actor_album_access(client, record, authenticated_user_id, guest_token)
    require_album_owner_story(access)

    date = body.date.strip()
    story = body.story.strip()
    stories = dict(record.get("chapter_stories") or {})
    if story:
        stories[date] = story
    else:
        stories.pop(date, None)
    updated = update_album_chapter_stories(client, album_id, stories)
    return _record_to_detail(updated or {**record, "chapter_stories": stories}, settings, client)


@router.post("/guest-albums/claim")
async def claim_guest_album(
    body: GuestAlbumClaimRequest,
    authenticated_user_id: str = Depends(require_authenticated_user),
) -> dict[str, str]:
    """Transfer a guest-created album to the now-logged-in account (owner claim)."""
    client = get_supabase_client(get_settings())
    limits = get_user_limits(authenticated_user_id)
    # A session already claimed by this same user re-claims idempotently (it is
    # already counted), so it must never be blocked by the limit.
    session = guest_album_service.get_guest_session(client, body.guest_token)
    already_mine = bool(session and session.get("status") == "claimed" and str(session.get("claimed_profile_id") or "") == authenticated_user_id)
    if not already_mine and count_owned_albums(client, authenticated_user_id) >= limits["max_albums"]:
        # Preserve the data AND the limit: refuse the claim but push the guest
        # session's expiry out 7 days so the user can tidy up and save it later.
        # We never delete an album to enforce the limit.
        guest_album_service.extend_guest_session(client, body.guest_token, days=7)
        # album_limit_reached: abuse-detection signal, not a paywall. Don't expose the
        # number. Dedicated event name — a claim rejection is not an upload failure.
        log_event(client, "album_limit_reached", metadata={"owner_id": authenticated_user_id})
        raise HTTPException(
            status_code=403,
            detail="앨범을 너무 많이 만들었어요. 잠시 후 다시 시도해 주세요.",
        )
    family_id = ensure_default_family(client, authenticated_user_id)
    album_id = guest_album_service.claim_guest_album(client, body.guest_token, authenticated_user_id, family_id)
    log_event(client, "guest_album_claimed", album_id=album_id, metadata={"owner_id": authenticated_user_id})
    return {"album_id": album_id, "family_id": family_id}


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

    url = get_signed_url(client, get_cached_pdf_bucket(record, f"{target_version}:r{renderer_version}", settings.supabase_storage_bucket), cached_path, settings.signed_url_ttl_seconds)
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

    path = album_pdf_path(album_id, str(uuid4()))
    StorageService.for_supabase(client, settings).upload(
        settings.supabase_private_storage_bucket, path, content, content_type="application/pdf"
    )
    set_cached_pdf_path(client, record, f"{version}:r{renderer_version}", path, settings.supabase_private_storage_bucket)
    log_event(client, "pdf_generated", album_id=album_id, metadata={"owner_id": authenticated_user_id})
    url = get_signed_url(client, settings.supabase_private_storage_bucket, path, settings.signed_url_ttl_seconds)
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
    if not access.is_album_owner:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not have permission to delete this album.")

    # Snapshot every object path before the DB transaction.  The delete RPC
    # removes photo/media rows, so querying after it would leak all assets.
    photo_assets = get_album_photo_asset_records(client, album_id)
    media_assets = get_album_media_asset_records(client, album_id)
    cleanup_plan = cleanup_album_files(
        client,
        settings,
        record,
        photo_rows=photo_assets,
        media_rows=media_assets,
        dry_run=True,
    )
    logger.info(
        "album_delete_db_start album_id=%s operation_id=%s storage_paths=%s",
        album_id[:6],
        get_operation_id(),
        sum(len(paths) for paths in cleanup_plan.values()),
    )
    if not delete_album_cascade(client, album_id, authenticated_user_id):
        # The album vanished or its owner changed between the initial lookup
        # and the transaction.  Do not delete any Storage objects.
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Album not found.")
    cleanup_album_files(
        client,
        settings,
        record,
        photo_rows=photo_assets,
        media_rows=media_assets,
        dry_run=False,
        remove_album_prefix=True,
    )
    logger.info("album_delete_completed album_id=%s operation_id=%s", album_id[:6], get_operation_id())
    return Response(status_code=status.HTTP_204_NO_CONTENT)
