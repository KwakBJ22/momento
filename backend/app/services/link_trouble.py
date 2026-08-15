"""열리지 않는 링크가 **왜** 안 열리는지 (J-9 · SCREEN_SPEC §8·§10·§11).

카카오톡 대화방의 메시지는 지워지지 않고 계속 남는다. 몇 달 뒤에도 눌린다.
죽은 링크를 누르는 일은 예외가 아니라 **정기적으로 일어나는 일**이다.
그런데 서로 다른 사정이 `"찾을 수 없거나 만료되었습니다"` 한 문장으로 뭉쳐 있었다.
받는 사람은 자기 잘못인지, 링크가 낡은 건지, 앨범이 없어진 건지 알 수 없었다.

갈래는 **셋**이다 (PO 확정 2026-08-09).

    gone     앨범이 지워졌거나 주소가 다르다
    expired  기간이 지났거나, 새 링크로 바뀌어 옛 링크가 됐다
    closed   참여가 끝났다

★ `주소가 잘못됨` 을 따로 두지 않는다. 사람들은 카카오톡에서 **링크를 누른다** —
  무작위 토큰을 손으로 잘못 치는 일은 사실상 없다. 안 일어나는 경우를 위해 DB 를
  바꾸지 않는다. 앨범 삭제가 hard delete 라 초대 행이 함께 사라지므로, 지워진 앨범과
  없는 주소는 어차피 같은 모습(행 없음)이다 — 있음직한 쪽에 맞춰 쓴다.

★ `use_count 초과` 갈래를 만들지 않는다. `max_uses` 가 항상 NULL 이라 일어나지 않는다.
  안 쓰는 갈래는 나중에 틀린 채로 발견된다.

★ **`찾을 수 없어요` 라고 쓰지 않는다.** 그건 *우리가* 못 찾는다는 말이라 받는 사람이
  자기 잘못인가 의심하게 만든다. 누구 잘못인지 말하지 않는다.

★ 기술 용어를 쓰지 않는다 — `토큰` · `만료` · `404` 는 화면에 나오지 않는다(§8).

문구는 **두 줄**이다. 첫 줄이 사실, 둘째 줄이 할 수 있는 일. 줄바꿈은 ``\\n`` 으로 보낸다.
"""

from __future__ import annotations

from typing import Literal

LinkTrouble = Literal["gone", "expired", "closed"]

#: 초대 링크(`/join/`)와 구경용 링크(`/s/`)는 **한 글자만** 다르다 — `초대` / `링크`.
_MESSAGES: dict[LinkTrouble, tuple[str, str]] = {
    "gone": (
        "이 앨범을 더 이상 볼 수 없어요.",
        "만든 분이 앨범을 지웠을 수 있어요. 보내주신 분께 물어보시면 좋겠어요.",
    ),
    "expired": (
        "이 {noun}는 기간이 지났어요.",
        "보내주신 분께 새 링크를 부탁해 보세요.",
    ),
    # ★ 2026-08-16 — 사진만 다 모은 것이다. 한마디는 계속 받는다(인쇄되지 않으므로).
    "closed": (
        "이 앨범은 사진을 다 모았어요.",
        "보내주신 분께 물어보시면 다시 열 수 있어요.",
    ),
}

#: 링크 종류별로 부르는 이름. 문구 표는 하나이고 이 단어만 갈아 끼운다.
LINK_NOUN = {"invite": "초대", "share": "링크"}


def link_trouble_message(trouble: LinkTrouble, kind: str = "invite") -> str:
    """그 사정에 맞는 **두 줄**을 돌려준다. 화면은 이 글을 그대로 그린다."""
    first, second = _MESSAGES[trouble]
    noun = LINK_NOUN.get(kind, LINK_NOUN["invite"])
    return f"{first.format(noun=noun)}\n{second.format(noun=noun)}"


def classify_invite_trouble(invite: dict | None, album: dict | None) -> LinkTrouble | None:
    """초대 링크가 왜 안 열리는지. 열리면 None.

    ``invite`` 는 **is_active 로 거르지 않고** 토큰으로 찾은 행이다 — 걸러서 가져오면
    없는 것과 꺼진 것이 같아져 갈래를 나눌 수 없다.
    """
    if invite is None or album is None:
        return "gone"
    if _is_past(invite.get("expires_at")):
        return "expired"
    if album.get("collaboration_status") == "closed" or not album.get("collaboration_enabled"):
        return "closed"
    if not invite.get("is_active"):
        # 참여를 중단했으면 위에서 걸렸다. 여기까지 왔다는 것은 **새 링크로 바뀐** 것이다 —
        # 받는 사람에게는 낡은 링크이므로 `기간이 지났어요` 가 사실에 가깝다.
        return "expired"
    return None


def classify_share_trouble(share: dict | None) -> LinkTrouble | None:
    """구경용 링크가 왜 안 열리는지. 열리면 None.

    구경용은 `status` 컬럼이 있어 갈래를 남기기 더 쉽다.

    ★ **참여가 끝나도 구경용 링크는 열린다.** 참여가 끝난 것은 *더할 수 없다*는 뜻이지
      *볼 수 없다*는 뜻이 아니다 — 그건 화면 안에서 한 줄로 알려준다(J-8).
      그래서 이 경로에서는 `closed` 갈래가 나오지 않는다. 같은 표를 쓰되
      **일어나는 것만** 낸다(안 쓰는 갈래를 만들지 않는 것과 같은 이유다).
    """
    if share is None:
        return "gone"
    if _is_past(share.get("expires_at")) or share.get("status") == "expired":
        return "expired"
    if share.get("status") != "active":
        # 주최자가 링크를 껐다 — 받는 사람에게는 앨범이 사라진 것과 같다.
        return "gone"
    return None


def _is_past(value: object) -> bool:
    if not value:
        return False
    from datetime import datetime, timezone

    try:
        moment = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return False
    return moment <= datetime.now(timezone.utc)
