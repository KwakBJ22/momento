"""Helpers for chronological photo ordering and album date cover labels."""

from __future__ import annotations

from datetime import datetime
from typing import Any, TypeVar

from app.services.exif_service import format_cover_date
from app.services.image_upload_service import ProcessedPhoto

T = TypeVar("T")


def sort_key_taken_at(taken_at: datetime | None, upload_order: int) -> tuple[bool, datetime | float, int]:
    """taken_at ASC, missing last; then upload_order ASC."""
    if taken_at is None:
        return (True, 0.0, upload_order)
    return (False, taken_at.timestamp(), upload_order)


def sort_photo_entries(entries: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """
    Each entry must include:
      - processed: ProcessedPhoto
      - upload_order: int
    Returns a new list sorted by taken_at then upload_order, with sort_order reassigned.
    """
    ordered = sorted(
        entries,
        key=lambda item: sort_key_taken_at(
            getattr(item.get("processed"), "taken_at", None),
            int(item.get("upload_order", 0)),
        ),
    )
    for index, item in enumerate(ordered):
        item["sort_order"] = index
        story = item.get("story")
        if isinstance(story, dict):
            story["order"] = index
    return ordered


def cover_date_from_processed(photos: list[ProcessedPhoto]) -> str:
    taken = [photo.taken_at for photo in photos if photo.taken_at is not None]
    return format_cover_date(taken)


def group_photos_by_taken_date(entries: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """
    Structure-only date grouping for future day-section UI.
    Groups share the same UTC calendar day; entries without taken_at go to key "".
    """
    buckets: dict[str, list[dict[str, Any]]] = {}
    for item in entries:
        processed: ProcessedPhoto | None = item.get("processed")
        taken = processed.taken_at if processed else None
        key = taken.date().isoformat() if taken else ""
        buckets.setdefault(key, []).append(item)
    groups: list[dict[str, Any]] = []
    for key in sorted(buckets.keys(), key=lambda value: (value == "", value)):
        groups.append(
            {
                "date_key": key or None,
                "label": key.replace("-", ".") if key else None,
                "photos": buckets[key],
            }
        )
    return groups
