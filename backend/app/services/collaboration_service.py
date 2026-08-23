"""Collaborative album MVP: invites, contributors, memories, dirty rebuild."""

from __future__ import annotations

import html
import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import HTTPException
from supabase import Client

from app.models.album_photo_status import is_deleted_album_photo, is_ready_album_photo, ready_album_photo_query
from app.models.schemas import DEFAULT_ALBUM_PHOTO_CAPACITY
from app.services.link_trouble import classify_invite_trouble, link_trouble_message
from app.services.share_service import create_token, hash_token
from app.services.supabase import get_album_record, soft_delete_album_photo_with_references

logger = logging.getLogger(__name__)

RELATIONSHIP_OPTIONS = frozenset({"가족", "친구", "연인", "지인", "기타"})

# `이름만 받은 사람` — 한마디를 남기려고 이름만 적은 구경꾼 (PO 결정 2026-08-16).
#
# ★ **참여자가 아니다.** 참여자가 되는 것은 사용자가 정하는 일이다(화면_기준 §1).
#   그래서 `함께 만든 사람` 수·이름에 들어가지 않고, 사진도 올릴 수 없다.
#   한마디는 인쇄되지 않으므로 남길 수 있다 — 잣대는 `인쇄되는 것만 잠근다` 하나다.
VIEWER_CONTRIBUTOR_ROLE = "viewer"

# A single login attributes at most this many guest contributions — bounds the bootstrap
# payload and any surprising local state. Matches the frontend cap.
CONTRIBUTION_ATTRIBUTION_LIMIT = 50


def attribute_contributions(client: Client, user_id: str, guest_ids: list[str]) -> tuple[list[str], int]:
    """Attach a signed-in account to its prior guest (contributor) rows, best-effort.

    For each unguessable guest_id, fill album_contributors.user_id on rows that still have
    NONE — a row already claimed by another user_id is never touched (no stealing). When the
    user already has an active contributor row for that album, the (album_id, user_id) unique
    index would conflict, so that guest row is SKIPPED (and logged) — their old participation
    stays under the guest name rather than breaking. Returns (settled_guest_ids,
    attributed_album_count).

    ★ 돌려주는 목록은 **끝난 guest id** 다 — 이번에 붙인 것 + **더 할 일이 없는 것**
      (2026-08-19). 예전에는 붙인 것만 돌려줬는데, 화면은 이 목록으로 `다시 안 보내도
      된다` 표시를 한다. 그래서 붙일 것이 없는 id(이미 붙었거나 · 충돌로 영영 못 붙거나 ·
      참여 기록이 아예 없거나)는 표시가 안 돼 **화면을 옮길 때마다 다시 실려 왔고**,
      bootstrap 이 분당 3~4번 찍혔다(Railway dev 08-19). 여기 오는 갈래는 전부
      끝난 상태다 — 다시 보내도 결과가 달라지지 않는다.
      (조회가 도중에 터지면 예외로 올라가 아무것도 표시되지 않는다 — 다음에 다시 온다.)
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
        # 붙였든, 붙일 것이 없었든 — 이 id 는 끝났다. 다시 보내게 두지 않는다.
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


class PendingContributionRules:
    """`아직 반영 안 된 참여` 판정 — 공유 화면과 앨범 화면이 **같은 자를 쓴다**.

    ★ 예전에는 이 판정이 share.py 안에만 있었다. 앨범 화면은 저장된
      `living_append_pages` 만 읽어서, 앨범 문서가 만들어진 뒤에 더해진 사진이
      앨범 화면에서만 사라졌다 (OPEN_ITEMS §2-1). 같은 일을 두 곳이 다른 방식으로
      하면 언젠가 갈린다 — 규칙을 한 벌로 둔다(§13).

    ★ baseline 은 `album.created_at` 이다. `contribution_baseline_at` 이 쓰는
      `last_collaboration_applied_at` 이 아니다 — 공유 화면이 쓰던 값 그대로다.
      (반영된 것은 applied_*_ids 로 걸러지므로 여기서 두 번 걸 필요가 없다.)
    """

    def __init__(
        self,
        *,
        baseline: str,
        owner_ids: set[str],
        applied_photo_ids: set[str],
        applied_memory_ids: set[str],
    ) -> None:
        self.baseline = baseline
        self.owner_ids = owner_ids
        self.applied_photo_ids = applied_photo_ids
        self.applied_memory_ids = applied_memory_ids

    def is_pending_photo(self, photo: dict[str, object]) -> bool:
        contributor_id = str(photo.get("uploaded_by_contributor_id") or "")
        return (
            bool(contributor_id)
            and
            contributor_id not in self.owner_ids
            and str(photo.get("created_at") or "") > self.baseline
            and str(photo.get("id")) not in self.applied_photo_ids
        )

    def is_pending_memory(self, memory: dict[str, object]) -> bool:
        contributor_id = str(memory.get("contributor_id") or "")
        return (
            bool(contributor_id)
            and
            contributor_id not in self.owner_ids
            and str(memory.get("created_at") or "") > self.baseline
            and str(memory.get("id")) not in self.applied_memory_ids
        )


def pending_contribution_rules(
    album: dict[str, Any], contributors: list[dict[str, Any]],
) -> PendingContributionRules:
    """앨범 한 건에 대한 판정 자를 만든다(순수 계산 — DB 를 다시 읽지 않는다)."""
    return PendingContributionRules(
        baseline=str(album.get("created_at") or ""),
        owner_ids={str(row["id"]) for row in contributors if row.get("role") == "owner"},
        applied_photo_ids={str(item) for item in (album.get("applied_contribution_photo_ids") or [])},
        applied_memory_ids={str(item) for item in (album.get("applied_contribution_memory_ids") or [])},
    )


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
        raise HTTPException(status_code=400, detail="한마디를 입력해 주세요.")
    if len(text) > MAX_COMMENT_LEN:
        raise HTTPException(status_code=400, detail=f"한마디는 {MAX_COMMENT_LEN}자까지 쓸 수 있어요.")
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


def find_invite_by_token(client: Client, token: str) -> dict[str, Any] | None:
    """토큰으로 초대 행을 찾는다 — **거르지 않고** 있는 그대로.

    ★ `is_active` 로 걸러서 가져오면 *없는 것*과 *꺼진 것*이 같아져 왜 안 열리는지
    가를 수 없다(J-9). 판정은 `link_trouble.classify_invite_trouble` 한 곳에서 한다.
    """
    result = (
        client.table("album_invites")
        .select("*")
        .eq("token_hash", hash_token(token))
        .limit(1)
        .execute()
    )
    rows = result.data or []
    return rows[0] if rows else None


def get_album_for_invite(client: Client, token: str) -> tuple[dict[str, Any], dict[str, Any]]:
    """초대 링크로 앨범을 연다. 못 열면 **왜 못 여는지** 사용자 말로 알린다(J-9).

    예전에는 없음·만료·무효화가 전부 `"찾을 수 없거나 만료되었습니다"` 한 문장이었다.
    받는 사람은 자기 잘못인지 링크가 낡은 건지 알 수 없었다.
    """
    invite = find_invite_by_token(client, token)
    record: dict[str, Any] | None = None
    if invite:
        album = client.table("albums").select("*").eq("id", invite["album_id"]).limit(1).execute()
        rows = album.data or []
        record = rows[0] if rows else None
    trouble = classify_invite_trouble(invite, record)
    if trouble or record is None:
        # 여는 데 실패한 이유는 넷 다 "볼 수 없다" 이므로 상태 코드는 하나로 둔다 —
        # 화면은 코드가 아니라 이 문구로 무엇을 보여줄지 정한다.
        raise HTTPException(status_code=404, detail=link_trouble_message(trouble or "gone", "invite"))
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
    # 소유자 판정은 함수 안에서 owner_id 로 한다(넘기는 것은 '이 요청을 한 사람').
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


def _album_owner_id(client: Client, album: dict[str, Any]) -> str:
    """이 앨범의 소유자(SCREEN_SPEC §1 — albums.owner_id 하나로 판정한다).

    호출자가 넘긴 dict 에 owner_id 가 없으면 앨범 행에서 읽는다. created_by 는 쓰지
    않는다 — 그것이 owner_id 와 어긋나 owner 행이 둘 생긴 원인이었다.
    """
    owner = str(album.get("owner_id") or "").strip()
    if owner:
        return owner
    album_id = str(album.get("id") or "").strip()
    if not album_id:
        return ""
    result = client.table("albums").select("owner_id").eq("id", album_id).limit(1).execute()
    rows = result.data or []
    return str((rows[0].get("owner_id") if rows else "") or "").strip()


def ensure_owner_contributor(client: Client, album: dict[str, Any], actor_id: str) -> dict[str, Any]:
    """이 사람의 참여자 행을 보장한다. role 은 **앨범의 소유자인지**로 정한다.

    예전에는 호출자가 넘긴 사람을 무조건 role='owner' 로 넣었고, 호출부 3곳이 서로 다른
    것을 소유자로 넘겨서(업로드한 계정 / created_by / owner_id) owner_id 와 created_by 가
    어긋난 앨범에 owner 행이 **두 개** 생겼다(f9572069). 소유자는 하나다.

    소유자가 아직 없는 앨범(게스트가 만든 것 — claim 전)은 호출자를 소유자로 본다.
    """
    album_id = str(album["id"])
    existing = (
        client.table("album_contributors")
        .select("*")
        .eq("album_id", album_id)
        .eq("user_id", actor_id)
        .eq("status", "active")
        .limit(1)
        .execute()
    )
    if existing.data:
        return existing.data[0]

    profile = client.table("profiles").select("display_name").eq("id", actor_id).limit(1).execute()
    name = "앨범 주인"
    if profile.data:
        name = (profile.data[0].get("display_name") or "").strip() or name

    owner_id = _album_owner_id(client, album)
    is_owner = not owner_id or owner_id == str(actor_id)
    row = {
        "album_id": album_id,
        "user_id": actor_id,
        "guest_id": None,
        "display_name": name[:40],
        "role": "owner" if is_owner else "contributor",
        "status": "active",
    }
    inserted = client.table("album_contributors").insert(row).execute()
    return (inserted.data or [row])[0]


def active_contributor_count(rows: list[dict[str, Any]]) -> int:
    """이미 조회한 참여자 목록에서 "함께한 사람 수"를 센다 — 규칙은 아래 count_active_
    contributors 와 같다(주최자 포함, status='active' 만). 질의를 한 번 더 하지 않기
    위한 같은 규칙의 다른 입구다."""
    return len([row for row in rows if str(row.get("status") or "") == "active"])


def count_active_contributors(client: Client, album_id: str) -> int:
    """이 앨범을 **함께 만든 사람 수**. 세는 곳은 여기 하나다(SCREEN_SPEC §1).

    ★ 주최자를 포함한다. 이 앨범을 같이 만든 사람 전부가 "함께한 사람"이다.
    예전에는 앨범 상세·협업 현황·공유 응답이 각자 셌고 owner 포함 여부가 갈려서, 같은
    앨범인데 소유자 화면과 공유 화면의 수가 1 차이로 어긋났다.

    ★ `이름만 받은 사람`(role='viewer')은 세지 않는다 — 한마디를 남기려고 이름만 적었을
    뿐, 참여자가 된 것이 아니다(화면_기준 §1 · PO 결정 2026-08-16).
    """
    result = (
        client.table("album_contributors")
        .select("id,role")
        .eq("album_id", album_id)
        .eq("status", "active")
        .execute()
    )
    # 거르는 것은 여기서 한다 — 한 앨범의 참여자는 열 명 남짓이라 값이 싸고,
    # 조회 연산자에 기대지 않아 어디서 돌려도 같게 센다.
    return sum(1 for row in (result.data or []) if str(row.get("role") or "") != VIEWER_CONTRIBUTOR_ROLE)


def list_active_contributor_names(client: Client, album_id: str) -> list[str]:
    """"함께 만든 사람" 이름 한 줄에 쓸 이름들 (CLAUDE.md §6 · SCREEN_SPEC §1).

    ★ 세는 규칙과 **같은 자리**다 — 같은 표, 같은 조건(status='active', 주최자 포함).
    수와 이름이 어긋나면 "3명" 이라고 써 놓고 두 명만 적히는 일이 난다.
    들어온 순서(joined_at)를 지킨다 — 주최자가 먼저 들어오므로 자연히 맨 앞에 온다.
    """
    rows = resolve_contributor_names(
        client,
        (
            [
                row
                for row in (
                    client.table("album_contributors")
                    .select("user_id,display_name,joined_at,role")
                    .eq("album_id", album_id)
                    .eq("status", "active")
                    .order("joined_at")
                    .execute()
                    .data
                    or []
                )
                # 세는 규칙과 같다 — `이름만 받은 사람`은 이 줄에 오르지 않는다.
                if str(row.get("role") or "") != VIEWER_CONTRIBUTOR_ROLE
            ]
        ),
    )
    names: list[str] = []
    for row in rows:
        name = str(row.get("display_name") or "").strip()
        # 이름이 비어 있으면 넣지 않는다 — 인쇄물에 빈 자리나 "참여자"가 남으면 어색하다.
        if name and name not in names:
            names.append(name)
    return names


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
    role: str = "contributor",
) -> dict[str, Any]:
    """참여자 행을 만들거나 되살린다.

    ★ ``role='viewer'`` 는 **이름만 받은 사람**이다 — 한마디를 남기려고 이름만 적은
      구경꾼. 참여자가 아니므로 `함께 만든 사람` 에 들어가지 않고 인원 제한도 세지 않는다
      (화면_기준 §1 — 참여자가 되는 것은 사용자가 정하는 일이다).
    """
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

    # 인원 제한은 **참여자**에게만 건다. 이름만 받은 사람은 세지 않는다.
    if role != VIEWER_CONTRIBUTOR_ROLE:
        limit = int(album.get("contributor_limit") or 10)
        if count_active_contributors(client, album_id) >= limit:
            raise HTTPException(status_code=403, detail="참여 인원이 가득 찼어요.")

    row = {
        "album_id": album_id,
        "user_id": user_id,
        "guest_id": guest_id if not user_id else None,
        "display_name": name,
        "relationship": rel,
        "role": role,
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
    for_memory: bool = False,
) -> dict[str, Any]:
    """Resolve contributor from session identity — never trust role from client alone.

    ★ ``for_memory`` 는 **인쇄되는 것만 잠근다**는 잣대다 (PO 결정 2026-08-16).
      한마디는 종이에 들어가지 않으므로 앨범이 확정된 뒤에도, `이름만 받은 사람`
      (role='viewer')에게도 열려 있다. 사진은 그대로 잠긴다.
    """
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
    if for_memory:
        # 한마디는 인쇄되지 않는다 — 확정 여부도, `이름만 받은 사람`인지도 보지 않는다.
        return contributor
    # 사진은 **초대받은 사람**의 몫이다. `이름만 받은 사람`(감상 링크에서 한마디만 남긴
    # 사람)은 참여자가 아니다 — 그 구분을 여기서 지킨다(화면_기준 §1).
    if str(contributor.get("role") or "") == VIEWER_CONTRIBUTOR_ROLE:
        raise HTTPException(status_code=403, detail="사진은 함께 만들기 초대 링크에서 올릴 수 있어요.")
    album = client.table("albums").select("collaboration_status, collaboration_enabled").eq("id", album_id).limit(1).execute()
    status = (album.data or [{}])[0].get("collaboration_status")
    if status == "closed":
        raise HTTPException(status_code=403, detail="함께 만들기가 종료되어 더 이상 추가할 수 없어요.")
    return contributor


def resolve_contributor_names(client: Client, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """참여자 행에 **지금의 이름**을 채워 준다 — 이름을 읽는 곳은 여기 하나다 (SCREEN_SPEC §1).

    ★ album_contributors.display_name 은 **참여하던 그때의 스냅샷**이다. profiles 를 고쳐도
      따라오지 않아, 프로덕션에 `kbjkwak`(이메일 앞부분)이 화면에 그대로 남아 있었다.
      계정이 있는 사람의 이름은 profiles 에서 읽는다.
    ★ 게스트만 예외다 — profiles 가 없으니 저장된 값을 그대로 쓴다.
      그래서 컬럼을 지우지 않는다. 게스트에게 필요하다.

    한 번의 질의로 필요한 profiles 를 모두 읽는다(사람 수만큼 부르지 않는다).
    """
    user_ids = sorted({str(row.get("user_id")) for row in rows if row.get("user_id")})
    profiles: dict[str, str] = {}
    if user_ids:
        fetched = (
            client.table("profiles").select("id,display_name").in_("id", user_ids).execute().data or []
        )
        for profile in fetched:
            name = str(profile.get("display_name") or "").strip()
            if name:
                profiles[str(profile.get("id"))] = name
    resolved: list[dict[str, Any]] = []
    for row in rows:
        user_id = str(row.get("user_id") or "")
        current = profiles.get(user_id)
        resolved.append({**row, "display_name": current or row.get("display_name")} if current else dict(row))
    return resolved


def list_contributors(client: Client, album_id: str) -> list[dict[str, Any]]:
    result = (
        client.table("album_contributors")
        .select("id, user_id, display_name, relationship, role, joined_at, last_active_at, status")
        .eq("album_id", album_id)
        .eq("status", "active")
        .order("joined_at")
        .execute()
    )
    # 이름은 여기서 한 번에 지금 값으로 바꾼다 — 부르는 쪽이 스냅샷을 보지 않게 한다.
    return resolve_contributor_names(client, result.data or [])


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
        raise HTTPException(status_code=404, detail="한마디를 찾을 수 없어요.")
    memory = existing.data[0]
    if not is_owner and str(memory.get("contributor_id")) != str(contributor["id"]):
        raise HTTPException(status_code=403, detail="다른 사람의 한마디는 고칠 수 없어요.")
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
        raise HTTPException(status_code=404, detail="한마디를 찾을 수 없어요.")
    memory = existing.data[0]
    if not is_owner:
        if not contributor or str(memory.get("contributor_id")) != str(contributor["id"]):
            raise HTTPException(status_code=403, detail="다른 사람의 한마디는 지울 수 없어요.")
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
        # 촬영일이 없는 사진은 **제 묶음으로 맨 뒤에** 선다 (2026-08-19).
        #
        # ★ 예전에는 마지막 날짜 묶음에 **섞어 넣었다**(chapter_list[-1] 에 extend).
        #   그러면 남의 날짜 아래로 들어가 그 날짜와 장소를 뒤집어쓰고, 날짜 없는
        #   묶음이 사라져 화면에서 `날짜를 넣어 주세요` 를 그릴 자리도 없어진다.
        #   아이폰 사파리가 EXIF 를 지우므로(2026-08-18) 이 갈래가 흔하다.
        # ★ 화면 엔진(album-engine/engine/chapterGroup.ts)이 하는 것과 **같은 규칙**이다.
        #   서버와 화면이 다르게 묶으면 앨범을 다시 만들 때마다 자리가 바뀐다.
        # ★ 맨 뒤다. 이미 시간순으로 정리된 앞부분을 헤집지 않는다.
        #   안에서는 들어온 차례(sort_order)를 그대로 지킨다.
        place, source = _place_for(undated)
        place_out = None if source == "unknown" else place
        chapter_list.append(
            {
                "date": None,
                "endDate": None,
                "title": place_out or "함께한 순간",
                "dayIndex": len(chapter_list) + 1,
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


def _merge_ids(existing: Any, incoming: set[str]) -> list[str]:
    """이미 있던 순서를 지키면서 새 것을 뒤에 붙인다 (중복 없이)."""
    merged = [str(item) for item in (existing or [])]
    seen = set(merged)
    for item in sorted(incoming):
        if item not in seen:
            seen.add(item)
            merged.append(item)
    return merged


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
    photo_limit = int(album.get("photo_limit") or DEFAULT_ALBUM_PHOTO_CAPACITY)
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
        # ★ 페이지를 매번 새로 만들지 않는다. **마지막 페이지에 쌓는다.**
        #   예전에는 부를 때마다 append 해서 한마디 3개면 페이지가 3장이 됐다.
        #   이제 올라올 때마다 자동으로 부르므로 그대로 두면 앨범이 한 줄짜리
        #   페이지로 뒤덮인다. 페이지가 하나도 없을 때만 새로 만든다.
        last_page = append_pages[-1] if append_pages and isinstance(append_pages[-1], dict) else None
        if last_page is None:
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
        else:
            page_id = str(last_page.get("id") or uuid.uuid4())
            merged = {
                **last_page,
                "id": page_id,
                "type": "append_page",
                "created_at": last_page.get("created_at") or _iso(),
                "updated_at": _iso(),
                # 순서는 유지하고 중복만 없앤다 — 먼저 올라온 것이 먼저 선다.
                "photo_ids": _merge_ids(last_page.get("photo_ids"), photo_ids),
                "memory_ids": _merge_ids(last_page.get("memory_ids"), memory_ids),
            }
            next_append_pages = [*append_pages[:-1], merged]
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


def auto_append_contribution(
    client: Client,
    album_id: str,
    *,
    photo_ids: set[str] | None = None,
    memory_ids: set[str] | None = None,
) -> bool:
    """방금 올라온 것을 **그 건에 대해서만** 마지막 페이지에 붙인다.

    ★ 주최자가 누를 버튼도, 고를 시트도 없다 (PO 결정 2026-08-13). 올라오면 붙는다.

    ★ **이건 서버 내부 실행이다.** 참여자에게 apply-contributions 권한을 준 것이
      아니다 — 호출하는 쪽이 방금 자기가 넣은 id 만 넘긴다.

    ★ **실패해도 올린 것은 살아 있어야 한다.** 사진·한마디는 이미 저장됐고, 붙이는
      일은 그 다음이다. 여기서 터져도 되돌리지 않는다 — 로그만 남기고, 다음에
      누가 올릴 때 아직 안 붙은 것으로 잡혀 같이 붙는다.

    ``edition`` 갈래는 부르지 않는다. 그쪽은 주최자가 명시적으로 고를 때만 돈다.

    Returns: 실제로 붙였는지.
    """
    photos = {str(item) for item in (photo_ids or set()) if str(item).strip()}
    memories = {str(item) for item in (memory_ids or set()) if str(item).strip()}
    if not photos and not memories:
        return False
    try:
        album = get_album_record(client, album_id)
        if not album:
            return False
        apply_selected_contributions(
            client,
            album,
            photo_ids=photos,
            memory_ids=memories,
            mode="append_page",
        )
        return True
    except Exception as exc:  # noqa: BLE001 - 올린 것을 되돌리지 않는다
        logger.warning(
            "auto_append_failed album_id=%s photos=%s memories=%s reason=%s",
            album_id, len(photos), len(memories), exc,
        )
        return False


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

