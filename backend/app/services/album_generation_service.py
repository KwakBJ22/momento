"""Persisted, in-process work for the first album creation flow.

FastAPI BackgroundTasks runs this after the upload response.  The job row is
the source of truth, so an interrupted Railway process leaves a recoverable
failed job rather than an album stuck in a loading screen.
"""
from __future__ import annotations

import asyncio
import logging
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

from app.config import Settings, get_settings
from app.services.image_service import bytes_to_images, generate_album, image_to_png_bytes
from app.services.image_upload_service import build_derived_image_bytes
from app.services.openai_service import generate_narrative
from app.services.question_service import generate_album_questions
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
    if str(job.get("status")) != "processing":
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
    client.table("album_generation_jobs").update({
        "status": "failed", "error_code": "stale_processing", "current_step": "upload_completed",
        "retry_count": int(job.get("retry_count") or 0) + 1,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", job["id"]).eq("status", "processing").execute()
    client.table("albums").update({"status": "failed"}).eq("id", job["album_id"]).execute()
    return _job_row(client, str(job["id"])) or job


def generation_status(client: Any, album_id: str) -> dict[str, Any] | None:
    job = get_generation_job_for_album(client, album_id)
    return recover_stale_generation_job(client, job) if job else None


def _generation_photos(client: Any, album_id: str) -> list[dict[str, Any]]:
    rows = (
        client.table("album_photos").select(
            "id,storage_bucket,storage_path,display_bucket,display_path,thumbnail_bucket,thumbnail_path,"
            "mime_type,sort_order,comment,caption,legacy_author_label,taken_at,latitude,longitude,orientation,width,height"
        ).eq("album_id", album_id).is_("deleted_at", "null").order("sort_order").execute().data or []
    )
    return list(rows)


def _process_single_photo(client: Any, settings: Settings, album_id: str, photo: dict[str, Any]) -> bytes:
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
    except Exception as exc:
        # A web derivative must never discard a successfully uploaded original.
        logger.warning("album_derivative_failed album_id=%s photo_id=%s error_type=%s", album_id[:6], str(photo["id"])[:6], type(exc).__name__)
        display_path = path
        thumbnail_path = path
        display = None
    client.table("album_photos").update({
        "display_bucket": bucket, "display_path": display_path,
        "thumbnail_bucket": bucket, "thumbnail_path": thumbnail_path, "status": "ready",
    }).eq("id", photo["id"]).eq("album_id", album_id).execute()
    client.table("album_media").update({
        "thumbnail_path": thumbnail_path, "processing_status": "ready",
    }).eq("id", photo["id"]).eq("album_id", album_id).execute()
    return display if display is not None else original


async def run_initial_album_generation(job_id: str) -> None:
    settings = get_settings()
    client = get_supabase_client(settings)
    job = _job_row(client, job_id)
    if not job or str(job.get("status")) in {"completed", "processing"}:
        return
    album_id = str(job["album_id"])
    started = time.perf_counter()
    try:
        update_generation_job(client, job_id, status="processing", progress=25, current_step="processing_images")
        album = get_album_record(client, album_id)
        if not album:
            raise RuntimeError("album_missing")
        photos = _generation_photos(client, album_id)
        if not photos:
            raise RuntimeError("photos_missing")
        concurrency = max(1, min(6, int(getattr(settings, "image_processing_concurrency", 4))))
        display_bytes: dict[str, bytes] = {}
        image_started = time.perf_counter()
        for start in range(0, len(photos), concurrency):
            batch = photos[start:start + concurrency]
            results = await asyncio.gather(*[
                asyncio.to_thread(_process_single_photo, client, settings, album_id, photo) for photo in batch
            ])
            for photo, content in zip(batch, results):
                display_bytes[str(photo["id"])] = content
            processed_count = min(len(photos), start + len(batch))
            update_generation_job(client, job_id, progress=25 + int((processed_count / len(photos)) * 30), current_step="processing_images")
        image_ms = round((time.perf_counter() - image_started) * 1000)

        update_generation_job(client, job_id, progress=60, current_step="arranging_photos")
        stories = [
            {"order": int(photo.get("sort_order") or 0), "user": str(photo.get("legacy_author_label") or ""),
             "text": str(photo.get("comment") or photo.get("caption") or ""), "_path": str(photo.get("storage_path") or "")}
            for photo in photos
        ]
        media_records = [{"id": str(photo["id"]), "width": photo.get("width"), "height": photo.get("height"),
                          "taken_at": photo.get("taken_at"), "orientation": photo.get("orientation")} for photo in photos]
        update_generation_job(client, job_id, progress=65, current_step="building_story")
        story_started = time.perf_counter()
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
        update_generation_job(client, job_id, progress=85, current_step="building_album")
        build_started = time.perf_counter()
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
        update_generation_job(client, job_id, status="completed", progress=100, current_step="completed", completed=True)
        logger.info("album_generation_completed job_id=%s album_id=%s photo_count=%s image_processing_ms=%s story_generation_ms=%s album_build_ms=%s total_generation_ms=%s",
                    job_id[:6], album_id[:6], len(photos), image_ms, story_ms, build_ms, round((time.perf_counter() - started) * 1000))
    except Exception as exc:
        logger.exception("album_generation_failed job_id=%s album_id=%s error_type=%s", job_id[:6], album_id[:6], type(exc).__name__)
        try:
            update_generation_job(client, job_id, status="failed", current_step="failed", error_code="generation_failed", completed=True)
            client.table("albums").update({"status": "failed"}).eq("id", album_id).execute()
        except Exception:
            logger.exception("album_generation_failure_state_update_failed job_id=%s", job_id[:6])
