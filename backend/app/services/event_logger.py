"""Central, best-effort operational event logger.

Analytics events remain in the existing ``analytics_events`` table.  This
module adds correlation metadata and structured application logs, so no schema
or product behavior changes are required.
"""
from __future__ import annotations

import logging
from typing import Any

from postgrest.exceptions import APIError
from supabase import Client

from app.services.operations import get_operation_id, get_operation_name

logger = logging.getLogger(__name__)

ALLOWED_METADATA_KEYS = frozenset({
    "source", "reaction", "owner_id", "previous_version", "new_version",
    "started_at", "completed_at", "duration_ms", "applied_photo_count",
    "applied_memory_count", "failure_code", "mode", "photo_count",
    "memory_count", "selected_mode", "previous_edition", "new_edition",
    "operation_id", "operation_name", "success", "error_code", "video_count", "album_count",
})


class EventLogger:
    """The only writer for product and operational events."""

    @staticmethod
    def record(
        client: Client,
        event_name: str,
        *,
        album_id: str | None = None,
        share_link_id: str | None = None,
        metadata: dict[str, Any] | None = None,
        visitor_key: str | None = None,
    ) -> bool:
        enriched = dict(metadata or {})
        if get_operation_id():
            enriched.setdefault("operation_id", get_operation_id())
        if get_operation_name():
            enriched.setdefault("operation_name", get_operation_name())
        safe_metadata = {key: value for key, value in enriched.items() if key in ALLOWED_METADATA_KEYS}
        row: dict[str, Any] = {"event_name": event_name, "metadata": safe_metadata}
        # 방문자를 사람 단위로 세기 위한 익명 키(§1). 만들 수 없으면 넣지 않는다 —
        # 그 행은 세어지지 않는다(사람을 구분할 수 없는 값이라 세면 다시 호출 수가 된다).
        if visitor_key:
            row["visitor_key"] = visitor_key
        if album_id:
            row["album_id"] = album_id
        if share_link_id:
            row["share_link_id"] = share_link_id
        try:
            client.table("analytics_events").insert(row).execute()
            logger.info(
                "event_recorded event_name=%s operation_id=%s album_id=%s share_link_id=%s",
                event_name, get_operation_id(), album_id, share_link_id,
            )
            return True
        except APIError as exc:
            logger.warning(
                "event_record_failed event_name=%s operation_id=%s status_code=400 supabase_code=%s message=%s",
                event_name, get_operation_id(), getattr(exc, "code", None), getattr(exc, "message", None),
            )
            return False
        except Exception as exc:
            logger.warning(
                "event_record_failed event_name=%s operation_id=%s error_type=%s message=%s",
                event_name, get_operation_id(), type(exc).__name__, str(exc)[:240],
            )
            return False
