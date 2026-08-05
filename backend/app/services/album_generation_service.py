"""Persisted, in-process work for the first album creation flow.

FastAPI BackgroundTasks runs this after the upload response.  The job row is
the source of truth, so an interrupted Railway process leaves a recoverable
failed job rather than an album stuck in a loading screen.
"""
from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from app.config import Settings, get_settings
from app.models.album_photo_status import promote_legacy_uploading_album_photos, ready_album_photo_query
from app.services.image_service import bytes_to_images, generate_album, image_to_png_bytes
from app.services.image_upload_service import build_derived_image_bytes
from app.services.openai_service import generate_narrative
from app.services.question_service import generate_album_questions
from app.services.share_service import log_event
from app.services.storage_service import StorageService
from app.services.supabase import (
    get_album_record,
    get_supabase_client,
    upload_album_photo_derivatives,
    upload_result_image,
)
from app.services.story_rules import MIN_DATE_STORY_PHOTO_COUNT, photo_date_key

logger = logging.getLogger(__name__)
_STALE_AFTER = timedelta(minutes=30)


def _short(value: Any) -> str:
    return str(value or "")[:8]


def _milliseconds(started_at: float) -> int:
    return round((time.perf_counter() - started_at) * 1000)


@dataclass(frozen=True)
class DerivativeResult:
    content: bytes
    fallback_used: bool
    display_ready: bool
    thumbnail_ready: bool
    original_bytes: int
    display_bytes: int
    thumbnail_bytes: int
    elapsed_ms: int


def _job_row(client: Any, job_id: str) -> dict[str, Any] | None:
    rows = client.table("album_generation_jobs").select("*").eq("id", job_id).limit(1).execute().data or []
    return rows[0] if rows else None


def get_generation_job_for_album(client: Any, album_id: str) -> dict[str, Any] | None:
    rows = (
        client.table("album_generation_jobs").select("*").eq("album_id", album_id)
        .order("created_at", desc=True).limit(1).execute().data or []
    )
    return rows[0] if rows else None


def create_generation_job(client: Any, album_id: str) -> dict[str, Any]:
    existing = get_generation_job_for_album(client, album_id)
    if existing and str(existing.get("status")) in {"pending", "processing", "completed"}:
        return existing
    payload = {"album_id": album_id, "status": "pending", "progress": 20, "current_step": "upload_completed"}
    rows = client.table("album_generation_jobs").insert(payload).execute().data or []
    if not rows:
        raise RuntimeError("album generation job was not created")
    return rows[0]


def update_generation_job(client: Any, job_id: str, *, status: str | None = None, progress: int | None = None,
                          current_step: str | None = None, error_code: str | None = None,
                          completed: bool = False) -> None:
    payload: dict[str, Any] = {"updated_at": datetime.now(timezone.utc).isoformat()}
    if status is not None:
        payload["status"] = status
    if progress is not None:
        payload["progress"] = max(0, min(100, int(progress)))
    if current_step is not None:
        payload["current_step"] = current_step
    if error_code is not None:
        payload["error_code"] = error_code
    if status == "processing":
        payload["started_at"] = payload["updated_at"]
    if completed:
        payload["completed_at"] = payload["updated_at"]
    client.table("album_generation_jobs").update(payload).eq("id", job_id).execute()


def recover_stale_generation_job(client: Any, job: dict[str, Any]) -> dict[str, Any]:
    status = str(job.get("status"))
    if status not in {"pending", "processing"}:
        return job
    raw = str(job.get("updated_at") or "")
    try:
        updated_at = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        if updated_at.tzinfo is None:
            updated_at = updated_at.replace(tzinfo=timezone.utc)
    except ValueError:
        return job
    if datetime.now(timezone.utc) - updated_at <= _STALE_AFTER:
        return job
    stale_code = "stale_pending" if status == "pending" else "stale_processing"
    client.table("album_generation_jobs").update({
        "status": "failed", "error_code": stale_code, "current_step": "upload_completed",
        "retry_count": int(job.get("retry_count") or 0) + 1,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", job["id"]).eq("status", status).execute()
    client.table("albums").update({"status": "failed"}).eq("id", job["album_id"]).execute()
    return _job_row(client, str(job["id"])) or job


def generation_status(client: Any, album_id: str) -> dict[str, Any] | None:
    job = get_generation_job_for_album(client, album_id)
    return recover_stale_generation_job(client, job) if job else None


def _generation_photos(client: Any, album_id: str) -> list[dict[str, Any]]:
    # Creation, retry, and background generation share the same ready-only
    # input rule. Recover the narrow legacy state before applying it.
    promote_legacy_uploading_album_photos(client, album_id)
    rows = (
        ready_album_photo_query(client.table("album_photos").select(
            "id,storage_bucket,storage_path,display_bucket,display_path,thumbnail_bucket,thumbnail_path,"
            "mime_type,sort_order,comment,caption,legacy_author_label,taken_at,latitude,longitude,orientation,width,height"
        )).eq("album_id", album_id).is_("deleted_at", "null").order("sort_order").execute().data or []
    )
    # album_media and album_photos are dual-written. Exclude legacy rows whose
    # media record was already deleted by an older endpoint implementation.
    media_rows = client.table("album_media").select("id,deleted_at").eq("album_id", album_id).execute().data or []
    media_deleted = {str(row.get("id")) for row in media_rows if row.get("id") and row.get("deleted_at")}
    # Collaboration uploads predate album_media and therefore have no media
    # row. Keep those valid photo rows, but reject a legacy photo whose paired
    # media record was explicitly deleted by the old media endpoint.
    return [row for row in rows if str(row.get("id")) not in media_deleted]


def has_current_generation_photos(client: Any, album_id: str) -> bool:
    return bool(_generation_photos(client, album_id))


def _process_single_photo(client: Any, settings: Settings, album_id: str, photo: dict[str, Any]) -> DerivativeResult:
    started_at = time.perf_counter()
    bucket = str(photo.get("storage_bucket") or settings.supabase_private_storage_bucket)
    path = str(photo.get("storage_path") or "")
    if not path:
        raise RuntimeError("missing_original_path")
    original = StorageService.for_supabase(client, settings).download(bucket, path)
    mime_type = str(photo.get("mime_type") or "image/jpeg")
    try:
        display, thumbnail = build_derived_image_bytes(original, original_mime_type=mime_type, settings=settings)
        extension = Path(path).suffix.lstrip(".") or "jpg"
        display_path, thumbnail_path = upload_album_photo_derivatives(
            client, album_id=album_id, photo_id=str(photo["id"]), original_extension=extension,
            original_mime_type=mime_type, display_bytes=display, thumbnail_bytes=thumbnail, settings=settings,
        )
        display_size = len(display or original)
        thumbnail_size = len(thumbnail)
        fallback_used = False
    except Exception:
        # A web derivative must never discard a successfully uploaded original.
        # But a silent fallback leaves display_path = storage_path (the ~1MB original
        # is served to every screen) with no trace — always log the actual exception.
        logger.exception(
            "event=derivative_fallback album_id=%s photo_id=%s mime=%s bytes=%s",
            album_id,
            photo.get("id"),
            mime_type,
            len(original),
        )
        display_path = path
        thumbnail_path = path
        display = None
        display_size = 0
        thumbnail_size = 0
        fallback_used = True
    client.table("album_photos").update({
        "display_bucket": bucket, "display_path": display_path,
        "thumbnail_bucket": bucket, "thumbnail_path": thumbnail_path, "status": "ready",
    }).eq("id", photo["id"]).eq("album_id", album_id).execute()
    client.table("album_media").update({
        "thumbnail_path": thumbnail_path, "processing_status": "ready",
    }).eq("id", photo["id"]).eq("album_id", album_id).execute()
    return DerivativeResult(
        content=display if display is not None else original,
        fallback_used=fallback_used,
        display_ready=not fallback_used,
        thumbnail_ready=not fallback_used,
        original_bytes=len(original),
        display_bytes=display_size,
        thumbnail_bytes=thumbnail_size,
        elapsed_ms=_milliseconds(started_at),
    )


async def run_initial_album_generation(job_id: str) -> None:
    settings = get_settings()
    client = get_supabase_client(settings)
    job = _job_row(client, job_id)
    if not job or str(job.get("status")) in {"completed", "processing"}:
        return
    album_id = str(job["album_id"])
    started = time.perf_counter()
    current_step = "background_start"
    try:
        try:
            created_at = datetime.fromisoformat(str(job.get("created_at") or "").replace("Z", "+00:00"))
            if created_at.tzinfo is None:
                created_at = created_at.replace(tzinfo=timezone.utc)
            background_start_delay_ms = max(0, round((datetime.now(timezone.utc) - created_at).total_seconds() * 1000))
        except ValueError:
            background_start_delay_ms = 0
        logger.info("event=album_generation_background_started album_id=%s job_id=%s background_start_delay_ms=%s", _short(album_id), _short(job_id), background_start_delay_ms)
        update_generation_job(client, job_id, status="processing", progress=25, current_step="processing_images")
        current_step = "processing_images"
        album = get_album_record(client, album_id)
        if not album:
            raise RuntimeError("album_missing")
        photos = _generation_photos(client, album_id)
        if not photos:
            raise RuntimeError("no_current_photos")
        concurrency = max(1, min(6, int(getattr(settings, "image_processing_concurrency", 4))))
        display_bytes: dict[str, bytes] = {}
        derivative_results: list[DerivativeResult] = []
        image_started = time.perf_counter()
        logger.info("event=image_processing_started album_id=%s job_id=%s photo_count=%s concurrency=%s", _short(album_id), _short(job_id), len(photos), concurrency)
        last_persisted_progress = 25
        for start in range(0, len(photos), concurrency):
            batch = photos[start:start + concurrency]
            results = await asyncio.gather(*[
                asyncio.to_thread(_process_single_photo, client, settings, album_id, photo) for photo in batch
            ])
            for photo, result in zip(batch, results):
                display_bytes[str(photo["id"])] = result.content
                derivative_results.append(result)
            processed_count = min(len(photos), start + len(batch))
            next_progress = 25 + int((processed_count / len(photos)) * 30)
            if next_progress - last_persisted_progress >= 3 or processed_count == len(photos):
                update_generation_job(client, job_id, progress=next_progress, current_step="processing_images")
                last_persisted_progress = next_progress
        image_ms = round((time.perf_counter() - image_started) * 1000)
        fallback_count = sum(1 for result in derivative_results if result.fallback_used)
        display_success_count = sum(1 for result in derivative_results if result.display_ready)
        thumbnail_success_count = sum(1 for result in derivative_results if result.thumbnail_ready)
        total_original_bytes = sum(result.original_bytes for result in derivative_results)
        total_display_bytes = sum(result.display_bytes for result in derivative_results)
        total_thumbnail_bytes = sum(result.thumbnail_bytes for result in derivative_results)
        max_photo_ms = max((result.elapsed_ms for result in derivative_results), default=0)
        average_photo_ms = round(sum(result.elapsed_ms for result in derivative_results) / len(derivative_results)) if derivative_results else 0
        if fallback_count:
            logger.warning("event=image_derivative_failed album_id=%s job_id=%s photo_count=%s fallback_count=%s", _short(album_id), _short(job_id), len(photos), fallback_count)
        logger.info(
            "event=image_processing_completed%s album_id=%s job_id=%s photo_count=%s display_success_count=%s thumbnail_success_count=%s fallback_count=%s concurrency=%s average_photo_ms=%s max_photo_ms=%s image_processing_ms=%s original_avg_bytes=%s display_avg_bytes=%s thumbnail_avg_bytes=%s",
            "_with_fallback" if fallback_count else "", _short(album_id), _short(job_id), len(photos), display_success_count,
            thumbnail_success_count, fallback_count, concurrency, average_photo_ms, max_photo_ms, image_ms,
            round(total_original_bytes / len(photos)), round(total_display_bytes / len(photos)), round(total_thumbnail_bytes / len(photos)),
        )

        update_generation_job(client, job_id, progress=60, current_step="arranging_photos")
        current_step = "arranging_photos"
        stories = [
            {"order": int(photo.get("sort_order") or 0), "user": str(photo.get("legacy_author_label") or ""),
             "text": str(photo.get("comment") or photo.get("caption") or ""), "_path": str(photo.get("storage_path") or "")}
            for photo in photos
        ]
        media_records = [{"id": str(photo["id"]), "width": photo.get("width"), "height": photo.get("height"),
                          "taken_at": photo.get("taken_at"), "orientation": photo.get("orientation")} for photo in photos]
        update_generation_job(client, job_id, progress=65, current_step="building_story")
        current_step = "building_story"
        story_started = time.perf_counter()
        logger.info("event=story_generation_started album_id=%s job_id=%s photo_count=%s", _short(album_id), _short(job_id), len(photos))
        narrative = await generate_narrative(
            stories, str(album.get("meeting_type") or "friend"), str(album.get("title") or "우리의 추억"), settings,
            event_date=str(album.get("event_date") or ""), description="Create the album's closing story from the uploaded photos and captions.",
            existing_answers="", media_records=media_records, category=album.get("category"),
            template_type=album.get("template_type"), client=client, album_id=album_id,
            family_id=album.get("family_id"), actor_profile_id=album.get("owner_id"),
        )
        chapter_inputs: dict[str, list[dict[str, Any]]] = {}
        for photo, story in zip(photos, stories):
            key = photo_date_key(photo)
            if key != "0":
                chapter_inputs.setdefault(key, []).append(story)
        chapter_stories: dict[str, str] = {}
        for key, values in chapter_inputs.items():
            if len(values) >= MIN_DATE_STORY_PHOTO_COUNT:
                chapter_stories[key] = await generate_narrative(
                    values, str(album.get("meeting_type") or "friend"), str(album.get("title") or "우리의 추억"), settings,
                    event_date=key, description="Create one factual date episode in 3 to 6 short Korean lines. No heading.",
                    existing_answers="", media_records=[], category=album.get("category"), template_type=album.get("template_type"),
                    client=client, album_id=album_id, family_id=album.get("family_id"), actor_profile_id=album.get("owner_id"),
                )
        story_ms = round((time.perf_counter() - story_started) * 1000)
        logger.info("event=story_generation_completed album_id=%s job_id=%s photo_count=%s story_generation_ms=%s", _short(album_id), _short(job_id), len(photos), story_ms)
        update_generation_job(client, job_id, progress=85, current_step="building_album")
        current_step = "building_album"
        build_started = time.perf_counter()
        logger.info("event=album_build_started album_id=%s job_id=%s photo_count=%s", _short(album_id), _short(job_id), len(photos))
        image = generate_album(
            str(album.get("template") or "A"),
            photos=bytes_to_images([display_bytes[str(photo["id"])] for photo in photos]), stories=stories,
            title=str(album.get("title") or "우리의 추억"), date=str(album.get("event_date") or ""), narrative=None,
        )
        result_path = upload_result_image(client, album_id, image_to_png_bytes(image), settings)
        photo_paths = [str(photo.get("storage_path") or "") for photo in photos]
        photo_meta = [{"order": story["order"], "user": story["user"], "text": story["text"], "path": story["_path"],
                       "taken_at": photo.get("taken_at")} for photo, story in zip(photos, stories)]
        client.table("albums").update({
            "narrative": narrative, "epilogue": narrative, "chapter_stories": chapter_stories,
            "photo_paths": photo_paths, "photo_meta": photo_meta, "result_path": result_path,
            "result_bucket": settings.supabase_private_storage_bucket, "status": "active",
        }).eq("id", album_id).execute()
        try:
            await generate_album_questions(client, album_id=album_id, album={"id": album_id, "title": album.get("title"),
                "event_date": album.get("event_date"), "meeting_type": album.get("meeting_type"), "narrative": narrative},
                media_records=media_records, force=False, settings=settings)
        except Exception:
            logger.info("album_questions_deferred album_id=%s", album_id[:6])
        build_ms = round((time.perf_counter() - build_started) * 1000)
        logger.info("event=album_build_completed album_id=%s job_id=%s photo_count=%s album_build_ms=%s", _short(album_id), _short(job_id), len(photos), build_ms)
        update_generation_job(client, job_id, status="completed", progress=100, current_step="completed", completed=True)
        # Metric: album completion rate = album_created / upload_started.
        log_event(client, "album_created", album_id=album_id, metadata={"photo_count": len(photos)})
        logger.info("event=album_generation_completed album_id=%s job_id=%s photo_count=%s background_start_delay_ms=%s image_processing_ms=%s story_generation_ms=%s album_build_ms=%s total_generation_ms=%s status=completed",
                    _short(album_id), _short(job_id), len(photos), background_start_delay_ms, image_ms, story_ms, build_ms, _milliseconds(started))
    except Exception as exc:
        failure_event = {
            "building_story": "story_generation_failed",
            "building_album": "album_build_failed",
        }.get(current_step, "album_generation_failed")
        error_code = "no_current_photos" if str(exc) == "no_current_photos" else "generation_failed"
        logger.exception("event=%s album_id=%s job_id=%s current_step=%s photo_count=%s elapsed_ms=%s error_code=%s retry_count=%s error_type=%s",
                         failure_event, _short(album_id), _short(job_id), current_step, len(locals().get("photos", [])), _milliseconds(started), error_code, int(job.get("retry_count") or 0), type(exc).__name__)
        try:
            update_generation_job(client, job_id, status="failed", current_step="failed", error_code=error_code, completed=True)
            client.table("albums").update({"status": "failed"}).eq("id", album_id).execute()
        except Exception:
            logger.exception("album_generation_failure_state_update_failed job_id=%s", job_id[:6])
