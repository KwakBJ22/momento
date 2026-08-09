"""열리지 않는 링크가 이유를 말한다 (J-9 · SCREEN_SPEC §8·§10·§11).

예전에는 없음·만료·무효화가 전부 `"찾을 수 없거나 만료되었습니다"` 한 문장이었다.
받는 사람은 자기 잘못인지, 링크가 낡은 건지, 앨범이 없어진 건지 알 수 없었다.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from app.services.link_trouble import (
    classify_invite_trouble,
    classify_share_trouble,
    link_trouble_message,
)

PAST = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
FUTURE = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()

OPEN_ALBUM = {"collaboration_status": "collecting", "collaboration_enabled": True}
CLOSED_ALBUM = {"collaboration_status": "closed", "collaboration_enabled": False}
LIVE_INVITE = {"is_active": True, "expires_at": FUTURE}


def test_three_troubles_say_three_different_things() -> None:
    """★ 사정마다 다른 말을 한다."""
    messages = {
        trouble: link_trouble_message(trouble, "invite")
        for trouble in ("gone", "expired", "closed")
    }
    assert len(set(messages.values())) == 3


def test_every_message_has_two_lines() -> None:
    """첫 줄이 사실, 둘째 줄이 할 수 있는 일."""
    for kind in ("invite", "share"):
        for trouble in ("gone", "expired", "closed"):
            lines = link_trouble_message(trouble, kind).split("\n")
            assert len(lines) == 2
            assert all(line.strip() for line in lines)


def test_no_tech_words_and_no_blaming() -> None:
    """★ 기술 용어를 쓰지 않고(§8), 누구 잘못인지 말하지 않는다(§10).

    ★ `찾을 수 없어요` 도 쓰지 않는다 — 우리가 못 찾는다는 말이라 받는 사람이
    자기 잘못인가 의심하게 만든다.
    """
    for kind in ("invite", "share"):
        for trouble in ("gone", "expired", "closed"):
            message = link_trouble_message(trouble, kind)
            for banned in ("토큰", "404", "403", "만료", "찾을 수 없", "잘못된", "유효하지"):
                assert banned not in message, f"{trouble}/{kind}: {banned}"


def test_invite_and_share_differ_by_one_word() -> None:
    """구경용은 `초대` 를 `링크` 로만 바꾼다."""
    assert "초대" in link_trouble_message("expired", "invite")
    assert "링크" in link_trouble_message("expired", "share")
    assert link_trouble_message("gone", "invite") == link_trouble_message("gone", "share")


# --- 갈래 판정 ---


def test_missing_row_is_gone() -> None:
    """앨범이 지워졌거나 주소가 다르다 — 둘을 가르지 않는다(PO 확정 (a))."""
    assert classify_invite_trouble(None, None) == "gone"
    assert classify_invite_trouble(LIVE_INVITE, None) == "gone"
    assert classify_share_trouble(None) == "gone"


def test_expired_invite() -> None:
    assert classify_invite_trouble({"is_active": True, "expires_at": PAST}, OPEN_ALBUM) == "expired"


def test_replaced_invite_reads_as_expired() -> None:
    """새 링크로 바뀐 옛 링크 — 받는 사람에게는 낡은 링크다."""
    assert classify_invite_trouble({"is_active": False, "expires_at": FUTURE}, OPEN_ALBUM) == "expired"


def test_closed_album_invite() -> None:
    assert classify_invite_trouble(LIVE_INVITE, CLOSED_ALBUM) == "closed"


def test_live_invite_opens() -> None:
    assert classify_invite_trouble(LIVE_INVITE, OPEN_ALBUM) is None


def test_share_link_states() -> None:
    assert classify_share_trouble({"status": "active", "expires_at": FUTURE}) is None
    assert classify_share_trouble({"status": "active", "expires_at": PAST}) == "expired"
    assert classify_share_trouble({"status": "expired"}) == "expired"
    # 주최자가 링크를 껐다 — 받는 사람에게는 앨범이 사라진 것과 같다.
    assert classify_share_trouble({"status": "revoked"}) == "gone"


def test_closed_album_still_opens_the_view_link() -> None:
    """★ 참여가 끝나도 **구경용 링크는 열린다.**

    참여가 끝난 것은 *더할 수 없다*는 뜻이지 *볼 수 없다*는 뜻이 아니다 —
    그건 화면 안에서 한 줄로 알려준다(J-8).
    """
    assert classify_share_trouble({"status": "active", "expires_at": None}) is None


def test_no_use_count_branch() -> None:
    """★ `use_count 초과` 갈래를 만들지 않는다 — `max_uses` 가 항상 NULL 이라 안 일어난다.

    안 쓰는 갈래는 나중에 틀린 채로 발견된다.
    """
    import inspect

    from app.services import link_trouble

    source = inspect.getsource(link_trouble)
    body = source.split('"""', 2)[-1]  # 모듈 설명은 뺀다(거기서는 이유를 적는다)
    assert "use_count" not in body
    assert "max_uses" not in body


def test_lookup_does_not_filter_before_classifying() -> None:
    """★ 걸러서 가져오면 *없는 것*과 *꺼진 것*이 같아져 갈래를 나눌 수 없다."""
    import inspect

    from app.services import collaboration_service, share_service

    invite_lookup = inspect.getsource(collaboration_service.find_invite_by_token)
    assert 'eq("is_active", True)' not in invite_lookup
    share_lookup = inspect.getsource(share_service.find_share_by_token)
    assert 'eq("status"' not in share_lookup
