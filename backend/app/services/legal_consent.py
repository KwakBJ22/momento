"""약관 동의 — **서버가 진짜 기록이다** (K-14 · SCREEN_SPEC §11).

로그인할 때마다 체크를 받으면서 한 번도 남기지 않았다. 그래서 이미 동의한 사람인지
알 수 없어 매번 처음처럼 물었고, 언제·어떤 문서에 동의했는지도 없었다.

★ **기기에 남는 값은 근거가 아니다.** 그것은 "이 기기에서는 다시 묻지 않는다" 는
  힌트일 뿐이고, 지울 수도 고칠 수도 있다. 판정은 여기(`profiles`) 한 곳에서 한다(§10).
★ 버전은 **날짜 문자열 하나**다. 문서가 바뀌면 아래 상수를 올린다 — 그러면 모든
  사용자가 다음 로그인 때 한 번 다시 동의한다.

(법률 자문이 아니다. 최종 확인은 PO 가 변호사에게 한다.)
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

#: 지금 받고 있는 문서 버전. **여기 한 곳**에서만 올린다.
#: 프런트의 `lib/legalConsent.ts` 가 같은 값을 들고 있고, 테스트가 둘이 같은지 본다.
LEGAL_DOCUMENT_VERSION = "2026-08-09"


def _stored(client: Any, user_id: str) -> dict[str, Any]:
    rows = (
        client.table("profiles")
        .select("legal_agreed_at,legal_agreed_version")
        .eq("id", user_id)
        .limit(1)
        .execute()
        .data
        or []
    )
    return rows[0] if rows else {}


def needs_legal_consent(client: Any, user_id: str) -> bool:
    """이 사람에게 동의를 **받아야 하는가**.

    받아야 하는 경우는 둘뿐이다:
      · 기록이 아예 없다 (아직 한 번도 안 받았다 — 기존 회원이 여기 해당한다)
      · 기록은 있는데 **버전이 지금 것과 다르다** (문서가 바뀌었다)

    ★ 기존 회원을 임의로 "동의한 것" 으로 채우지 않는다. 비어 있으면 비어 있는 대로
      두고 다음 로그인 때 한 번 받는다 — 안 받고 적는 것은 기록이 아니라 조작이다.
    """
    row = _stored(client, user_id)
    if not row.get("legal_agreed_at"):
        return True
    return str(row.get("legal_agreed_version") or "") != LEGAL_DOCUMENT_VERSION


def record_legal_consent(client: Any, user_id: str) -> dict[str, str]:
    """동의를 남긴다 — **시각과 버전은 서버가 정한다.**

    화면이 보낸 값을 그대로 적지 않는다(§10). 화면은 "동의했다" 는 사실만 전하고,
    무엇에 언제 동의한 것인지는 서버가 안다.
    """
    agreed_at = datetime.now(timezone.utc).isoformat()
    (
        client.table("profiles")
        .update({"legal_agreed_at": agreed_at, "legal_agreed_version": LEGAL_DOCUMENT_VERSION})
        .eq("id", user_id)
        .execute()
    )
    return {"legal_agreed_at": agreed_at, "legal_agreed_version": LEGAL_DOCUMENT_VERSION}
