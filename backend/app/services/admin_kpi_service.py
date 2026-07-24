"""Admin KPI calculators — extend here when new product metrics are instrumented."""

from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Any

from supabase import Client


def _parse_ts(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    text = str(value).strip()
    if not text:
        return None
    if text.endswith("Z"):
        text = f"{text[:-1]}+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _start_of_day_utc(day: date | None = None) -> datetime:
    target = day or _utc_now().date()
    return datetime(target.year, target.month, target.day, tzinfo=timezone.utc)


def _days_ago(days: int) -> datetime:
    return _utc_now() - timedelta(days=days)


def _month_start_utc() -> datetime:
    now = _utc_now()
    return datetime(now.year, now.month, 1, tzinfo=timezone.utc)


@dataclass(frozen=True)
class LivingAlbumKpis:
    living_album_ratio: float
    avg_album_lifetime_days: float
    avg_page_append_count: float
    avg_edition_count: float


@dataclass(frozen=True)
class CollaborationKpis:
    avg_participants_per_album: float
    avg_added_photos: float
    avg_added_memories: float
    participation_rate: float


@dataclass(frozen=True)
class ViralKpis:
    share_count: int
    share_to_new_users: int
    share_to_new_albums: int
    viral_conversion_rate: float


@dataclass(frozen=True)
class RetentionKpis:
    return_visit_7d_rate: float
    return_visit_30d_rate: float
    reopened_album_ratio: float


@dataclass(frozen=True)
class ContentKpis:
    total_photos: int
    total_memories: int
    total_pages: int
    total_editions: int


_TABLES_WITH_SOFT_DELETE = frozenset({"profiles", "albums", "album_photos", "photo_memories"})


def count_rows(client: Client, table: str, *, since: datetime | None = None, column: str = "created_at") -> int:
    query = client.table(table).select("id", count="exact")
    if table in _TABLES_WITH_SOFT_DELETE:
        query = query.is_("deleted_at", "null")
    if since is not None:
        query = query.gte(column, since.isoformat())
    result = query.limit(1).execute()
    return int(result.count or 0)


def count_analytics(client: Client, event_name: str, *, since: datetime | None = None) -> int:
    query = client.table("analytics_events").select("id", count="exact").eq("event_name", event_name)
    if since is not None:
        query = query.gte("created_at", since.isoformat())
    result = query.limit(1).execute()
    return int(result.count or 0)


def fetch_event_counts(client: Client, *, since: datetime | None = None) -> Counter[str]:
    query = client.table("analytics_events").select("event_name")
    if since is not None:
        query = query.gte("created_at", since.isoformat())
    rows = query.limit(5000).execute().data or []
    return Counter(str(row.get("event_name") or "") for row in rows)


def load_active_albums(client: Client, *, limit: int = 2000) -> list[dict[str, Any]]:
    result = (
        client.table("albums")
        .select(
            "id,title,created_at,updated_at,album_version,living_append_pages,"
            "living_latest_edition_previous,last_collaboration_applied_at,owner_id,created_by"
        )
        .is_("deleted_at", "null")
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )
    return list(result.data or [])


def album_is_living(album: dict[str, Any], *, contributor_count: int = 0) -> bool:
    pages = album.get("living_append_pages") or []
    if isinstance(pages, list) and len(pages) > 0:
        return True
    version = int(album.get("album_version") or 0)
    if version > 0:
        return True
    if contributor_count > 1:
        return True
    created = _parse_ts(album.get("created_at"))
    updated = _parse_ts(album.get("updated_at")) or _parse_ts(album.get("last_collaboration_applied_at"))
    if created and updated and (updated - created) > timedelta(days=1):
        return True
    return False


def album_lifetime_days(album: dict[str, Any]) -> float:
    created = _parse_ts(album.get("created_at"))
    if not created:
        return 0.0
    updated = _parse_ts(album.get("updated_at")) or _parse_ts(album.get("last_collaboration_applied_at")) or _utc_now()
    return max(0.0, (updated - created).total_seconds() / 86400.0)


def page_append_count(album: dict[str, Any]) -> int:
    pages = album.get("living_append_pages") or []
    return len(pages) if isinstance(pages, list) else 0


def edition_count(album: dict[str, Any]) -> int:
    version = int(album.get("album_version") or 0)
    if album.get("living_latest_edition_previous") is not None:
        return max(1, version)
    return version


def compute_living_album_kpis(albums: list[dict[str, Any]], contributor_counts: dict[str, int]) -> LivingAlbumKpis:
    if not albums:
        return LivingAlbumKpis(0.0, 0.0, 0.0, 0.0)
    living = [
        album
        for album in albums
        if album_is_living(album, contributor_count=contributor_counts.get(str(album.get("id")), 0))
    ]
    ratio = len(living) / len(albums) if albums else 0.0
    lifetimes = [album_lifetime_days(album) for album in living] or [album_lifetime_days(album) for album in albums]
    pages = [page_append_count(album) for album in albums]
    editions = [edition_count(album) for album in albums]
    return LivingAlbumKpis(
        living_album_ratio=round(ratio * 100.0, 1),
        avg_album_lifetime_days=round(sum(lifetimes) / len(lifetimes), 1) if lifetimes else 0.0,
        avg_page_append_count=round(sum(pages) / len(pages), 2) if pages else 0.0,
        avg_edition_count=round(sum(editions) / len(editions), 2) if editions else 0.0,
    )


def count_by_album(client: Client, table: str, album_ids: list[str]) -> dict[str, int]:
    if not album_ids:
        return {}
    counts: Counter[str] = Counter()
    chunk = 200
    for index in range(0, len(album_ids), chunk):
        subset = album_ids[index : index + chunk]
        rows = (
            client.table(table)
            .select("album_id")
            .in_("album_id", subset)
            .is_("deleted_at", "null")
            .limit(5000)
            .execute()
            .data
            or []
        )
        for row in rows:
            album_id = str(row.get("album_id") or "")
            if album_id:
                counts[album_id] += 1
    return dict(counts)


def contributor_counts(client: Client, album_ids: list[str]) -> dict[str, int]:
    if not album_ids:
        return {}
    counts: Counter[str] = Counter()
    chunk = 200
    for index in range(0, len(album_ids), chunk):
        subset = album_ids[index : index + chunk]
        rows = (
            client.table("album_contributors")
            .select("album_id")
            .in_("album_id", subset)
            .eq("status", "active")
            .limit(5000)
            .execute()
            .data
            or []
        )
        for row in rows:
            album_id = str(row.get("album_id") or "")
            if album_id:
                counts[album_id] += 1
    return dict(counts)


def compute_collaboration_kpis(
    albums: list[dict[str, Any]],
    *,
    contributor_map: dict[str, int],
    contributor_photos: dict[str, int],
    contributor_memories: dict[str, int],
) -> CollaborationKpis:
    if not albums:
        return CollaborationKpis(0.0, 0.0, 0.0, 0.0)
    participants = [contributor_map.get(str(album.get("id")), 0) for album in albums]
    photos = [contributor_photos.get(str(album.get("id")), 0) for album in albums]
    memories = [contributor_memories.get(str(album.get("id")), 0) for album in albums]
    participated = sum(1 for count in participants if count > 1)
    return CollaborationKpis(
        avg_participants_per_album=round(sum(participants) / len(participants), 2),
        avg_added_photos=round(sum(photos) / len(photos), 2),
        avg_added_memories=round(sum(memories) / len(memories), 2),
        participation_rate=round((participated / len(albums)) * 100.0, 1),
    )


def compute_viral_kpis(client: Client, event_counts: Counter[str]) -> ViralKpis:
    shares = event_counts.get("share_link_created", 0)
    if shares == 0:
        shares = int(
            client.table("share_links").select("id", count="exact").limit(1).execute().count or 0
        )
    new_users = event_counts.get("guest_album_claimed", 0)
    new_albums = event_counts.get("second_album_started", 0) + event_counts.get("guest_album_generated", 0)
    views = event_counts.get("public_album_viewed", 0)
    conversion = (new_users / views * 100.0) if views else 0.0
    return ViralKpis(
        share_count=shares,
        share_to_new_users=new_users,
        share_to_new_albums=new_albums,
        viral_conversion_rate=round(conversion, 1),
    )


def compute_retention_kpis(client: Client, profiles: list[dict[str, Any]]) -> RetentionKpis:
    if not profiles:
        return RetentionKpis(0.0, 0.0, 0.0)
    events = (
        client.table("analytics_events")
        .select("created_at,metadata")
        .order("created_at", desc=True)
        .limit(3000)
        .execute()
        .data
        or []
    )
    event_days_by_profile: dict[str, set[date]] = defaultdict(set)
    for row in events:
        metadata = row.get("metadata") or {}
        profile_id = str(metadata.get("owner_id") or metadata.get("profile_id") or "").strip()
        if not profile_id:
            continue
        created = _parse_ts(row.get("created_at"))
        if created:
            event_days_by_profile[profile_id].add(created.date())

    seven_hits = 0
    thirty_hits = 0
    eligible_7 = 0
    eligible_30 = 0
    for profile in profiles:
        profile_id = str(profile.get("id") or "")
        created = _parse_ts(profile.get("created_at"))
        if not created or not profile_id:
            continue
        age_days = (_utc_now() - created).days
        days = event_days_by_profile.get(profile_id, set())
        if age_days >= 7:
            eligible_7 += 1
            if any(day >= created.date() + timedelta(days=7) for day in days):
                seven_hits += 1
        if age_days >= 30:
            eligible_30 += 1
            if any(day >= created.date() + timedelta(days=30) for day in days):
                thirty_hits += 1

    albums = load_active_albums(client, limit=1000)
    reopened = 0
    for album in albums:
        created = _parse_ts(album.get("created_at"))
        updated = _parse_ts(album.get("updated_at")) or _parse_ts(album.get("last_collaboration_applied_at"))
        if created and updated and (updated - created) > timedelta(days=3):
            reopened += 1
    reopened_ratio = (reopened / len(albums) * 100.0) if albums else 0.0

    return RetentionKpis(
        return_visit_7d_rate=round((seven_hits / eligible_7 * 100.0) if eligible_7 else 0.0, 1),
        return_visit_30d_rate=round((thirty_hits / eligible_30 * 100.0) if eligible_30 else 0.0, 1),
        reopened_album_ratio=round(reopened_ratio, 1),
    )


def compute_content_kpis(client: Client, albums: list[dict[str, Any]]) -> ContentKpis:
    total_photos = int(client.table("album_photos").select("id", count="exact").is_("deleted_at", "null").limit(1).execute().count or 0)
    total_memories = int(
        client.table("photo_memories").select("id", count="exact").is_("deleted_at", "null").limit(1).execute().count or 0
    )
    total_pages = sum(page_append_count(album) for album in albums)
    total_editions = sum(edition_count(album) for album in albums)
    return ContentKpis(
        total_photos=total_photos,
        total_memories=total_memories,
        total_pages=total_pages,
        total_editions=total_editions,
    )


def daily_series(event_counts_by_day: dict[str, Counter[str]], event_name: str, days: int = 14) -> list[dict[str, Any]]:
    series: list[dict[str, Any]] = []
    today = _utc_now().date()
    for offset in range(days - 1, -1, -1):
        day = today - timedelta(days=offset)
        key = day.isoformat()
        series.append({"date": key, "value": event_counts_by_day.get(key, Counter()).get(event_name, 0)})
    return series


def build_event_counts_by_day(client: Client, *, days: int = 14) -> dict[str, Counter[str]]:
    since = _start_of_day_utc() - timedelta(days=days - 1)
    rows = (
        client.table("analytics_events")
        .select("event_name,created_at")
        .gte("created_at", since.isoformat())
        .order("created_at", desc=False)
        .limit(5000)
        .execute()
        .data
        or []
    )
    buckets: dict[str, Counter[str]] = defaultdict(Counter)
    for row in rows:
        created = _parse_ts(row.get("created_at"))
        if not created:
            continue
        key = created.date().isoformat()
        buckets[key][str(row.get("event_name") or "")] += 1
    return buckets


def count_pdf_generations(client: Client, albums: list[dict[str, Any]], *, since: datetime | None = None) -> int:
    analytics = count_analytics(client, "pdf_generated", since=since)
    if analytics:
        return analytics
    total = 0
    for album in albums:
        cache = album.get("pdf_cache") or {}
        if not isinstance(cache, dict):
            continue
        for entry in cache.values():
            if not isinstance(entry, dict):
                total += 1
                continue
            created = _parse_ts(entry.get("created_at"))
            if since is None or (created and created >= since):
                total += 1
    return total


__all__ = [
    "LivingAlbumKpis",
    "CollaborationKpis",
    "ViralKpis",
    "RetentionKpis",
    "ContentKpis",
    "_start_of_day_utc",
    "_utc_now",
    "_days_ago",
    "_month_start_utc",
    "count_rows",
    "count_analytics",
    "fetch_event_counts",
    "load_active_albums",
    "compute_living_album_kpis",
    "compute_collaboration_kpis",
    "compute_viral_kpis",
    "compute_retention_kpis",
    "compute_content_kpis",
    "contributor_counts",
    "count_by_album",
    "daily_series",
    "build_event_counts_by_day",
    "count_pdf_generations",
    "page_append_count",
    "edition_count",
    "album_is_living",
    "album_lifetime_days",
]
