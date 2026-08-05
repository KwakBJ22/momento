"""Admin console read models and queries."""

from __future__ import annotations

from collections import Counter, defaultdict
from typing import Any

from supabase import Client

from app.models.album_photo_status import ALBUM_PHOTO_READY
from app.services.admin_kpi_service import (
    _days_ago,
    _month_start_utc,
    _parse_ts,
    _start_of_day_utc,
    _utc_now,
    album_is_living,
    album_lifetime_days,
    build_event_counts_by_day,
    compute_collaboration_kpis,
    compute_content_kpis,
    compute_living_album_kpis,
    compute_retention_kpis,
    compute_viral_kpis,
    contributor_counts,
    count_analytics,
    count_by_album,
    count_missing_display_photos,
    count_rows,
    daily_series,
    edition_count,
    fetch_admin_album_kpi_summary,
    fetch_event_counts,
    load_active_albums,
    page_append_count,
)
from app.services.collaboration_service import list_photo_memories
from app.services.membership import get_user_email
from app.services.supabase import delete_album_record, get_album_photo_records, get_album_record, get_public_url
from app.config import Settings


def _contributor_added_counts(client: Client, album_ids: list[str]) -> tuple[dict[str, int], dict[str, int]]:
    photo_counts: dict[str, int] = defaultdict(int)
    memory_counts: dict[str, int] = defaultdict(int)
    if not album_ids:
        return {}, {}
    chunk = 200
    for index in range(0, len(album_ids), chunk):
        subset = album_ids[index : index + chunk]
        photos = (
            client.table("album_photos")
            .select("album_id,uploaded_by_contributor_id")
            .in_("album_id", subset)
            .is_("deleted_at", "null")
            .limit(5000)
            .execute()
            .data
            or []
        )
        for row in photos:
            if row.get("uploaded_by_contributor_id"):
                photo_counts[str(row.get("album_id"))] += 1
        memories = (
            client.table("photo_memories")
            .select("album_id,contributor_id")
            .in_("album_id", subset)
            .is_("deleted_at", "null")
            .limit(5000)
            .execute()
            .data
            or []
        )
        for row in memories:
            if row.get("contributor_id"):
                memory_counts[str(row.get("album_id"))] += 1
    return dict(photo_counts), dict(memory_counts)


def build_ops_dashboard(client: Client) -> dict[str, Any]:
    today = _start_of_day_utc()
    all_event_today = fetch_event_counts(client, since=today)
    buckets = build_event_counts_by_day(client, days=14)

    today_new_users = count_rows(client, "profiles", since=today)
    today_new_albums = count_rows(client, "albums", since=today)
    today_memories = count_rows(client, "photo_memories", since=today)
    today_shares = count_analytics(client, "share_link_created", since=today) or count_rows(client, "share_links", since=today)
    today_pages = all_event_today.get("living_page_appended", 0)
    today_editions = all_event_today.get("edition_created", 0) or all_event_today.get("album_rebuild_completed", 0)
    today_pdf = count_analytics(client, "pdf_generated", since=today)

    total_users = count_rows(client, "profiles")
    total_albums = count_rows(client, "albums")
    total_photos = count_rows(client, "album_photos")
    total_memories = count_rows(client, "photo_memories")
    total_shares = count_analytics(client, "share_link_created") or count_rows(client, "share_links")
    total_pdf = count_analytics(client, "pdf_generated")
    missing_display = count_missing_display_photos(client)

    return {
        "today": {
            "new_users": today_new_users,
            "new_albums": today_new_albums,
            "new_pages": today_pages,
            "new_editions": today_editions,
            "share_count": today_shares,
            "pdf_generated": today_pdf,
            "new_memories": today_memories,
        },
        "totals": {
            "users": total_users,
            "albums": total_albums,
            "photos": total_photos,
            "memories": total_memories,
            "shares": total_shares,
            "pdf_generated": total_pdf,
            "missing_display_photos": missing_display,
        },
        "trends": {
            "new_albums": daily_series(buckets, "album_created", 14),
            "share_views": daily_series(buckets, "public_album_viewed", 14),
            "new_memories": daily_series(buckets, "guest_memory_completed", 14),
        },
    }


def _growth_from_summary(summary: dict[str, Any], client: Client) -> dict[str, Any]:
    total_albums = int(summary.get("total_albums") or 0)
    living_count = int(summary.get("living_album_count") or 0)
    living_ratio = round((living_count / total_albums * 100.0) if total_albums else 0.0, 1)
    all_events = fetch_event_counts(client)
    profiles = client.table("profiles").select("id,created_at,updated_at").limit(2000).execute().data or []
    viral = compute_viral_kpis(client, all_events)
    retention = compute_retention_kpis(
        client,
        profiles,
        reopened_album_ratio=float(summary.get("reopened_album_ratio") or 0),
    )
    total_photos = int(client.table("album_photos").select("id", count="exact").is_("deleted_at", "null").limit(1).execute().count or 0)
    total_memories = int(
        client.table("photo_memories").select("id", count="exact").is_("deleted_at", "null").limit(1).execute().count or 0
    )
    return {
        "living_album": {
            "living_album_ratio": living_ratio,
            "avg_album_lifetime_days": round(float(summary.get("avg_lifetime_days") or 0), 1),
            "avg_page_append_count": round(float(summary.get("avg_page_count") or 0), 2),
            "avg_edition_count": round(float(summary.get("avg_edition_count") or 0), 2),
        },
        "collaboration": {
            "avg_participants_per_album": round(float(summary.get("avg_participants") or 0), 2),
            "avg_added_photos": round(float(summary.get("avg_added_photos") or 0), 2),
            "avg_added_memories": round(float(summary.get("avg_added_memories") or 0), 2),
            "participation_rate": round(float(summary.get("participation_rate") or 0), 1),
        },
        "viral": {
            "share_count": viral.share_count,
            "share_to_new_users": viral.share_to_new_users,
            "share_to_new_albums": viral.share_to_new_albums,
            "viral_conversion_rate": viral.viral_conversion_rate,
        },
        "retention": {
            "return_visit_7d_rate": retention.return_visit_7d_rate,
            "return_visit_30d_rate": retention.return_visit_30d_rate,
            "reopened_album_ratio": retention.reopened_album_ratio,
        },
        "content": {
            "total_photos": total_photos,
            "total_memories": total_memories,
            "total_pages": int(summary.get("total_pages") or 0),
            "total_editions": int(summary.get("total_editions") or 0),
        },
    }


def build_growth_dashboard(client: Client) -> dict[str, Any]:
    summary = fetch_admin_album_kpi_summary(client)
    if summary:
        return _growth_from_summary(summary, client)

    albums = load_active_albums(client)
    album_ids = [str(row["id"]) for row in albums]
    contributors = contributor_counts(client, album_ids)
    added_photos, added_memories = _contributor_added_counts(client, album_ids)
    all_events = fetch_event_counts(client)
    profiles = client.table("profiles").select("id,created_at,updated_at").limit(2000).execute().data or []

    living = compute_living_album_kpis(albums, contributors)
    collaboration = compute_collaboration_kpis(
        albums,
        contributor_map=contributors,
        contributor_photos=added_photos,
        contributor_memories=added_memories,
    )
    viral = compute_viral_kpis(client, all_events)
    retention = compute_retention_kpis(client, profiles)
    content = compute_content_kpis(client, albums)

    return {
        "living_album": {
            "living_album_ratio": living.living_album_ratio,
            "avg_album_lifetime_days": living.avg_album_lifetime_days,
            "avg_page_append_count": living.avg_page_append_count,
            "avg_edition_count": living.avg_edition_count,
        },
        "collaboration": {
            "avg_participants_per_album": collaboration.avg_participants_per_album,
            "avg_added_photos": collaboration.avg_added_photos,
            "avg_added_memories": collaboration.avg_added_memories,
            "participation_rate": collaboration.participation_rate,
        },
        "viral": {
            "share_count": viral.share_count,
            "share_to_new_users": viral.share_to_new_users,
            "share_to_new_albums": viral.share_to_new_albums,
            "viral_conversion_rate": viral.viral_conversion_rate,
        },
        "retention": {
            "return_visit_7d_rate": retention.return_visit_7d_rate,
            "return_visit_30d_rate": retention.return_visit_30d_rate,
            "reopened_album_ratio": retention.reopened_album_ratio,
        },
        "content": {
            "total_photos": content.total_photos,
            "total_memories": content.total_memories,
            "total_pages": content.total_pages,
            "total_editions": content.total_editions,
        },
    }


def build_investor_dashboard(client: Client) -> dict[str, Any]:
    growth = build_growth_dashboard(client)
    month_start = _month_start_utc()
    month_memories = count_rows(client, "photo_memories", since=month_start)
    month_albums = count_rows(client, "albums", since=month_start)
    return {
        "headline_metrics": [
            {"label": "살아있는 앨범", "value": f"{growth['living_album']['living_album_ratio']}%"},
            {"label": "평균 참여자", "value": f"{growth['collaboration']['avg_participants_per_album']}명"},
            {"label": "공유→가입", "value": f"{growth['viral']['viral_conversion_rate']}%"},
            {"label": "평균 앨범 수명", "value": f"{int(growth['living_album']['avg_album_lifetime_days'])}일"},
            {"label": "이번 달 이어진 추억", "value": f"{month_memories:,}건"},
            {"label": "새 앨범", "value": f"{month_albums:,}개"},
        ],
        "growth": growth,
    }


def build_viral_funnel(client: Client) -> dict[str, Any]:
    albums_created = count_rows(client, "albums")
    shares = count_analytics(client, "share_link_created") or count_rows(client, "share_links")
    clicks = count_analytics(client, "public_album_viewed")
    participate = (
        count_analytics(client, "guest_memory_completed")
        + count_analytics(client, "invitation_accepted")
        + int(client.table("album_contributors").select("id", count="exact").eq("status", "active").limit(1).execute().count or 0)
    )
    new_users = count_analytics(client, "guest_album_claimed") or count_rows(client, "profiles")
    new_albums = count_analytics(client, "album_created") or count_analytics(client, "guest_album_generated")

    stages = [
        {"key": "album_created", "label": "앨범 생성", "count": albums_created},
        {"key": "share", "label": "공유", "count": shares},
        {"key": "share_click", "label": "공유 링크 클릭", "count": clicks},
        {"key": "participate", "label": "참여", "count": participate},
        {"key": "new_user", "label": "새 사용자", "count": new_users},
        {"key": "new_album", "label": "새 앨범 생성", "count": new_albums},
    ]
    for index, stage in enumerate(stages):
        previous = stages[index - 1]["count"] if index > 0 else None
        current = stage["count"]
        stage["conversion_from_previous"] = round((current / previous * 100.0), 1) if previous else None
    return {"stages": stages}


def _profile_display_name(client: Client, profile_id: str | None) -> str | None:
    if not profile_id:
        return None
    row = client.table("profiles").select("display_name").eq("id", profile_id).limit(1).execute().data
    if not row:
        return None
    return str(row[0].get("display_name") or "")


def _safe_email(client: Client, profile_id: str | None) -> str | None:
    if not profile_id:
        return None
    try:
        return get_user_email(client, profile_id)
    except Exception:
        return None


def _batch_profile_names(client: Client, profile_ids: list[str]) -> dict[str, str]:
    unique = list(dict.fromkeys(profile_id for profile_id in profile_ids if profile_id))
    if not unique:
        return {}
    rows = client.table("profiles").select("id,display_name").in_("id", unique).execute().data or []
    return {str(row["id"]): str(row.get("display_name") or "") for row in rows}


def _batch_owner_emails(client: Client, profile_ids: list[str]) -> dict[str, str | None]:
    unique = list(dict.fromkeys(profile_id for profile_id in profile_ids if profile_id))
    if not unique:
        return {}
    found: dict[str, str | None] = {}
    for profile_id in unique:
        found[profile_id] = _safe_email(client, profile_id)
    return found


def _batch_album_cover_photos(client: Client, album_ids: list[str]) -> dict[str, list[dict[str, Any]]]:
    photos_by_album: dict[str, list[dict[str, Any]]] = defaultdict(list)
    if not album_ids:
        return {}
    chunk = 200
    for index in range(0, len(album_ids), chunk):
        subset = album_ids[index : index + chunk]
        rows = (
            client.table("album_photos")
            .select("id,album_id,storage_path,sort_order,taken_at")
            .in_("album_id", subset)
            .is_("deleted_at", "null")
            .eq("status", ALBUM_PHOTO_READY)
            .order("sort_order")
            .limit(5000)
            .execute()
            .data
            or []
        )
        for row in rows:
            photos_by_album[str(row["album_id"])].append(row)
    for album_id, photos in photos_by_album.items():
        photos.sort(
            key=lambda row: (
                row.get("taken_at") is None,
                str(row.get("taken_at") or ""),
                int(row.get("sort_order") or 0),
            )
        )
        photos_by_album[album_id] = photos
    return dict(photos_by_album)


def _cover_image_url_for_album(
    client: Client,
    settings: Settings,
    album_row: dict[str, Any],
    photos: list[dict[str, Any]],
) -> str | None:
    cover_id = str(album_row.get("cover_photo_id") or "")
    cover = next((photo for photo in photos if str(photo.get("id")) == cover_id), None) if cover_id else None
    if not cover and photos:
        cover = photos[0]
    if cover and cover.get("storage_path"):
        return get_public_url(client, str(cover["storage_path"]), settings)
    return None


def search_albums(client: Client, settings: Settings, *, query: str = "", limit: int = 40, offset: int = 0) -> dict[str, Any]:
    q = query.strip()
    request = (
        client.table("albums")
        .select("id,title,created_at,updated_at,cover_photo_id,created_by,owner_id,living_append_pages,album_version")
        .is_("deleted_at", "null")
        .order("created_at", desc=True)
    )
    if q:
        request = request.ilike("title", f"%{q}%")
    rows = request.range(offset, offset + limit - 1).execute().data or []
    album_ids = [str(row["id"]) for row in rows]
    photo_counts = count_by_album(client, "album_photos", album_ids)
    memory_counts = count_by_album(client, "photo_memories", album_ids)
    share_counts: Counter[str] = Counter()
    if album_ids:
        share_rows = client.table("share_links").select("album_id").in_("album_id", album_ids).limit(5000).execute().data or []
        for item in share_rows:
            share_counts[str(item.get("album_id"))] += 1
    contributors = contributor_counts(client, album_ids)
    owner_ids = [str(row.get("created_by") or row.get("owner_id") or "") for row in rows]
    profile_names = _batch_profile_names(client, owner_ids)
    owner_emails = _batch_owner_emails(client, owner_ids)
    photos_by_album = _batch_album_cover_photos(client, album_ids)

    items: list[dict[str, Any]] = []
    for row in rows:
        album_id = str(row["id"])
        owner_id = str(row.get("created_by") or row.get("owner_id") or "")
        photos = photos_by_album.get(album_id, [])
        items.append(
            {
                "album_id": album_id,
                "title": row.get("title") or "앨범",
                "owner_id": owner_id or None,
                "owner_name": profile_names.get(owner_id) or None,
                "owner_email": owner_emails.get(owner_id),
                "cover_image_url": _cover_image_url_for_album(client, settings, row, photos),
                "created_at": row.get("created_at"),
                "updated_at": row.get("updated_at"),
                "photo_count": photo_counts.get(album_id, 0),
                "memory_count": memory_counts.get(album_id, 0),
                "participant_count": contributors.get(album_id, 0),
                "share_count": share_counts.get(album_id, 0),
                "page_count": page_append_count(row),
                "edition_count": edition_count(row),
                "is_living": album_is_living(row, contributor_count=contributors.get(album_id, 0)),
            }
        )

    if q and "@" in q:
        email_q = q.lower()
        items = [item for item in items if (item.get("owner_email") or "").lower().find(email_q) >= 0]
    elif q:
        lowered = q.lower()
        items = [
            item
            for item in items
            if lowered in (item.get("title") or "").lower()
            or lowered in (item.get("owner_name") or "").lower()
            or lowered in (item.get("owner_email") or "")
        ]

    return {"albums": items, "query": q, "limit": limit, "offset": offset}


def get_album_admin_detail(client: Client, settings: Settings, album_id: str) -> dict[str, Any]:
    record = get_album_record(client, album_id)
    if not record:
        return {}
    photos = get_album_photo_records(client, album_id)
    memories = list_photo_memories(client, album_id)
    contributors = (
        client.table("album_contributors")
        .select("id,display_name,user_id,guest_id,joined_at,last_active_at,status")
        .eq("album_id", album_id)
        .order("joined_at")
        .execute()
        .data
        or []
    )
    shares = (
        client.table("share_links")
        .select("id,status,view_count,created_at")
        .eq("album_id", album_id)
        .order("created_at", desc=True)
        .execute()
        .data
        or []
    )
    owner_id = str(record.get("created_by") or record.get("owner_id") or "")
    cover_url = None
    if photos:
        cover = next((photo for photo in photos if str(photo.get("id")) == str(record.get("cover_photo_id"))), photos[0])
        if cover.get("storage_path"):
            cover_url = get_public_url(client, str(cover["storage_path"]), settings)
    return {
        "album_id": album_id,
        "title": record.get("title"),
        "created_at": record.get("created_at"),
        "updated_at": record.get("updated_at"),
        "owner_id": owner_id or None,
        "owner_name": _profile_display_name(client, owner_id),
        "owner_email": _safe_email(client, owner_id),
        "cover_image_url": cover_url,
        "photo_count": len(photos),
        "memory_count": len(memories),
        "participant_count": len([row for row in contributors if row.get("status") == "active"]),
        "share_count": len(shares),
        "page_count": page_append_count(record),
        "edition_count": edition_count(record),
        "is_living": album_is_living(record, contributor_count=len(contributors)),
        "lifetime_days": round(album_lifetime_days(record), 1),
        "contributors": contributors,
        "shares": shares,
        "timeline": build_album_timeline(client, album_id, record=record),
        "view_url": f"/album/{album_id}",
    }


def build_album_timeline(client: Client, album_id: str, *, record: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    album = record or get_album_record(client, album_id)
    if not album:
        return []
    events: list[dict[str, Any]] = []
    events.append({"at": album.get("created_at"), "kind": "album_created", "label": "앨범 생성"})

    contributors = (
        client.table("album_contributors")
        .select("display_name,joined_at,status")
        .eq("album_id", album_id)
        .neq("role", "owner")
        .order("joined_at")
        .execute()
        .data
        or []
    )
    for row in contributors:
        if row.get("status") != "active":
            continue
        events.append(
            {
                "at": row.get("joined_at"),
                "kind": "participant_joined",
                "label": f"친구 참여 · {row.get('display_name') or '게스트'}",
            }
        )

    for page_index, page in enumerate(album.get("living_append_pages") or [], start=1):
        events.append(
            {
                "at": album.get("updated_at") or album.get("created_at"),
                "kind": "living_page",
                "label": f"새 페이지 · {page_index}",
                "metadata": page if isinstance(page, dict) else {},
            }
        )

    if album.get("living_latest_edition_previous") is not None:
        events.append(
            {
                "at": album.get("updated_at"),
                "kind": "edition",
                "label": "새 에디션",
                "metadata": {"previous_version": album.get("living_latest_edition_previous")},
            }
        )

    analytics = (
        client.table("analytics_events")
        .select("event_name,created_at,metadata")
        .eq("album_id", album_id)
        .order("created_at")
        .limit(200)
        .execute()
        .data
        or []
    )
    label_map = {
        "share_link_created": "공유",
        "public_album_viewed": "공유 링크 조회",
        "album_rebuild_completed": "앨범 재생성",
        "living_page_appended": "새 페이지",
        "edition_created": "새 에디션",
        "cover_photo_changed": "대표사진 변경",
        "pdf_generated": "PDF 생성",
        "guest_memory_completed": "추억 추가",
        "photo_added": "사진 추가",
        "memory_added": "기억 추가",
    }
    for row in analytics:
        name = str(row.get("event_name") or "")
        events.append(
            {
                "at": row.get("created_at"),
                "kind": name,
                "label": label_map.get(name, name),
                "metadata": row.get("metadata") or {},
            }
        )

    events.sort(key=lambda item: str(item.get("at") or ""))
    return events


def search_users(client: Client, *, query: str = "", limit: int = 40, offset: int = 0) -> dict[str, Any]:
    q = query.strip().lower()
    profiles = (
        client.table("profiles")
        .select("id,display_name,created_at,updated_at")
        .order("created_at", desc=True)
        .range(offset, offset + limit - 1)
        .execute()
        .data
        or []
    )
    items: list[dict[str, Any]] = []
    for profile in profiles:
        profile_id = str(profile.get("id"))
        email = _safe_email(client, profile_id)
        if q and q not in (email or "") and q not in (profile.get("display_name") or "").lower():
            continue
        owned_albums = int(
            client.table("albums")
            .select("id", count="exact")
            .is_("deleted_at", "null")
            .or_(f"created_by.eq.{profile_id},owner_id.eq.{profile_id}")
            .limit(1)
            .execute()
            .count
            or 0
        )
        participations = int(
            client.table("album_contributors")
            .select("id", count="exact")
            .eq("user_id", profile_id)
            .eq("status", "active")
            .limit(1)
            .execute()
            .count
            or 0
        )
        share_events = int(
            client.table("share_links")
            .select("id", count="exact")
            .eq("created_by", profile_id)
            .limit(1)
            .execute()
            .count
            or 0
        )
        items.append(
            {
                "user_id": profile_id,
                "email": email,
                "display_name": profile.get("display_name"),
                "created_at": profile.get("created_at"),
                "last_seen_at": profile.get("updated_at"),
                "album_count": owned_albums,
                "participation_count": participations,
                "share_count": share_events,
            }
        )
    return {"users": items, "query": query, "limit": limit, "offset": offset}


def list_user_albums(client: Client, settings: Settings, user_id: str) -> dict[str, Any]:
    rows = (
        client.table("albums")
        .select("id,title,created_at,updated_at,cover_photo_id,created_by,owner_id,living_append_pages,album_version")
        .is_("deleted_at", "null")
        .or_(f"created_by.eq.{user_id},owner_id.eq.{user_id}")
        .order("created_at", desc=True)
        .execute()
        .data
        or []
    )
    album_ids = [str(row["id"]) for row in rows]
    photo_counts = count_by_album(client, "album_photos", album_ids)
    memory_counts = count_by_album(client, "photo_memories", album_ids)
    contributors = contributor_counts(client, album_ids)
    share_counts: Counter[str] = Counter()
    if album_ids:
        share_rows = client.table("share_links").select("album_id").in_("album_id", album_ids).limit(5000).execute().data or []
        for item in share_rows:
            share_counts[str(item.get("album_id"))] += 1
    items: list[dict[str, Any]] = []
    for row in rows:
        album_id = str(row["id"])
        photos = get_album_photo_records(client, album_id)
        cover_url = None
        if photos and photos[0].get("storage_path"):
            cover_url = get_public_url(client, str(photos[0]["storage_path"]), settings)
        items.append(
            {
                "album_id": album_id,
                "title": row.get("title") or "앨범",
                "owner_id": user_id,
                "cover_image_url": cover_url,
                "created_at": row.get("created_at"),
                "updated_at": row.get("updated_at"),
                "photo_count": photo_counts.get(album_id, 0),
                "memory_count": memory_counts.get(album_id, 0),
                "participant_count": contributors.get(album_id, 0),
                "share_count": share_counts.get(album_id, 0),
                "page_count": page_append_count(row),
                "edition_count": edition_count(row),
                "is_living": album_is_living(row, contributor_count=contributors.get(album_id, 0)),
            }
        )
    return {"user_id": user_id, "albums": items}


def list_recent_events(client: Client, *, limit: int = 80) -> dict[str, Any]:
    rows = (
        client.table("analytics_events")
        .select("id,event_name,album_id,share_link_id,metadata,created_at")
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
        .data
        or []
    )
    label_map = {
        "album_created": "앨범 생성",
        "photo_added": "사진 추가",
        "memory_added": "기억 추가",
        "living_page_appended": "새 페이지",
        "edition_created": "새 에디션",
        "cover_photo_changed": "대표사진 변경",
        "pdf_generated": "PDF",
        "share_link_created": "공유",
        "album_rebuild_failed": "재생성 실패",
        "upload_failed": "업로드 실패",
        "pdf_failed": "PDF 실패",
        "share_failed": "공유 실패",
    }
    events = [
        {
            "id": row.get("id"),
            "event_name": row.get("event_name"),
            "label": label_map.get(str(row.get("event_name")), str(row.get("event_name"))),
            "album_id": row.get("album_id"),
            "share_link_id": row.get("share_link_id"),
            "metadata": row.get("metadata") or {},
            "created_at": row.get("created_at"),
        }
        for row in rows
    ]
    return {"events": events}


def list_error_dashboard(client: Client) -> dict[str, Any]:
    error_names = ("share_failed", "pdf_failed", "upload_failed", "album_rebuild_failed")
    rows = (
        client.table("analytics_events")
        .select("event_name,created_at,metadata,album_id")
        .in_("event_name", list(error_names))
        .order("created_at", desc=True)
        .limit(200)
        .execute()
        .data
        or []
    )
    grouped: dict[str, dict[str, Any]] = {}
    for row in rows:
        name = str(row.get("event_name") or "")
        bucket = grouped.setdefault(name, {"event_name": name, "count": 0, "last_occurred_at": row.get("created_at")})
        bucket["count"] += 1
    return {
        "errors": sorted(grouped.values(), key=lambda item: str(item.get("last_occurred_at") or ""), reverse=True),
        "recent": rows[:30],
    }


def build_cost_dashboard(client: Client) -> dict[str, Any]:
    logs = client.table("ai_usage_logs").select("operation,provider,status,created_at").limit(5000).execute().data or []
    operations = Counter(str(row.get("operation") or "unknown") for row in logs)
    gpt_calls = sum(count for op, count in operations.items() if "gpt" in op.lower() or op in {"story", "narrative", "questions", "timeline"})
    vision_calls = sum(count for op, count in operations.items() if "vision" in op.lower())
    pdf_calls = count_analytics(client, "pdf_generated")
    storage_bytes = 0
    try:
        photos = client.table("album_photos").select("byte_size").is_("deleted_at", "null").limit(5000).execute().data or []
        storage_bytes = sum(int(row.get("byte_size") or 0) for row in photos)
    except Exception:
        storage_bytes = 0
    return {
        "gpt_calls": gpt_calls or operations.get("openai_chat", 0),
        "vision_calls": vision_calls,
        "pdf_generations": pdf_calls,
        "storage_bytes": storage_bytes,
        "api_calls": len(logs),
        "operations": dict(operations),
    }


def admin_delete_album(client: Client, album_id: str) -> None:
    delete_album_record(client, album_id)
