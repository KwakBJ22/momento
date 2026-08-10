"""받은 동의를 **기록만** 한다 (K-14 재작업).

★ 이 파일은 무엇도 막지 않는다. 기록이 없다고 앨범을 못 열거나 사진을 못 올리는 일은
  없어야 한다. 지난번 사고가 거기서 났다 — 판정에 쓰지 않는다, 남기기만 한다.

★ 버전 문자열은 여기 한 곳에만 있다. 화면은 "동의했다"는 사실만 보내고, 무엇에
  동의한 것인지는 서버가 붙인다. 두 언어에 같은 문자열을 흩어 두면 한쪽만 바뀐다.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger(__name__)

# 약관·개인정보처리방침 시행일 (둘 다 같은 날이다).
LEGAL_VERSION = "2026-08-11"


def record_legal_consent(client: Any, profile_id: str) -> bool:
    """`legal_agreed_at` 이 비어 있을 때만 지금 시각과 버전을 채운다.

    이미 값이 있으면 아무것도 하지 않는다 — **덮어쓰지 않는다.** 처음 동의한 때가
    남아야 할 값이라, 다시 로그인할 때마다 갱신하면 그 시각을 잃는다.
    `is_("legal_agreed_at", "null")` 을 조건으로 걸어 한 문장으로 처리한다
    (읽고 나서 쓰면 그 사이에 다른 로그인이 끼어들 수 있다).

    돌려주는 값은 "이번에 새로 채웠는가"이고, 실패해도 예외를 올리지 않는다.
    로그인은 이 기록보다 중요하다.
    """
    try:
        result = (
            client.table("profiles")
            .update({
                "legal_agreed_at": datetime.now(timezone.utc).isoformat(),
                "legal_agreed_version": LEGAL_VERSION,
            })
            .eq("id", profile_id)
            .is_("legal_agreed_at", "null")
            .execute()
        )
        return bool(result.data)
    except Exception as exc:  # noqa: BLE001 - 로그인을 막지 않는다
        logger.warning("legal_consent_record_failed error_type=%s", type(exc).__name__)
        return False
