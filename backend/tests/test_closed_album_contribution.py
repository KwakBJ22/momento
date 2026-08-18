"""참여가 끝난 앨범에서는 **사진**을 더할 수 없다 (J-8 · SCREEN_SPEC §1·§11).

★ 2026-08-16 에 뒤집혔다. 예전에는 사진과 한마디를 **함께** 막았다. 그런데 한마디는
  종이에 들어가지 않는다(C1) — 앨범 확정과 함께 닫을 이유가 없었다.
  `관계는 끝나지 않고, 앨범은 완성된다`(제품_방향 §5)와 정반대였다.
  잣대를 하나로 바꿨다: **인쇄되는 것만 잠근다.**
  그래서 `can_add_contribution` 이 `can_add_photo`(지금과 같다)와
  `can_add_memory`(볼 수 있으면 참)로 갈렸다.

주최자가 `참여 중단` 을 누르면 `collaboration_status = "closed"` 가 되고, 백엔드는
**이미 참여 중인 사람까지 전부** 막는다(collaboration_service.require_contributor ·
api/collaboration.py). 그런데 로그인 경로의 능력 플래그(`can_contribute`)는 **역할만**
보고 있어서 화면에는 버튼이 그대로 남았다 — 누르면 403 이었다(H-1 과 같은 모양).

링크 경로(`/s/`)는 `contribution_block_reason` 이 이미 제대로 막고 있었다.
두 경로가 다르게 동작한 것 자체가 결함이다 — 판정은 한 곳이어야 한다(§1).
"""

from __future__ import annotations

from app.services.authorization import resolve_album_access
from app.services.share_service import (
    SHARE_KIND_CONTRIBUTE,
    album_contribution_block_reason,
    contribution_block_reason,
)

OPEN_ALBUM = {"id": "a1", "owner_id": "u1", "collaboration_status": "collecting"}
CLOSED_ALBUM = {"id": "a1", "owner_id": "u1", "collaboration_status": "closed"}


def _access(album: dict, user_id: str, album_role: str | None):
    return resolve_album_access(album, user_id, family_role=None, album_role=album_role)


def test_participant_cannot_add_photo_when_closed() -> None:
    """★ 참여가 끝나면 **사진**은 더할 수 없다 — 인쇄되는 것이라 잠긴다."""
    access = _access(CLOSED_ALBUM, "u2", "contributor")
    assert access.can_add_photo is False
    # 열려 있을 때는 그대로 된다.
    assert _access(OPEN_ALBUM, "u2", "contributor").can_add_photo is True


def test_owner_cannot_add_photo_when_closed_either() -> None:
    """★ 주최자도 사진은 더할 수 없다 — 백엔드가 그렇게 막으므로 플래그도 그렇게 말한다."""
    assert _access(CLOSED_ALBUM, "u1", "owner").can_add_photo is False


def test_memory_stays_open_when_closed() -> None:
    """★ 이것이 2026-08-16 에 뒤집힌 자리다.

    한마디는 인쇄되지 않는다(C1). 참여 종료는 **앨범을 확정하는 것**이지 관계를 닫는
    것이 아니다 — `관계는 끝나지 않고, 앨범은 완성된다`(제품_방향 §5).
    """
    assert _access(CLOSED_ALBUM, "u2", "contributor").can_add_memory is True
    assert _access(CLOSED_ALBUM, "u1", "owner").can_add_memory is True
    # 이 앨범을 **볼 수 있으면** 참이다. 아무 관계도 없는 사람은 그대로 거짓이다.
    assert _access(CLOSED_ALBUM, "u3", None).can_add_memory is False


def test_owner_can_still_edit_when_closed() -> None:
    """★ 다만 **고치는 것**은 그대로다.

    캡션은 종이에 박혀 되돌릴 수 없어 주최자가 고칠 수 있어야 한다(§7).
    `can_contribute`(자격)와 `can_add_photo`(지금 사진을 더할 수 있는가)는 다른 질문이다.
    """
    access = _access(CLOSED_ALBUM, "u1", "owner")
    assert access.can_contribute is True
    assert access.is_album_owner is True


def test_both_paths_agree() -> None:
    """★ 로그인 경로와 링크 경로가 같게 동작한다 — 판정이 한 곳이다(§1).

    ★ 견주는 것은 **사진**이다. 한마디는 둘 다 막지 않는다(2026-08-16).
    """
    for album in (OPEN_ALBUM, CLOSED_ALBUM):
        blocked_by_link = contribution_block_reason({"kind": SHARE_KIND_CONTRIBUTE}, album) is not None
        blocked_by_login = not _access(album, "u2", "contributor").can_add_photo
        assert blocked_by_link is blocked_by_login


def test_reason_is_given_so_the_screen_can_say_why() -> None:
    """★ 버튼만 사라지면 고장으로 보인다. 왜 그런지 한 줄이 함께 내려간다(§11)."""
    reason = album_contribution_block_reason(CLOSED_ALBUM)
    assert reason == "이 앨범은 사진을 다 모았어요. 한마디는 지금도 남길 수 있어요."
    assert album_contribution_block_reason(OPEN_ALBUM) is None
    # 기술 용어를 쓰지 않는다(§8). `기억` 은 §7 금지어다.
    for banned in ("토큰", "403", "closed", "기억", "종료"):
        assert banned not in reason


def test_stopping_can_be_undone() -> None:
    """★ 되돌릴 수 있다 — 새 초대를 발급하면 다시 열린다.

    `close_collaboration` → "closed",
    `start_collaboration`(= `rotate_invite`) → 다시 "collecting" · enabled True.
    주최자 문구가 그렇게 약속하므로 이 사실이 유지되어야 한다.
    """
    import inspect

    from app.services import collaboration_service

    start = inspect.getsource(collaboration_service.start_collaboration)
    assert '"collaboration_status": "collecting"' in start
    assert '"collaboration_enabled": True' in start
    assert collaboration_service.rotate_invite.__code__.co_names[0] == "start_collaboration"
