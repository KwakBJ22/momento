"""방문자를 **사람 단위**로 세기 위한 익명 키 — 판정이 여기 한 곳에 있다.

"지금까지 N명이 다녀갔어요" 가 사실은 API 호출 수였다(프로덕션 실측: album_revisited
165건 / public_album_viewed 139건, 실제 사람은 2명). analytics_events 에 사람을 구분할
값이 없었기 때문이다.

★ 개인정보를 새로 받지 않는다. IP·User-Agent 를 쓰지 않는다.
  album_guestbook_entries.session_hash 와 같은 방식이다 — 브라우저가 무작위 문자열
  하나를 갖고, 서버는 그 sha256 해시만 저장한다.

★ 로그인 여부에 따라 **다른 컬럼**을 쓰지 않는다. 키를 만드는 규칙을 여기 하나로 두고
  값 하나(visitor_key)만 저장한다. 두 곳에서 판정하면 같은 사람이 화면마다 다르게
  세어지고, 그것이 바로 이 결함이 생긴 방식이다.
"""

from __future__ import annotations

import hashlib

# 브라우저 토큰의 최소 길이 — 게스트북 세션 키와 같은 기준이다(짧은 값은 사람이 아니다).
MIN_TOKEN_LENGTH = 16

# "다녀갔다" 로 세는 이벤트. 다른 이벤트(생성·공유 발급 등)는 방문이 아니다.
VISIT_EVENT_NAMES = ("public_album_viewed", "album_revisited")


def _hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def visitor_key_for_user(user_id: str) -> str:
    """로그인한 사람의 키. 주최자 본인을 빼려면 이 함수로 만든 값과 비교한다."""
    return _hash(f"user:{user_id}")


def resolve_visitor_key(user_id: str | None, visitor_token: str | None) -> str | None:
    """이 요청을 남긴 '사람' 의 키. 만들 수 없으면 None — 그러면 세지 않는다.

    로그인했으면 계정으로, 아니면 브라우저가 가진 무작위 토큰으로 만든다.
    """
    if user_id:
        return visitor_key_for_user(str(user_id))
    token = (visitor_token or "").strip()
    if len(token) < MIN_TOKEN_LENGTH:
        return None
    return _hash(f"anon:{token}")


def count_album_visitors(client, album_id: str, *, owner_id: str | None) -> int:
    """이 앨범에 다녀간 **서로 다른 사람 수**.

    ★ 주최자 본인의 방문은 세지 않는다 — 자기가 들어간 것이 세어지면 안 된다.
    ★ visitor_key 가 없는 옛 이벤트는 세지 않는다(사람을 구분할 수 없는 값이다).
      기존 행은 지우지 않는다 — 0부터 다시 시작할 뿐이다.
    """
    rows = (
        client.table("analytics_events")
        .select("visitor_key")
        .eq("album_id", album_id)
        .in_("event_name", list(VISIT_EVENT_NAMES))
        .not_.is_("visitor_key", "null")
        .execute()
        .data
        or []
    )
    owner_key = visitor_key_for_user(str(owner_id)) if owner_id else None
    keys = {
        str(row.get("visitor_key") or "")
        for row in rows
        if row.get("visitor_key") and str(row.get("visitor_key")) != owner_key
    }
    return len(keys)
