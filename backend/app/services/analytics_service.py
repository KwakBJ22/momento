"""Best-effort analytics writes to public.analytics_events."""

from __future__ import annotations

import logging
from typing import Any

from postgrest.exceptions import APIError
from supabase import Client

logger = logging.getLogger(__name__)

ALLOWED_METADATA_KEYS = frozenset({"source", "reaction"})


def _build_row(
    event_name: str,
    *,
    album_id: str | None = None,
    share_link_id: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    safe_metadata = {key: value for key, value in (metadata or {}).items() if key in ALLOWED_METADATA_KEYS}
    row: dict[str, Any] = {
        "event_name": event_name,
        "metadata": safe_metadata,
    }
    if album_id:
        row["album_id"] = album_id
    if share_link_id:
        row["share_link_id"] = share_link_id
    return row


def _log_api_error(event_name: str, columns: list[str], exc: APIError) -> None:
    logger.warning(
        "analytics_event_insert_failed event_name=%s columns=%s status_code=%s supabase_code=%s message=%s details=%s hint=%s",
        event_name,
        columns,
        "400",
        getattr(exc, "code", None),
        getattr(exc, "message", None),
        getattr(exc, "details", None),
        getattr(exc, "hint", None),
    )


def insert_analytics_event(
    client: Client,
    event_name: str,
    *,
    album_id: str | None = None,
    share_link_id: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> bool:
    """Insert one analytics row. Returns True on success; never raises."""
    row = _build_row(event_name, album_id=album_id, share_link_id=share_link_id, metadata=metadata)
    columns = list(row.keys())
    try:
        client.table("analytics_events").insert(row).execute()
        logger.info("analytics_event_inserted event_name=%s columns=%s", event_name, columns)
        return True
    except APIError as exc:
        _log_api_error(event_name, columns, exc)
        return False
    except Exception as exc:
        logger.warning(
            "analytics_event_insert_failed event_name=%s columns=%s status_code=%s supabase_code=%s message=%s details=%s hint=%s",
            event_name,
            columns,
            None,
            type(exc).__name__,
            str(exc)[:240],
            None,
            None,
        )
        return False
