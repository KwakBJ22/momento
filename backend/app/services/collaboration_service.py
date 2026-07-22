"""Collaborative album MVP: invites, contributors, memories, dirty rebuild."""

from __future__ import annotations

import hashlib
import html
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import HTTPException
from supabase import Client

from app.services.share_service import create_token, hash_token

RELATIONSHIP_OPTIONS = frozenset({"아빠", "엄마", "딸", "아들", "친구", "동료", "기타"})
MIN_REBUILD_INTERVAL_SECONDS = 60
MAX_COMMENT_LEN = 500
MAX_BATCH_UPLOAD = 10


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
        client.table("album_photos")
        .select("id", count="exact")
        .eq("album_id", album_id)
        .eq("status", "ready")
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
        raise HTTPException(status_code=400, detail="관계를 다시 선택해 주세요.")

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
        .select("id, display_name, relationship, role, joined_at, status")
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
    if not photo.data or photo.data[0].get("deleted_at") or photo.data[0].get("status") == "deleted":
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
    client.table("album_photos").update(
        {"status": "deleted", "deleted_at": _iso()}
    ).eq("id", photo_id).eq("album_id", album_id).execute()
    mark_album_dirty(client, album_id)


def build_album_document_from_records(
    album: dict[str, Any],
    photos: list[dict[str, Any]],
    memories: list[dict[str, Any]],
) -> dict[str, Any]:
    """Server-side Album JSON (no AI). Mirrors chapter + memory flow structure."""
    ready = [p for p in photos if p.get("status") == "ready" and not p.get("deleted_at")]
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
        is_last = chapter_i == len(chapter_list) - 1
        if photos_in_chapter:
            hero = photos_in_chapter[0]
            blocks.append({"kind": "Hero", "photoIds": [hero["id"]]})
            hero_mems = hero.get("memories") or []
            if len(hero_mems) >= 2 or (len(hero_mems) == 1 and len(str(hero_mems[0].get("comment") or "")) >= 81):
                blocks.append(
                    {
                        "kind": "MemoryBlock",
                        "photoIds": [hero["id"]],
                        "segments": [
                            {"author": m.get("author_name"), "text": m.get("comment")}
                            for m in hero_mems
                        ],
                    }
                )
            rest = photos_in_chapter[1:]
            i = 0
            while i < len(rest):
                chunk = rest[i : i + 6]
                kind = "Polaroid3" if len(chunk) <= 4 else "Grid6"
                blocks.append({"kind": kind, "photoIds": [p["id"] for p in chunk]})
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
                i += 6
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


def rebuild_album(
    client: Client,
    album: dict[str, Any],
    *,
    album_json: dict[str, Any] | None = None,
    force: bool = False,
) -> dict[str, Any]:
    album_id = str(album["id"])
    if not album.get("dirty") and not force:
        raise HTTPException(status_code=400, detail="새롭게 반영할 내용이 없습니다.")

    started = album.get("last_rebuild_started_at")
    if started:
        started_dt = datetime.fromisoformat(str(started).replace("Z", "+00:00"))
        if (_now() - started_dt).total_seconds() < MIN_REBUILD_INTERVAL_SECONDS:
            raise HTTPException(status_code=429, detail="앨범을 정리하고 있습니다… 잠시 후 다시 시도해 주세요.")

    client.table("albums").update({"last_rebuild_started_at": _iso()}).eq("id", album_id).execute()

    try:
        photos = client.table("album_photos").select("*").eq("album_id", album_id).eq("status", "ready").is_("deleted_at", "null").order("sort_order").execute().data or []
        memories = list_photo_memories(client, album_id)
        document = album_json or build_album_document_from_records(album, photos, memories)
        next_version = int(album.get("album_version") or 0) + 1
        built_at = _iso()
        client.table("albums").update({"album_json": document, "album_version": next_version, "dirty": False, "last_built_at": built_at, "collaboration_status": "ready" if album.get("collaboration_status") == "collecting" else album.get("collaboration_status"), "updated_at": built_at}).eq("id", album_id).execute()
        return {"album_version": next_version, "dirty": False, "last_built_at": built_at, "album_json": document}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Could not update the album.") from exc


def apply_selected_contributions(
    client: Client,
    album: dict[str, Any],
    *,
    photo_ids: set[str],
    memory_ids: set[str],
) -> dict[str, Any]:
    """Rebuild the current album document with selected post-apply guest additions only."""
    album_id = str(album["id"])
    baseline = album.get("created_at")
    applied_photo_ids = {str(item) for item in (album.get("applied_contribution_photo_ids") or [])}
    applied_memory_ids = {str(item) for item in (album.get("applied_contribution_memory_ids") or [])}
    contributors = list_contributors(client, album_id)
    owner_ids = {str(row["id"]) for row in contributors if row.get("role") == "owner"}
    photos = client.table("album_photos").select("*").eq("album_id", album_id).eq("status", "ready").is_("deleted_at", "null").order("sort_order").execute().data or []
    memories = list_photo_memories(client, album_id)
    pending_photos = {str(row["id"]) for row in photos if str(row.get("uploaded_by_contributor_id") or "") and str(row.get("uploaded_by_contributor_id") or "") not in owner_ids and str(row.get("created_at") or "") > str(baseline or "") and str(row["id"]) not in applied_photo_ids}
    pending_memories = {str(row["id"]) for row in memories if str(row.get("contributor_id") or "") and str(row.get("contributor_id") or "") not in owner_ids and str(row.get("created_at") or "") > str(baseline or "") and str(row["id"]) not in applied_memory_ids}
    if not photo_ids.issubset(pending_photos) or not memory_ids.issubset(pending_memories):
        raise HTTPException(status_code=409, detail="Some selected memories are no longer waiting to be applied.")
    visible_photos = [row for row in photos if str(row.get("uploaded_by_contributor_id") or "") in owner_ids or str(row.get("created_at") or "") <= str(baseline or "") or str(row["id"]) in applied_photo_ids or str(row["id"]) in photo_ids]
    visible_photo_ids = {str(row["id"]) for row in visible_photos}
    visible_memories = [row for row in memories if str(row.get("contributor_id") or "") in owner_ids or str(row.get("created_at") or "") <= str(baseline or "") or str(row["id"]) in applied_memory_ids or str(row["id"]) in memory_ids]
    visible_memories = [row for row in visible_memories if str(row.get("photo_id") or "") in visible_photo_ids]
    document = build_album_document_from_records(album, visible_photos, visible_memories)
    result = rebuild_album(client, album, album_json=document, force=True)
    applied_at = _iso()
    client.table("albums").update({"last_collaboration_applied_at": applied_at, "applied_contribution_photo_ids": sorted(applied_photo_ids | photo_ids), "applied_contribution_memory_ids": sorted(applied_memory_ids | memory_ids)}).eq("id", album_id).execute()
    return {**result, "last_applied_at": applied_at, "applied_count": len(photo_ids) + len(memory_ids)}
    try:
        pass
    except HTTPException:
        raise
    except Exception as exc:
        # Keep dirty + previous album_json
        raise HTTPException(status_code=500, detail="앨범 업데이트에 실패했습니다. 기존 앨범을 유지합니다.") from exc


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


def set_cached_pdf_path(client: Client, album: dict[str, Any], version: int | str, path: str) -> None:
    cache = dict(album.get("pdf_cache") or {})
    cache[str(version)] = {"path": path, "created_at": _iso()}
    client.table("albums").update({"pdf_cache": cache}).eq("id", album["id"]).execute()


def new_guest_id() -> str:
    return str(uuid.uuid4())


def guest_session_cookie_name(album_id: str) -> str:
    digest = hashlib.sha256(album_id.encode("utf-8")).hexdigest()[:12]
    return f"momento_collab_{digest}"
