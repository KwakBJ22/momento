"""Collaborative album MVP: invites, contributors, memories, dirty rebuild."""

from __future__ import annotations

import hashlib
import html
import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import HTTPException
from supabase import Client

from app.models.album_photo_status import is_deleted_album_photo, is_ready_album_photo, ready_album_photo_query
from app.services.share_service import create_token, hash_token
from app.services.supabase import soft_delete_album_photo_with_references

logger = logging.getLogger(__name__)

RELATIONSHIP_OPTIONS = frozenset({"가족", "친구", "연인", "지인", "기타"})

# A single login attributes at most this many guest contributions — bounds the bootstrap
# payload and any surprising local state. Matches the frontend cap.
CONTRIBUTION_ATTRIBUTION_LIMIT = 50


def attribute_contributions(client: Client, user_id: str, guest_ids: list[str]) -> tuple[list[str], int]:
    """Attach a signed-in account to its prior guest (contributor) rows, best-effort.

    For each unguessable guest_id, fill album_contributors.user_id on rows that still have
    NONE — a row already claimed by another user_id is never touched (no stealing). When the
    user already has an active contributor row for that album, the (album_id, user_id) unique
    index would conflict, so that guest row is SKIPPED (and logged) — their old participation
    stays under the guest name rather than breaking. Returns (attributed_guest_ids,
    attributed_album_count) for the caller's analytics.
    """
    claimed: list[str] = []
    attributed_albums = 0
    skipped_conflicts = 0
    for guest_id in guest_ids[:CONTRIBUTION_ATTRIBUTION_LIMIT]:
        rows = (
            client.table("album_contributors")
            .select("id, album_id")
            .eq("guest_id", guest_id)
            .is_("user_id", "null")
            .eq("status", "active")
            .execute()
            .data
            or []
        )
        attributed_here = False
        for row in rows:
            album_id = str(row.get("album_id") or "")
            row_id = row.get("id")
            if not album_id or not row_id:
                continue
            existing = (
                client.table("album_contributors")
                .select("id")
                .eq("album_id", album_id)
                .eq("user_id", user_id)
                .eq("status", "active")
                .execute()
                .data
                or []
            )
            if existing:
                skipped_conflicts += 1
                logger.info("contribution_attribution_skipped_conflict album_id=%s", album_id[:6])
                continue
            client.table("album_contributors").update({"user_id": user_id}).eq("id", row_id).is_(
                "user_id", "null"
            ).execute()
            attributed_albums += 1
            attributed_here = True
        if attributed_here:
            claimed.append(str(guest_id))
    if skipped_conflicts:
        logger.info("contribution_attribution_conflicts_total count=%s", skipped_conflicts)
    return claimed, attributed_albums
MAX_COMMENT_LEN = 500
MAX_BATCH_UPLOAD = 30
# Small collaboration updates keep the existing album intact and are attached
# as one final Living Album page. Both thresholds must be exceeded before the
# default becomes a newly composed edition.
LIVING_APPEND_PHOTO_THRESHOLD = 5
LIVING_APPEND_MEMORY_THRESHOLD = 5


def contribution_baseline_at(album: dict[str, Any]) -> str:
    return str(album.get("last_collaboration_applied_at") or album.get("created_at") or "")


def count_new_contributions(
    photos: list[dict[str, Any]],
    memories: list[dict[str, Any]],
    *,
    owner_contributor_ids: set[str],
    applied_photo_ids: set[str],
    applied_memory_ids: set[str],
    baseline: str,
) -> tuple[int, int]:
    """Count contributor photos/memories not yet applied to the Living Album."""
    new_photos = 0
    for photo in photos:
        contributor_id = str(photo.get("uploaded_by_contributor_id") or "").strip()
        if not contributor_id or contributor_id in owner_contributor_ids:
            continue
        if str(photo.get("id")) in applied_photo_ids:
            continue
        if str(photo.get("created_at") or "") <= baseline:
            continue
        new_photos += 1

    new_memories = 0
    for memory in memories:
        contributor_id = str(memory.get("contributor_id") or "").strip()
        if not contributor_id or contributor_id in owner_contributor_ids:
            continue
        if str(memory.get("id")) in applied_memory_ids:
            continue
        if str(memory.get("created_at") or "") <= baseline:
            continue
        new_memories += 1
    return new_photos, new_memories


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: datetime | None = None) -> str:
    return (value or _now()).isoformat()


def escape_plain_text(value: str) -> str:
    """Strip tags and escape — memories are plain text only."""
    cleaned = value.replace("\x00", "")
    # Remove obvious HTML tags without allowing markup storage.
    while "<" in cleaned and ">" in cleaned:
        start = cleaned.find("<")
        end = cleaned.find(">", start)
        if end < 0:
            break
        cleaned = cleaned[:start] + cleaned[end + 1 :]
    return html.escape(cleaned.strip(), quote=True)


def sanitize_memory_comment(raw: str) -> str:
    text = raw.replace("\x00", "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="기억을 입력해 주세요.")
    if len(text) > MAX_COMMENT_LEN:
        raise HTTPException(status_code=400, detail=f"기억은 {MAX_COMMENT_LEN}자까지 작성할 수 있어요.")
    # Reject HTML-ish payloads
    if "<script" in text.lower() or "</" in text.lower():
        raise HTTPException(status_code=400, detail="HTML은 사용할 수 없어요. 일반 텍스트로 적어 주세요.")
    return text


def mark_album_dirty(client: Client, album_id: str) -> None:
    client.table("albums").update({"dirty": True, "updated_at": _iso()}).eq("id", album_id).execute()


def get_active_invite_by_token(client: Client, token: str) -> dict[str, Any] | None:
    token_hash = hash_token(token)
    result = (
        client.table("album_invites")
        .select("*")
        .eq("token_hash", token_hash)
        .eq("is_active", True)
        .limit(1)
        .execute()
    )
    rows = result.data or []
    if not rows:
        return None
    invite = rows[0]
    expires_at = invite.get("expires_at")
    if expires_at:
        exp = datetime.fromisoformat(str(expires_at).replace("Z", "+00:00"))
        if exp <= _now():
            return None
    max_uses = invite.get("max_uses")
    if max_uses is not None and int(invite.get("use_count") or 0) >= int(max_uses):
        return None
    return invite


def get_album_for_invite(client: Client, token: str) -> tuple[dict[str, Any], dict[str, Any]]:
    invite = get_active_invite_by_token(client, token)
    if not invite:
        raise HTTPException(status_code=404, detail="초대 링크를 찾을 수 없거나 만료되었습니다.")
    album = client.table("albums").select("*").eq("id", invite["album_id"]).limit(1).execute()
    rows = album.data or []
    if not rows:
        raise HTTPException(status_code=404, detail="앨범을 찾을 수 없습니다.")
    record = rows[0]
    if not record.get("collaboration_enabled"):
        raise HTTPException(status_code=403, detail="함께 만들기가 비활성화된 앨범입니다.")
    status = record.get("collaboration_status") or "draft"
    if status in {"closed"}:
        raise HTTPException(status_code=403, detail="함께 만들기가 종료된 앨범입니다.")
    return record, invite


def start_collaboration(client: Client, album: dict[str, Any], created_by: str, *, expires_days: int = 30) -> tuple[dict[str, Any], str]:
    album_id = str(album["id"])
    # Deactivate previous invites
    client.table("album_invites").update(
        {"is_active": False, "deactivated_at": _iso()}
    ).eq("album_id", album_id).eq("is_active", True).execute()

    token = create_token()
    expires_at = _now() + timedelta(days=expires_days)
    invite = {
        "album_id": album_id,
        "token_hash": hash_token(token),
        "created_by": created_by,
        "expires_at": expires_at.isoformat(),
        "is_active": True,
        "use_count": 0,
    }
    inserted = client.table("album_invites").insert(invite).execute()
    invite_row = (inserted.data or [invite])[0]

    client.table("albums").update(
        {
            "collaboration_enabled": True,
            "collaboration_status": "collecting",
            "invite_token_hash": invite["token_hash"],
            "invite_expires_at": expires_at.isoformat(),
            "updated_at": _iso(),
        }
    ).eq("id", album_id).execute()

    # Ensure owner contributor row
    ensure_owner_contributor(client, album, created_by)
    return invite_row, token


def rotate_invite(client: Client, album: dict[str, Any], created_by: str) -> tuple[dict[str, Any], str]:
    return start_collaboration(client, album, created_by)


def deactivate_invites(client: Client, album_id: str) -> None:
    client.table("album_invites").update(
        {"is_active": False, "deactivated_at": _iso()}
    ).eq("album_id", album_id).eq("is_active", True).execute()
    client.table("albums").update(
        {
            "invite_token_hash": None,
            "updated_at": _iso(),
        }
    ).eq("id", album_id).execute()


def close_collaboration(client: Client, album_id: str) -> None:
    deactivate_invites(client, album_id)
    client.table("albums").update(
        {
            "collaboration_enabled": False,
            "collaboration_status": "closed",
            "updated_at": _iso(),
        }
    ).eq("id", album_id).execute()


def publish_album(client: Client, album_id: str) -> None:
    client.table("albums").update(
        {
            "collaboration_status": "published",
            "published_at": _iso(),
            "updated_at": _iso(),
        }
    ).eq("id", album_id).execute()


def ensure_owner_contributor(client: Client, album: dict[str, Any], owner_id: str) -> dict[str, Any]:
    album_id = str(album["id"])
    existing = (
        client.table("album_contributors")
        .select("*")
        .eq("album_id", album_id)
        .eq("user_id", owner_id)
        .eq("status", "active")
        .limit(1)
        .execute()
    )
    if existing.data:
        return existing.data[0]

    profile = client.table("profiles").select("display_name").eq("id", owner_id).limit(1).execute()
    name = "앨범 주인"
    if profile.data:
        name = (profile.data[0].get("display_name") or "").strip() or name

    row = {
        "album_id": album_id,
        "user_id": owner_id,
        "guest_id": None,
        "display_name": name[:40],
        "role": "owner",
        "status": "active",
    }
    inserted = client.table("album_contributors").insert(row).execute()
    return (inserted.data or [row])[0]


def count_active_contributors(client: Client, album_id: str) -> int:
    result = (
        client.table("album_contributors")
        .select("id", count="exact")
        .eq("album_id", album_id)
        .eq("status", "active")
        .execute()
    )
    return int(result.count or len(result.data or []))


def count_ready_photos(client: Client, album_id: str) -> int:
    result = (
        ready_album_photo_query(client.table("album_photos")
        .select("id", count="exact")
        .eq("album_id", album_id)
        )
        .is_("deleted_at", "null")
        .execute()
    )
    return int(result.count or len(result.data or []))


def join_as_contributor(
    client: Client,
    album: dict[str, Any],
    invite: dict[str, Any] | None,
    *,
    display_name: str,
    relationship: str | None,
    guest_id: str | None,
    user_id: str | None,
) -> dict[str, Any]:
    album_id = str(album["id"])
    name = display_name.strip()
    if not name or len(name) > 40:
        raise HTTPException(status_code=400, detail="이름은 1~40자로 입력해 주세요.")
    rel = (relationship or "").strip() or None
    if rel and rel not in RELATIONSHIP_OPTIONS:
        raise HTTPException(status_code=400, detail="관계를 선택해주세요.")

    if not guest_id and not user_id:
        guest_id = str(uuid.uuid4())

    # Restore existing active contributor
    if user_id:
        found = (
            client.table("album_contributors")
            .select("*")
            .eq("album_id", album_id)
            .eq("user_id", user_id)
            .eq("status", "active")
            .limit(1)
            .execute()
        )
        if found.data:
            row = found.data[0]
            client.table("album_contributors").update({"last_active_at": _iso()}).eq("id", row["id"]).execute()
            return {**row, "guest_id": row.get("guest_id")}

    if guest_id:
        found = (
            client.table("album_contributors")
            .select("*")
            .eq("album_id", album_id)
            .eq("guest_id", guest_id)
            .eq("status", "active")
            .limit(1)
            .execute()
        )
        if found.data:
            row = found.data[0]
            client.table("album_contributors").update(
                {"last_active_at": _iso(), "display_name": name, "relationship": rel}
            ).eq("id", row["id"]).execute()
            return {**row, "display_name": name, "relationship": rel}

    limit = int(album.get("contributor_limit") or 10)
    if count_active_contributors(client, album_id) >= limit:
        raise HTTPException(status_code=403, detail="참여 인원이 가득 찼어요.")

    row = {
        "album_id": album_id,
        "user_id": user_id,
        "guest_id": guest_id if not user_id else None,
        "display_name": name,
        "relationship": rel,
        "role": "contributor",
        "status": "active",
    }
    inserted = client.table("album_contributors").insert(row).execute()
    contributor = (inserted.data or [row])[0]

    if invite and invite.get("id"):
        client.table("album_invites").update(
            {"use_count": int(invite.get("use_count") or 0) + 1}
        ).eq("id", invite["id"]).execute()

    return contributor


def get_contributor(
    client: Client,
    album_id: str,
    *,
    contributor_id: str | None = None,
    guest_id: str | None = None,
    user_id: str | None = None,
) -> dict[str, Any] | None:
    query = (
        client.table("album_contributors")
        .select("*")
        .eq("album_id", album_id)
        .eq("status", "active")
    )
    if contributor_id:
        query = query.eq("id", contributor_id)
    elif user_id:
        query = query.eq("user_id", user_id)
    elif guest_id:
        query = query.eq("guest_id", guest_id)
    else:
        return None
    result = query.limit(1).execute()
    rows = result.data or []
    return rows[0] if rows else None


def require_contributor(
    client: Client,
    album_id: str,
    *,
    contributor_id: str | None,
    guest_id: str | None,
    user_id: str | None,
) -> dict[str, Any]:
    """Resolve contributor from session identity — never trust role from client alone."""
    contributor = get_contributor(
        client,
        album_id,
        contributor_id=contributor_id,
        guest_id=guest_id,
        user_id=user_id,
    )
    if not contributor:
        raise HTTPException(status_code=403, detail="참여 권한이 없어요. 초대 링크로 다시 들어와 주세요.")
    # Bind: if contributor_id provided, guest/user must match
    if contributor_id:
        if guest_id and str(contributor.get("guest_id") or "") != str(guest_id):
            if not user_id or str(contributor.get("user_id") or "") != str(user_id):
                raise HTTPException(status_code=403, detail="참여 세션이 일치하지 않아요.")
        if user_id and contributor.get("user_id") and str(contributor["user_id"]) != str(user_id):
            if not guest_id or str(contributor.get("guest_id") or "") != str(guest_id):
                raise HTTPException(status_code=403, detail="참여 세션이 일치하지 않아요.")
    album = client.table("albums").select("collaboration_status, collaboration_enabled").eq("id", album_id).limit(1).execute()
    status = (album.data or [{}])[0].get("collaboration_status")
    if status == "closed":
        raise HTTPException(status_code=403, detail="함께 만들기가 종료되어 더 이상 추가할 수 없어요.")
    return contributor


def list_contributors(client: Client, album_id: str) -> list[dict[str, Any]]:
    result = (
        client.table("album_contributors")
        .select("id, display_name, relationship, role, joined_at, last_active_at, status")
        .eq("album_id", album_id)
        .eq("status", "active")
        .order("joined_at")
        .execute()
    )
    return result.data or []


def remove_contributor(client: Client, album_id: str, contributor_id: str) -> None:
    client.table("album_contributors").update(
        {"status": "removed", "last_active_at": _iso()}
    ).eq("id", contributor_id).eq("album_id", album_id).execute()


def list_photo_memories(client: Client, album_id: str, *, photo_id: str | None = None) -> list[dict[str, Any]]:
    query = (
        client.table("photo_memories")
        .select("*")
        .eq("album_id", album_id)
        .is_("deleted_at", "null")
        .order("created_at")
    )
    if photo_id:
        query = query.eq("photo_id", photo_id)
    return query.execute().data or []


def create_photo_memory(
    client: Client,
    *,
    album_id: str,
    photo_id: str,
    contributor: dict[str, Any],
    comment: str,
) -> dict[str, Any]:
    text = sanitize_memory_comment(comment)
    # Verify photo belongs to album
    photo = (
        client.table("album_photos")
        .select("id, album_id, status, deleted_at")
        .eq("id", photo_id)
        .eq("album_id", album_id)
        .limit(1)
        .execute()
    )
    if not photo.data or is_deleted_album_photo(photo.data[0]):
        raise HTTPException(status_code=404, detail="사진을 찾을 수 없습니다.")

    row = {
        "album_id": album_id,
        "photo_id": photo_id,
        "author_id": contributor.get("user_id"),
        "contributor_id": contributor["id"],
        "author_name": str(contributor.get("display_name") or "참여자")[:40],
        "relationship": contributor.get("relationship"),
        "comment": text,
    }
    inserted = client.table("photo_memories").insert(row).execute()
    mark_album_dirty(client, album_id)
    return (inserted.data or [row])[0]


def update_photo_memory(
    client: Client,
    *,
    album_id: str,
    memory_id: str,
    contributor: dict[str, Any],
    comment: str,
    is_owner: bool,
) -> dict[str, Any]:
    text = sanitize_memory_comment(comment)
    existing = (
        client.table("photo_memories")
        .select("*")
        .eq("id", memory_id)
        .eq("album_id", album_id)
        .is_("deleted_at", "null")
        .limit(1)
        .execute()
    )
    if not existing.data:
        raise HTTPException(status_code=404, detail="기억을 찾을 수 없습니다.")
    memory = existing.data[0]
    if not is_owner and str(memory.get("contributor_id")) != str(contributor["id"]):
        raise HTTPException(status_code=403, detail="다른 사람의 기억은 수정할 수 없어요.")
    updated = (
        client.table("photo_memories")
        .update({"comment": text, "updated_at": _iso()})
        .eq("id", memory_id)
        .execute()
    )
    mark_album_dirty(client, album_id)
    return (updated.data or [{**memory, "comment": text}])[0]


def delete_photo_memory(
    client: Client,
    *,
    album_id: str,
    memory_id: str,
    contributor: dict[str, Any] | None,
    is_owner: bool,
) -> None:
    existing = (
        client.table("photo_memories")
        .select("*")
        .eq("id", memory_id)
        .eq("album_id", album_id)
        .is_("deleted_at", "null")
        .limit(1)
        .execute()
    )
    if not existing.data:
        raise HTTPException(status_code=404, detail="기억을 찾을 수 없습니다.")
    memory = existing.data[0]
    if not is_owner:
        if not contributor or str(memory.get("contributor_id")) != str(contributor["id"]):
            raise HTTPException(status_code=403, detail="다른 사람의 기억은 삭제할 수 없어요.")
    client.table("photo_memories").update({"deleted_at": _iso()}).eq("id", memory_id).execute()
    mark_album_dirty(client, album_id)


def soft_delete_photo(client: Client, album_id: str, photo_id: str) -> None:
    if not soft_delete_album_photo_with_references(client, album_id, photo_id):
        raise HTTPException(status_code=404, detail="사진을 찾을 수 없습니다.")


def build_album_document_from_records(
    album: dict[str, Any],
    photos: list[dict[str, Any]],
    memories: list[dict[str, Any]],
) -> dict[str, Any]:
    """Server-side Album JSON (no AI). Mirrors chapter + memory flow structure."""
    ready = [photo for photo in photos if is_ready_album_photo(photo)]
    ready.sort(
        key=lambda p: (
            str(p.get("taken_at") or "9999"),
            int(p.get("sort_order") or 0),
        )
    )
    memories_by_photo: dict[str, list[dict[str, Any]]] = {}
    for memory in memories:
        if memory.get("deleted_at"):
            continue
        pid = str(memory["photo_id"])
        memories_by_photo.setdefault(pid, []).append(memory)
    for pid in memories_by_photo:
        memories_by_photo[pid].sort(key=lambda m: str(m.get("created_at") or ""))

    chapters: dict[str, list[dict[str, Any]]] = {}
    undated: list[dict[str, Any]] = []
    for photo in ready:
        taken = photo.get("taken_at")
        key = str(taken)[:10] if taken else None
        item = {
            "id": str(photo["id"]),
            "taken_at": photo.get("taken_at"),
            "sort_order": photo.get("sort_order"),
            "orientation": photo.get("orientation"),
            "width": photo.get("width"),
            "height": photo.get("height"),
            "latitude": photo.get("latitude"),
            "longitude": photo.get("longitude"),
            "location_name": photo.get("location_name"),
            "location_source": photo.get("location_source") or "unknown",
            "memories": [
                {
                    "id": str(m["id"]),
                    "author_name": m.get("author_name"),
                    "relationship": m.get("relationship"),
                    "comment": m.get("comment"),
                    "created_at": m.get("created_at"),
                    "contributor_id": str(m.get("contributor_id")),
                }
                for m in memories_by_photo.get(str(photo["id"]), [])
            ],
        }
        if key:
            chapters.setdefault(key, []).append(item)
        else:
            undated.append(item)

    def _month_title(date_key: str | None, place: str | None) -> str:
        if not date_key:
            return place or "함께한 순간"
        year, month, _ = date_key.split("-")
        label = f"{int(year)}년 {int(month)}월"
        return f"{label} · {place}" if place else label

    def _place_for(photos_in: list[dict[str, Any]]) -> tuple[str | None, str]:
        for photo in photos_in:
            name = (photo.get("location_name") or "").strip()
            source = photo.get("location_source") or "unknown"
            if name and source != "unknown":
                return name, source
        return None, "unknown"

    # Cluster consecutive dates (< 3 day gap) into trips → Day N; else event titles
    sorted_keys = sorted(chapters.keys())
    trips: list[list[str]] = []
    for key in sorted_keys:
        if not trips:
            trips.append([key])
            continue
        prev = trips[-1][-1]
        gap = (
            datetime.fromisoformat(f"{key}T00:00:00+00:00")
            - datetime.fromisoformat(f"{prev}T00:00:00+00:00")
        ).days
        if 0 <= gap < 3:
            trips[-1].append(key)
        else:
            trips.append([key])

    chapter_list: list[dict[str, Any]] = []
    chapter_index = 0
    for trip in trips:
        multi = len(trip) >= 2
        for day_i, date_key in enumerate(trip, start=1):
            chapter_index += 1
            photos_in = chapters[date_key]
            place, source = _place_for(photos_in)
            place_out = None if source == "unknown" else place
            if multi:
                title = f"Day {day_i}"
                kind = "day"
            else:
                title = _month_title(date_key, place_out)
                kind = "event"
            chapter_list.append(
                {
                    "date": date_key,
                    "endDate": date_key,
                    "title": title,
                    "dayIndex": chapter_index,
                    "tripDay": day_i if multi else None,
                    "kind": kind,
                    "place": place_out,
                    "locationSource": source,
                    "photos": photos_in,
                }
            )
    if undated:
        if chapter_list:
            chapter_list[-1]["photos"].extend(undated)
        else:
            place, source = _place_for(undated)
            place_out = None if source == "unknown" else place
            chapter_list.append(
                {
                    "date": None,
                    "endDate": None,
                    "title": place_out or "함께한 순간",
                    "dayIndex": 1,
                    "tripDay": None,
                    "kind": "neutral",
                    "place": place_out,
                    "locationSource": source,
                    "photos": undated,
                }
            )

    epilogue = str(album.get("epilogue") or album.get("narrative") or "").strip()

    # Lightweight block plan per chapter (serializable; engine details on client)
    for chapter_i, chapter in enumerate(chapter_list):
        blocks: list[dict[str, Any]] = []
        photos_in_chapter = chapter["photos"]
        if photos_in_chapter:
            for i in range(0, len(photos_in_chapter), 6):
                chunk = photos_in_chapter[i : i + 6]
                blocks.append({"kind": "Grid6", "photoIds": [p["id"] for p in chunk]})
                for photo in chunk:
                    mems = photo.get("memories") or []
                    if len(mems) >= 2 or (len(mems) == 1 and len(str(mems[0].get("comment") or "")) >= 81):
                        blocks.append(
                            {
                                "kind": "MemoryBlock",
                                "photoIds": [photo["id"]],
                                "segments": [
                                    {
                                        "author": m.get("author_name"),
                                        "text": m.get("comment"),
                                    }
                                    for m in mems
                                ],
                            }
                        )
        # Collapse consecutive MemoryBlocks — no chapter Story blocks
        collapsed: list[dict[str, Any]] = []
        for block in blocks:
            if (
                block["kind"] == "MemoryBlock"
                and collapsed
                and collapsed[-1]["kind"] == "MemoryBlock"
            ):
                collapsed[-1]["segments"] = list(collapsed[-1].get("segments") or []) + list(
                    block.get("segments") or []
                )
                collapsed[-1]["photoIds"] = list(collapsed[-1].get("photoIds") or []) + list(
                    block.get("photoIds") or []
                )
                continue
            collapsed.append(block)
        chapter["blocks"] = collapsed
        chapter["storyBody"] = None

    return {
        "album_id": str(album["id"]),
        "title": album.get("title") or "",
        "narrative": epilogue,
        "epilogue": epilogue,
        "coverDateLabel": None,
        "chapters": chapter_list,
        "builtAt": _iso(),
        "engine": "server-lite",
    }


def album_document_photo_ids(document: dict[str, Any] | None) -> set[str]:
    """Return stable photo IDs included by a serialized album document."""
    ids: set[str] = set()
    for chapter in (document or {}).get("chapters") or []:
        for photo in chapter.get("photos") or []:
            if photo.get("id"):
                ids.add(str(photo["id"]))
    return ids


def album_document_memory_ids(document: dict[str, Any] | None) -> set[str]:
    """Return stable memory IDs included by a serialized album document."""
    ids: set[str] = set()
    for chapter in (document or {}).get("chapters") or []:
        for photo in chapter.get("photos") or []:
            for memory in photo.get("memories") or []:
                if memory.get("id"):
                    ids.add(str(memory["id"]))
    return ids


def living_recommended_mode(photo_count: int, memory_count: int) -> str:
    """Choose the least disruptive default while allowing an explicit override."""
    if photo_count <= LIVING_APPEND_PHOTO_THRESHOLD and memory_count <= LIVING_APPEND_MEMORY_THRESHOLD:
        return "append_page"
    return "edition"


def unpack_edition_snapshot(snapshot: Any) -> tuple[dict[str, Any] | None, list[dict[str, Any]]]:
    """Read both legacy raw documents and new Living Album history entries."""
    if not isinstance(snapshot, dict):
        return None, []
    if isinstance(snapshot.get("document"), dict):
        pages = snapshot.get("append_pages")
        return snapshot["document"], list(pages) if isinstance(pages, list) else []
    return snapshot, []


def edition_snapshot(document: dict[str, Any] | None, append_pages: list[dict[str, Any]] | None) -> dict[str, Any]:
    """Store an edition with its final Living Album pages together."""
    return {
        "document": document or {},
        "append_pages": list(append_pages or []),
    }


def rebuild_album(
    client: Client,
    album: dict[str, Any],
    *,
    album_json: dict[str, Any] | None = None,
    force: bool = False,
    history_append_pages: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    album_id = str(album["id"])
    if not album.get("dirty") and not force:
        raise HTTPException(status_code=400, detail="새롭게 반영할 내용이 없습니다.")

    # This is a mutual-exclusion lock, not a quota: completed and failed rebuilds
    # clear it so the album can be rebuilt again immediately.
    lock = client.table("albums").update({"last_rebuild_started_at": _iso()}).eq("id", album_id).is_("last_rebuild_started_at", "null").execute()
    if getattr(lock, "data", None) == []:
        raise HTTPException(status_code=409, detail="앨범을 다시 만드는 작업이 이미 진행 중입니다.")

    try:
        photos = ready_album_photo_query(client.table("album_photos").select("*").eq("album_id", album_id)).is_("deleted_at", "null").order("sort_order").execute().data or []
        memories = list_photo_memories(client, album_id)
        document = album_json or build_album_document_from_records(album, photos, memories)
        next_version = int(album.get("album_version") or 0) + 1
        built_at = _iso()
        current_version = int(album.get("album_version") or 0)
        history = dict(album.get("album_version_history") or {})
        if album.get("album_json"):
            # Keep old raw-history rows compatible until a Living Album page is
            # actually involved; newer snapshots carry their appended pages.
            if history_append_pages is None and "living_append_pages" not in album:
                history[str(current_version)] = album.get("album_json")
            else:
                history[str(current_version)] = edition_snapshot(
                    album.get("album_json"),
                    history_append_pages if history_append_pages is not None else album.get("living_append_pages"),
                )
        client.table("albums").update({"album_json": document, "album_version": next_version, "album_version_history": history, "dirty": False, "last_built_at": built_at, "last_rebuild_started_at": None, "collaboration_status": "ready" if album.get("collaboration_status") == "collecting" else album.get("collaboration_status"), "updated_at": built_at}).eq("id", album_id).execute()
        return {"album_version": next_version, "dirty": False, "last_built_at": built_at, "album_json": document}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Could not update the album.") from exc
    finally:
        client.table("albums").update({"last_rebuild_started_at": None}).eq("id", album_id).execute()


def apply_selected_contributions(
    client: Client,
    album: dict[str, Any],
    *,
    photo_ids: set[str],
    memory_ids: set[str],
    mode: str = "auto",
) -> dict[str, Any]:
    """Apply selected contributions as an appended page or a newly composed edition."""
    album_id = str(album["id"])
    if not photo_ids and not memory_ids:
        raise HTTPException(status_code=400, detail="반영할 새 추억이 없습니다.")
    if mode not in {"auto", "append_page", "edition"}:
        raise HTTPException(status_code=400, detail="Unknown Living Album update mode.")
    baseline = contribution_baseline_at(album)
    applied_photo_ids = {str(item) for item in (album.get("applied_contribution_photo_ids") or [])}
    applied_memory_ids = {str(item) for item in (album.get("applied_contribution_memory_ids") or [])}
    contributors = list_contributors(client, album_id)
    owner_ids = {str(row["id"]) for row in contributors if row.get("role") == "owner"}
    photos = ready_album_photo_query(client.table("album_photos").select("*").eq("album_id", album_id)).is_("deleted_at", "null").order("sort_order").execute().data or []
    memories = list_photo_memories(client, album_id)
    pending_photos = {
        str(row["id"])
        for row in photos
        if str(row.get("uploaded_by_contributor_id") or "").strip()
        and str(row.get("uploaded_by_contributor_id") or "").strip() not in owner_ids
        and str(row.get("created_at") or "") > baseline
        and str(row["id"]) not in applied_photo_ids
    }
    pending_memories = {
        str(row["id"])
        for row in memories
        if str(row.get("contributor_id") or "").strip()
        and str(row.get("contributor_id") or "").strip() not in owner_ids
        and str(row.get("created_at") or "") > baseline
        and str(row["id"]) not in applied_memory_ids
    }
    if not photo_ids.issubset(pending_photos) or not memory_ids.issubset(pending_memories):
        raise HTTPException(status_code=409, detail="Some selected memories are no longer waiting to be applied.")
    pending_photo_count = len(photo_ids)
    pending_memory_count = len(memory_ids)
    selected_mode = living_recommended_mode(pending_photo_count, pending_memory_count) if mode == "auto" else mode

    current_document = album.get("album_json") if isinstance(album.get("album_json"), dict) else None
    append_pages = list(album.get("living_append_pages") or [])
    append_photo_ids = {
        str(photo_id)
        for page in append_pages if isinstance(page, dict)
        for photo_id in (page.get("photo_ids") or [])
    }
    append_memory_ids = {
        str(memory_id)
        for page in append_pages if isinstance(page, dict)
        for memory_id in (page.get("memory_ids") or [])
    }
    base_photo_ids = album_document_photo_ids(current_document)
    base_memory_ids = album_document_memory_ids(current_document)
    if not base_photo_ids:
        base_photo_ids = {
            str(row["id"])
            for row in photos
            if str(row.get("uploaded_by_contributor_id") or "") in owner_ids
            or str(row.get("created_at") or "") <= str(baseline or "")
            or str(row["id"]) in applied_photo_ids
        } - append_photo_ids
    if not base_memory_ids:
        base_memory_ids = {
            str(row["id"])
            for row in memories
            if str(row.get("contributor_id") or "") in owner_ids
            or str(row.get("created_at") or "") <= str(baseline or "")
            or str(row["id"]) in applied_memory_ids
        } - append_memory_ids

    included_photo_ids = base_photo_ids | append_photo_ids | photo_ids
    photo_limit = int(album.get("photo_limit") or 30)
    if len(included_photo_ids) > photo_limit:
        existing_count = len(included_photo_ids) - len(photo_ids)
        raise HTTPException(
            status_code=400,
            detail=(
                f"현재 사진 {existing_count}장에 새 사진 {len(photo_ids)}장이 추가되었습니다. "
                f"앨범에 넣을 사진 {photo_limit}장을 선택해 주세요."
            ),
        )
    base_photos = [row for row in photos if str(row["id"]) in base_photo_ids]
    base_memories = [
        row for row in memories
        if str(row["id"]) in base_memory_ids and str(row.get("photo_id") or "") in base_photo_ids
    ]
    base_document = current_document or build_album_document_from_records(album, base_photos, base_memories)

    if selected_mode == "append_page":
        page_id = str(uuid.uuid4())
        next_append_pages = [
            *append_pages,
            {
                "id": page_id,
                "type": "append_page",
                "created_at": _iso(),
                "photo_ids": sorted(photo_ids),
                "memory_ids": sorted(memory_ids),
            },
        ]
        result = rebuild_album(
            client,
            album,
            album_json=base_document,
            force=True,
            history_append_pages=append_pages,
        )
        next_living_pages = next_append_pages
    else:
        edition_photo_ids = base_photo_ids | append_photo_ids | photo_ids
        edition_memory_ids = base_memory_ids | append_memory_ids | memory_ids
        edition_photos = [row for row in photos if str(row["id"]) in edition_photo_ids]
        edition_memories = [
            row for row in memories
            if str(row["id"]) in edition_memory_ids and str(row.get("photo_id") or "") in edition_photo_ids
        ]
        document = build_album_document_from_records(album, edition_photos, edition_memories)
        result = rebuild_album(
            client,
            album,
            album_json=document,
            force=True,
            history_append_pages=append_pages,
        )
        next_living_pages = []
        page_id = None

    applied_at = _iso()
    current_cover_id = str(album.get("cover_photo_id") or "")
    visible_photos = [row for row in photos if str(row["id"]) in included_photo_ids]
    next_cover_id = current_cover_id if current_cover_id in included_photo_ids else (str(visible_photos[0]["id"]) if visible_photos else None)
    client.table("albums").update({
        "last_collaboration_applied_at": applied_at,
        "applied_contribution_photo_ids": sorted(applied_photo_ids | photo_ids),
        "applied_contribution_memory_ids": sorted(applied_memory_ids | memory_ids),
        "living_append_pages": next_living_pages,
        "living_latest_edition_previous": (
            int(album.get("album_version") or 0)
            if selected_mode == "edition"
            else album.get("living_latest_edition_previous")
        ),
        "cover_photo_id": next_cover_id,
        "pdf_cache": {},
    }).eq("id", album_id).execute()
    return {
        **result,
        "last_applied_at": applied_at,
        "applied_count": len(photo_ids) + len(memory_ids),
        "mode": selected_mode,
        "append_page_id": page_id,
        "previous_edition": int(album.get("album_version") or 0) if selected_mode == "edition" else None,
    }


def pdf_cache_key(album_id: str, version: int) -> str:
    return f"{album_id}/v{version}"


def get_cached_pdf_path(album: dict[str, Any], version: int | str) -> str | None:
    cache = album.get("pdf_cache") or {}
    if isinstance(cache, str):
        return None
    entry = cache.get(str(version))
    if isinstance(entry, dict):
        return entry.get("path")
    return None


def get_cached_pdf_bucket(album: dict[str, Any], version: int | str, default_bucket: str) -> str:
    cache = album.get("pdf_cache") or {}
    entry = cache.get(str(version)) if isinstance(cache, dict) else None
    if isinstance(entry, dict) and entry.get("bucket"):
        return str(entry["bucket"])
    return default_bucket


def set_cached_pdf_path(client: Client, album: dict[str, Any], version: int | str, path: str, bucket: str | None = None) -> None:
    cache = dict(album.get("pdf_cache") or {})
    cache[str(version)] = {"path": path, "bucket": bucket, "created_at": _iso()}
    client.table("albums").update({"pdf_cache": cache}).eq("id", album["id"]).execute()


def new_guest_id() -> str:
    return str(uuid.uuid4())


def guest_session_cookie_name(album_id: str) -> str:
    digest = hashlib.sha256(album_id.encode("utf-8")).hexdigest()[:12]
    return f"momento_collab_{digest}"
