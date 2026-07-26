"""Best-effort analytics writes to public.analytics_events."""

from __future__ import annotations

from typing import Any

from supabase import Client

from app.services.event_logger import EventLogger


def insert_analytics_event(
    client: Client,
    event_name: str,
    *,
    album_id: str | None = None,
    share_link_id: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> bool:
    """Compatibility entry point delegating to the central event logger."""
    return EventLogger.record(
        client,
        event_name,
        album_id=album_id,
        share_link_id=share_link_id,
        metadata=metadata,
    )
