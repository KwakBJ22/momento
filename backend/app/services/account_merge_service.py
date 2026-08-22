"""계정 두 개를 하나로 합친다 (2026-08-19 · 2단계).

PO 결정: **이메일이 같으면 합치겠냐고 묻는다. 다르면 사용자가 직접 합치게 한다.**

★ 합치기는 **양쪽 다 로그인할 수 있어야** 성립한다. 이메일이 같다는 것만으로 합치면
  그 이메일을 실제로 갖고 있지 않은 사람이 남의 계정에 들어갈 수 있다. 그래서 합치는
  순간에는 늘 두 자격을 모두 증명하게 한다 — 지금 들고 있는 토큰 하나, 합칠 계정의
  토큰 하나. 판정은 둘 다 서버가 한다(§10).

★ **하나라도 잃으면 안 된다.** 옮기는 일은 `merge_profiles` RPC 하나로 묶는다 —
  중간에 실패하면 트랜잭션이 통째로 돌아가 아무것도 바뀌지 않는다.
  (여기서 나눠 부르면 반쯤 옮겨진 상태가 남는다. 그것이 최악이다.)

★ 남는 계정은 **닫기만 한다.** 지우지 않는다(profiles.deleted_at). auth.users 도 그대로다.
"""

from __future__ import annotations

import logging
from typing import Any

from supabase import Client

logger = logging.getLogger(__name__)


def normalized_email(value: str | None) -> str:
    """이메일 비교는 **소문자·공백 제거**로 한 곳에서 한다. 두 곳이 갈리면 안 된다."""
    return (value or "").strip().lower()


def get_profile(client: Client, profile_id: str) -> dict[str, Any] | None:
    rows = (
        client.table("profiles")
        .select("id,email,display_name,primary_provider,deleted_at,status")
        .eq("id", profile_id)
        .limit(1)
        .execute()
        .data
        or []
    )
    return rows[0] if rows else None


def find_merge_candidate(client: Client, profile_id: str) -> dict[str, Any] | None:
    """지금 로그인한 계정과 **같은 이메일로 만든 다른 계정**을 찾는다.

    ★ 살아 있는 계정만 본다. 이미 닫힌(합쳐진) 계정은 후보가 아니다.
    ★ 돌려주는 것은 **어느 길로 만들었는지**와 이메일뿐이다. 앨범도 이름도 주지 않는다 —
      아직 그 계정의 주인임을 증명하지 않았다.
    """
    me = get_profile(client, profile_id)
    if not me or me.get("deleted_at"):
        return None
    email = normalized_email(me.get("email"))
    if not email:
        return None
    rows = (
        client.table("profiles")
        .select("id,email,primary_provider,deleted_at")
        .eq("email", email)
        .execute()
        .data
        or []
    )
    for row in rows:
        if str(row.get("id")) == str(profile_id) or row.get("deleted_at"):
            continue
        return {
            "candidate_id": str(row.get("id")),
            "email": email,
            "provider": (row.get("primary_provider") or "").strip().lower() or None,
            "my_provider": (me.get("primary_provider") or "").strip().lower() or None,
        }
    return None


def find_merged_away(client: Client, profile_id: str) -> dict[str, Any] | None:
    """이 계정이 **이미 합쳐져 닫힌** 계정인가 — 그렇다면 어디로 갔는지 알려 준다.

    ★ 새 칸을 만들지 않는다. `내 프로필이 닫혀 있고, 같은 이메일로 살아 있는 계정이
      있다` 는 사실만으로 안다. 그 사람이 옛 방법으로 로그인했을 때 빈 계정을 보고
      당황하지 않게 하려는 자리다.
    """
    me = get_profile(client, profile_id)
    if not me or not me.get("deleted_at"):
        return None
    email = normalized_email(me.get("email"))
    if not email:
        return None
    rows = (
        client.table("profiles")
        .select("id,primary_provider,deleted_at")
        .eq("email", email)
        .execute()
        .data
        or []
    )
    for row in rows:
        if str(row.get("id")) == str(profile_id) or row.get("deleted_at"):
            continue
        return {"provider": (row.get("primary_provider") or "").strip().lower() or None}
    return None


def count_user_data(client: Client, profile_id: str) -> dict[str, int]:
    """그 계정이 들고 있는 것을 센다 — **합치기 전과 후를 견주는 자**다.

    ★ 세는 곳은 여기 하나다. 합치기 검사가 이 값을 앞뒤로 재서 `하나도 잃지 않았다` 를
      확인한다(합계가 같아야 한다).
    """

    def count(table: str, column: str) -> int:
        rows = (
            client.table(table).select("id").eq(column, profile_id).execute().data or []
        )
        return len(rows)

    owned = (
        client.table("albums")
        .select("id")
        .or_(f"owner_id.eq.{profile_id},created_by.eq.{profile_id}")
        .execute()
        .data
        or []
    )
    return {
        "albums": len(owned),
        "contributions": count("album_contributors", "user_id"),
        "memberships": count("album_members", "profile_id"),
        "bookmarks": count("album_bookmarks", "user_id"),
        "memories": count("photo_memories", "author_id"),
        "photos": count("album_photos", "contributor_profile_id"),
    }


def merge_profiles(client: Client, *, source_id: str, target_id: str) -> dict[str, Any]:
    """`source` 를 `target` 으로 옮기고 source 를 닫는다.

    ★ 옮기는 일 자체는 DB 함수 하나가 한다(merge_profiles RPC). 여기서 나누지 않는다 —
      중간에 실패하면 전부 되돌아가야 하기 때문이다.
    ★ **합치기 전후의 수를 함께 돌려준다.** 부르는 쪽(과 검사)이 잃은 것이 없는지 본다.
    ★ `primary_provider` 는 **남는 계정 것을 그대로 둔다.** 지금 실제로 로그인해 있는
      길이 그것이고, 합쳤다고 해서 로그인 방법이 바뀌지는 않기 때문이다. 옮겨 온 쪽의
      로그인 방법은 auth 쪽 신원(identity)이 정하는 것이라 이 칸이 정하지 않는다.
    """
    before_source = count_user_data(client, source_id)
    before_target = count_user_data(client, target_id)

    result = client.rpc(
        "merge_profiles", {"p_source": source_id, "p_target": target_id}
    ).execute()
    payload = result.data if isinstance(result.data, dict) else {}

    after_target = count_user_data(client, target_id)
    totals_before = {key: before_source[key] + before_target[key] for key in before_target}
    logger.info(
        "account_merged moved=%s dropped=%s albums_before=%s albums_after=%s",
        payload.get("moved"),
        payload.get("dropped"),
        totals_before["albums"],
        after_target["albums"],
    )
    return {
        "moved": int(payload.get("moved") or 0),
        "dropped": int(payload.get("dropped") or 0),
        "before": totals_before,
        "after": after_target,
    }
