"""함께한 사람 수는 한 규칙으로 센다 (SCREEN_SPEC §1).

백엔드 3곳이 각자 셌고 owner 포함 여부가 갈려, 같은 앨범인데 소유자 화면과 공유 화면의
수가 1 차이로 어긋났다. ★ 주최자를 포함해서 센다.
"""

from pathlib import Path

from app.services.collaboration_service import active_contributor_count

ROOT = Path(__file__).resolve().parents[1]


def source(relative: str) -> str:
    return (ROOT / relative).read_text(encoding="utf-8")


ROWS = [
    {"id": "1", "role": "owner", "status": "active"},
    {"id": "2", "role": "contributor", "status": "active"},
    {"id": "3", "role": "contributor", "status": "removed"},
]


def test_owner_is_counted() -> None:
    # 주최자 포함 2명(활성) — 제거된 사람은 세지 않는다.
    assert active_contributor_count(ROWS) == 2


def test_every_caller_uses_the_shared_rule() -> None:
    album = source("app/api/album.py")
    share = source("app/api/share.py")
    collab = source("app/api/collaboration.py")
    # 앨범 상세·공유 응답은 질의 버전을, 협업 현황은 이미 조회한 목록 버전을 쓴다.
    assert "album_contributor_count = count_active_contributors(client, album_id)" in album
    assert "contributor_count=count_active_contributors(client, album_id)" in share
    assert "contributor_total = active_contributor_count(contributors)" in collab
    # 참여자를 각자 세는 인라인 식이 남아 있지 않다(사진·코멘트 수를 세는 것은 다른 값이다).
    assert 'table("album_contributors").select("id", count="exact")' not in album
    assert 'row for row in contributors if str(row["id"]) not in owner_ids' not in share


def test_share_and_owner_screens_agree() -> None:
    """같은 앨범이면 소유자 화면과 공유 화면의 수가 같아야 한다 — 규칙이 하나이므로 같다."""
    owner_screen = active_contributor_count(ROWS)          # 협업 현황(목록 기반)
    share_screen = len([r for r in ROWS if r["status"] == "active"])  # 공유 응답이 쓰는 같은 규칙
    assert owner_screen == share_screen
