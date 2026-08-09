"""공유 링크 종류와 능력 플래그 (SCREEN_SPEC §1 "링크 두 종류").

역할은 링크의 종류가 정한다. 프런트는 종류를 모르고 "무엇을 할 수 있는가"만 본다 —
그 값과 참여 시작 API 의 차단이 같은 함수에서 나와야 갈라지지 않는다.
"""

from app.services.share_service import (
    SHARE_KIND_CONTRIBUTE,
    SHARE_KIND_VIEW,
    album_contribution_block_reason,
    contribution_block_reason,
    create_share_link,
)


class _Result:
    def __init__(self, data):
        self.data = data


class _Table:
    def __init__(self, sink):
        self.sink = sink

    def insert(self, record):
        self.sink.append(record)
        return self

    def execute(self):
        return _Result([self.sink[-1]])


class _Client:
    def __init__(self):
        self.inserted: list[dict] = []

    def table(self, _name):
        return _Table(self.inserted)


def test_view_link_is_issued_as_view() -> None:
    client = _Client()
    create_share_link(client, "album-1", "user-1", None, SHARE_KIND_VIEW)
    assert client.inserted[-1]["kind"] == SHARE_KIND_VIEW


def test_default_stays_contribute() -> None:
    """종류를 지정하지 않는 기존 호출자의 동작이 바뀌지 않는다."""
    client = _Client()
    create_share_link(client, "album-1", "user-1", None)
    assert client.inserted[-1]["kind"] == SHARE_KIND_CONTRIBUTE


def test_unknown_kind_falls_back_to_contribute() -> None:
    client = _Client()
    create_share_link(client, "album-1", "user-1", None, "something-else")
    assert client.inserted[-1]["kind"] == SHARE_KIND_CONTRIBUTE


def test_block_reason_is_the_single_source_of_truth() -> None:
    open_album = {"collaboration_status": "open"}
    # 감상 링크 — 참여 불가. 이유를 한국어로 말한다(§10).
    reason = contribution_block_reason({"kind": SHARE_KIND_VIEW}, open_album)
    assert reason is not None and "감상용" in reason
    # 함께 만들기 링크 — 참여 가능.
    assert contribution_block_reason({"kind": SHARE_KIND_CONTRIBUTE}, open_album) is None
    # kind 가 비어 있는 옛 링크는 기존 동작(참여 가능)을 유지한다 — 이미 나간 링크의
    # 권한이 말없이 바뀌지 않는다.
    assert contribution_block_reason({}, open_album) is None
    # 참여가 끝난 앨범은 링크 종류와 무관하게 막힌다.
    # ★ 문구가 J-8 에서 바뀌었다 — `기억` 은 §7 금지어이고, 사용자에게 "종료"라는
    #   말을 쓰지 않는다. 사실을 말하되 탓하지 않는다(§10).
    closed_album = {"collaboration_status": "closed"}
    closed = contribution_block_reason({"kind": SHARE_KIND_CONTRIBUTE}, closed_album)
    assert closed is not None and "다 모았어요" in closed
    assert "기억" not in closed
    # ★ 로그인 경로(/album/{id})와 링크 경로(/s/)가 **같은 함수**를 쓴다(§1).
    assert album_contribution_block_reason(closed_album) == closed
    assert album_contribution_block_reason(open_album) is None
